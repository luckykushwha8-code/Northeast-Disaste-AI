import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
import httpx
from unittest.mock import patch, MagicMock

from app.main import app
from app.database import Base, get_db
from app.data.seed_data import seed_database
from app.config import settings
from app.services.tinyfish_service import tinyfish_service, _rate_limiter
from auth_test_support import AUTH_HEADERS

SQLALCHEMY_DATABASE_URL = "sqlite:///:memory:"

engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    connect_args={"check_same_thread": False},
    poolclass=StaticPool
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

def override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()

@pytest.fixture(scope="module", autouse=True)
def setup_tinyfish_module():
    app.dependency_overrides[get_db] = override_get_db
    Base.metadata.create_all(bind=engine)
    db = TestingSessionLocal()
    seed_database(db)
    db.close()
    yield
    Base.metadata.drop_all(bind=engine)
    app.dependency_overrides.pop(get_db, None)

@pytest.fixture(autouse=True)
def reset_tinyfish_state(monkeypatch):
    monkeypatch.setattr(settings, "TINYFISH_API_KEY", "")
    tinyfish_service.api_key = ""
    _rate_limiter.max_requests = settings.TINYFISH_RATE_LIMIT_PER_MINUTE
    _rate_limiter.timestamps = []

client = TestClient(app, headers=AUTH_HEADERS["OPERATOR"])

# 1. Status without API key
def test_tinyfish_status_missing_key():
    response = client.get("/api/v1/sources/tinyfish/status")
    assert response.status_code == 200
    data = response.json()
    assert data["configured"] is False
    assert data["status"] == "UNAVAILABLE"
    assert data["key_present"] is False
    assert data["key_preview"] is None
    assert data["endpoint"] == "https://api.fetch.tinyfish.ai"
    assert "imd.gov.in" in data["approved_domains"]
    assert data["scheduled_sync_enabled"] is True
    assert data["scheduled_sync_interval_minutes"] == 30

# 2. Status with API key configured (masked key, no plaintext leaks)
def test_tinyfish_status_with_key(monkeypatch):
    secret_key = "tf_live_secret_key_9988776655"
    monkeypatch.setattr(settings, "TINYFISH_API_KEY", secret_key)
    tinyfish_service.api_key = secret_key

    response = client.get("/api/v1/sources/tinyfish/status")
    assert response.status_code == 200
    data = response.json()
    assert data["configured"] is True
    assert data["status"] == "READY"
    assert data["key_present"] is True
    # Credentials are never returned, even partially, by the public status route.
    assert secret_key not in response.text
    assert data["key_preview"] is None

# 3. Strict Domain Allowlist & SSRF Rejection
def test_tinyfish_invalid_sources_rejected():
    invalid_cases = [
        ("http://evil-attacker.com/fake-flood", "not in the approved government disaster monitoring allowlist"),
        ("http://localhost:8000/internal", "Localhost and internal network addresses are strictly prohibited"),
        ("http://127.0.0.1:8000/admin", "Direct IP address access is disallowed"),
        ("http://169.254.169.254/latest/meta-data", "Direct IP address access is disallowed"),
        ("ftp://mausam.imd.gov.in/bulletin", "Invalid scheme 'ftp'"),
        ("https://mausam.imd.gov.in:8443/custom", "Custom port 8443 is not permitted")
    ]

    for url, expected_error in invalid_cases:
        res = client.post("/api/v1/sources/tinyfish/retrieve", json={"url": url})
        assert res.status_code == 400
        assert expected_error in res.json()["detail"]

# 4. Missing credentials in strict mode (simulate_if_unavailable=False)
def test_tinyfish_missing_credentials_strict():
    res = client.post(
        "/api/v1/sources/tinyfish/retrieve",
        json={
            "url": "https://mausam.imd.gov.in/guwahati/bulletin.html",
            "simulate_if_unavailable": False
        }
    )
    assert res.status_code == 503
    assert "credentials" in res.json()["detail"]

# 5. Missing credentials in fallback sandbox mode (simulate_if_unavailable=True)
def test_tinyfish_missing_credentials_fallback_mode():
    res = client.post(
        "/api/v1/sources/tinyfish/retrieve",
        json={
            "url": "https://mausam.imd.gov.in/guwahati/bulletin.html",
            "simulate_if_unavailable": True
        }
    )
    assert res.status_code == 200
    data = res.json()
    assert data["simulation_flag"] is True
    assert data["data_classification"] == "SYNTHETIC_DEMO_DATA"
    assert data["data_quality_status"] == "VALID"
    assert data["source_agency"] == "IMD"
    assert "SIMULATION SANDBOX FIXTURE" in data["extracted_text"]

# 6. Successful live retrieval (mocked TinyFish Fetch API response)
def test_tinyfish_successful_retrieval(monkeypatch):
    monkeypatch.setattr(settings, "TINYFISH_API_KEY", "tf_valid_key_123456789")
    tinyfish_service.api_key = "tf_valid_key_123456789"

    mock_resp_data = {
        "results": [
            {
                "url": "https://ffs.india-water.gov.in/station/022-MBAPU",
                "final_url": "https://ffs.india-water.gov.in/station/022-MBAPU",
                "title": "CWC Pandu Ghat Water Stage Bulletin",
                "description": "Central Water Commission Telemetry Station 022-MBAPU",
                "language": "en",
                "format": "markdown",
                "text": "# CWC Brahmaputra Basin\nDate: 19-10-2026\nWater stage at Pandu is 49.80m (Above Danger Level 49.68m)."
            }
        ],
        "errors": []
    }

    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = mock_resp_data
    mock_response.raise_for_status.return_value = None

    mock_client = MagicMock()
    mock_client.post.return_value = mock_response

    with patch("app.services.tinyfish_service.httpx.Client") as mock_client_cls:
        mock_client_cls.return_value.__enter__.return_value = mock_client

        res = client.post(
            "/api/v1/sources/tinyfish/retrieve",
            json={
                "url": "https://ffs.india-water.gov.in/station/022-MBAPU",
                "format": "markdown",
                "purpose": "River level check"
            }
        )

        assert res.status_code == 200
        data = res.json()
        assert data["source_agency"] == "CWC"
        assert data["title"] == "CWC Pandu Ghat Water Stage Bulletin"
        assert "Water stage at Pandu is 49.80m" in data["extracted_text"]
        assert data["simulation_flag"] is False
        assert data["data_classification"] == "EXTRACTED_WEB_INFORMATION"
        assert data["data_quality_status"] == "VALID"
        assert data["publication_timestamp"] is not None

        # Verify correct TinyFish request headers and payload
        mock_client.post.assert_called_once()
        call_kwargs = mock_client.post.call_args[1]
        assert call_kwargs["headers"]["X-API-Key"] == "tf_valid_key_123456789"
        assert call_kwargs["json"]["urls"] == ["https://ffs.india-water.gov.in/station/022-MBAPU"]
        assert call_kwargs["json"]["format"] == "markdown"

# 7. Timeout handling with bounded retries
def test_tinyfish_timeout_and_retries(monkeypatch):
    monkeypatch.setattr(settings, "TINYFISH_API_KEY", "tf_valid_key_123456789")
    tinyfish_service.api_key = "tf_valid_key_123456789"

    mock_client = MagicMock()
    mock_client.post.side_effect = httpx.TimeoutException("Connection timed out")

    with patch("app.services.tinyfish_service.httpx.Client") as mock_client_cls:
        mock_client_cls.return_value.__enter__.return_value = mock_client

        res = client.post(
            "/api/v1/sources/tinyfish/retrieve",
            json={"url": "https://bhusanket.gsi.gov.in/hazard-bulletin"}
        )

        assert res.status_code == 503
        assert "timed out" in res.json()["detail"].lower()
        # Verify bounded retry (max 2 retries = 3 calls total)
        assert mock_client.post.call_count == 3

# 8. Malformed upstream response handling
def test_tinyfish_malformed_response(monkeypatch):
    monkeypatch.setattr(settings, "TINYFISH_API_KEY", "tf_valid_key_123456789")
    tinyfish_service.api_key = "tf_valid_key_123456789"

    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = {"results": [], "errors": ["Page blocked"]}
    mock_response.raise_for_status.return_value = None

    mock_client = MagicMock()
    mock_client.post.return_value = mock_response

    with patch("app.services.tinyfish_service.httpx.Client") as mock_client_cls:
        mock_client_cls.return_value.__enter__.return_value = mock_client

        res = client.post(
            "/api/v1/sources/tinyfish/retrieve",
            json={"url": "https://mausam.imd.gov.in/nowcast"}
        )
        assert res.status_code == 400
        assert "no results" in res.json()["detail"].lower()

# 9. Rate limiting enforcement
def test_tinyfish_rate_limit():
    _rate_limiter.max_requests = 3
    _rate_limiter.timestamps = []

    for _ in range(3):
        res = client.post(
            "/api/v1/sources/tinyfish/retrieve",
            json={
                "url": "https://mausam.imd.gov.in/warning",
                "simulate_if_unavailable": True
            }
        )
        assert res.status_code == 200

    res4 = client.post(
        "/api/v1/sources/tinyfish/retrieve",
        json={
            "url": "https://mausam.imd.gov.in/warning",
            "simulate_if_unavailable": True
        }
    )
    assert res4.status_code == 429
    assert "Rate limit exceeded" in res4.json()["detail"]

    _rate_limiter.max_requests = settings.TINYFISH_RATE_LIMIT_PER_MINUTE

# 10. History retrieval endpoint
def test_tinyfish_history_endpoint():
    client.post(
        "/api/v1/sources/tinyfish/retrieve",
        json={
            "url": "https://bhusanket.gsi.gov.in/slopes",
            "simulate_if_unavailable": True
        }
    )

    res = client.get("/api/v1/sources/tinyfish/history")
    assert res.status_code == 200
    history = res.json()
    assert len(history) >= 1
    assert history[0]["target_domain"] == "bhusanket.gsi.gov.in"
    assert history[0]["source_agency"] == "GSI"
