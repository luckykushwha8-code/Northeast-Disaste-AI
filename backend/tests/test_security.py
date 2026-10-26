"""Security tests: rate limiting on mutating POST endpoints + CORS hardening."""
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.database import Base, engine, SessionLocal
from app.data.seed_data import seed_database
from app.config import settings
from auth_test_support import AUTH_HEADERS


@pytest.fixture(scope="module", autouse=True)
def setup_security_db():
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    seed_database(db)
    yield
    db.close()
    Base.metadata.drop_all(bind=engine)


@pytest.fixture(autouse=True)
def reset_rate_limit_state():
    # Middleware window state persists app-wide; reset per test for isolation
    app.state.rate_limit_hits.clear()
    yield
    app.state.rate_limit_hits.clear()


def test_post_rate_limit_returns_429(monkeypatch):
    monkeypatch.setattr(settings, "RATE_LIMIT_POST_PER_MINUTE", 1)
    client = TestClient(app, headers=AUTH_HEADERS["OPERATOR"])
    # Invalid payloads -> 422 validation responses, but every POST still counts
    bad_body = {"nope": 1}
    r1 = client.post("/api/v1/rescue-requests", json=bad_body)
    assert r1.status_code == 422
    r2 = client.post("/api/v1/rescue-requests", json=bad_body)
    assert r2.status_code == 429, f"expected 429 got {r2.status_code}: {r2.text[:200]}"
    assert "detail" in r2.json()
    assert "Retry-After" in r2.headers

    # GETs are NOT throttled by this middleware
    r3 = client.get("/api/v1/alerts")
    assert r3.status_code == 200


def test_cors_hardened_to_frontend_origin():
    client = TestClient(app, headers=AUTH_HEADERS["OPERATOR"])
    origin = "http://localhost:5173"
    r = client.get("/api/v1/alerts", headers={"Origin": origin})
    assert r.headers.get("access-control-allow-origin") == origin
    # A foreign origin must not be echoed back as allowed
    rogue = "https://evil.example.com"
    r2 = client.get("/api/v1/alerts", headers={"Origin": rogue})
    assert r2.headers.get("access-control-allow-origin") != rogue


def test_role_header_cannot_authorize_protected_reports():
    client = TestClient(app)
    response = client.get("/api/v1/reports", headers={"x-user-role": "ADMIN"})
    assert response.status_code == 401

    denied = client.get("/api/v1/reports", headers={
        **AUTH_HEADERS["RESIDENT"], "x-user-role": "ADMIN"
    })
    assert denied.status_code == 403
