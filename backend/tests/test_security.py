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


def test_private_staff_queues_require_a_signed_login():
    client = TestClient(app)
    assert client.get("/api/v1/alerts").status_code == 401
    assert client.get("/api/v1/reports").status_code == 401
    assert client.get("/api/v1/rescue-requests").status_code == 401


def test_public_alert_feed_excludes_pending_proposals():
    client = TestClient(app, headers=AUTH_HEADERS["OPERATOR"])
    created = client.post("/api/v1/alerts", json={
        "location_id": "loc_pandu_ghat",
        "hazard_type": "FLOOD",
        "severity": "HIGH",
        "title": "Internal test proposal",
        "description": "Not an issued official warning.",
        "action_instructions": "Review with a responder.",
    })
    assert created.status_code == 200
    proposal_id = created.json()["id"]

    public = TestClient(app).get("/api/v1/alerts/public")
    assert public.status_code == 200
    assert all(row["id"] != proposal_id for row in public.json())
    assert all(row["source_type"] == "OFFICIAL_AGENCY" for row in public.json())
    assert all("deliveries" not in row and "events" not in row and "created_by" not in row for row in public.json())


def test_public_incidents_and_rescue_tracking_hide_personal_details():
    staff = TestClient(app, headers=AUTH_HEADERS["RESPONDER"])
    public = TestClient(app)
    incident = public.post("/api/v1/reports", json={
        "reporter_name": "Private Reporter",
        "category": "ROAD_BLOCKED",
        "location_name": "Test road",
        "latitude": 26.1,
        "longitude": 91.7,
        "description": "Reporter provided private details.",
    })
    assert incident.status_code == 200
    incident_id = incident.json()["id"]
    assert all(row["id"] != incident_id for row in public.get("/api/v1/reports/public").json())
    assert staff.post(f"/api/v1/reports/{incident_id}/verify", json={"status": "VERIFIED"}).status_code == 200
    public_incidents = public.get("/api/v1/reports/public").json()
    safe_incident = next(row for row in public_incidents if row["id"] == incident_id)
    assert safe_incident["verification_status"] == "VERIFIED"
    assert "reporter_name" not in safe_incident and "description" not in safe_incident

    request = public.post("/api/v1/rescue-requests", json={
        "location_name": "Private test location",
        "latitude": 26.1,
        "longitude": 91.7,
        "requester_contact": "+910000000000",
        "people_count": 2,
        "needs_summary": "Private medical details",
        "consent_shared_location": True,
    })
    assert request.status_code == 200
    reference = request.json()["public_reference"]
    tracked = public.get("/api/v1/rescue-requests", params={"public_reference": reference})
    assert tracked.status_code == 200
    tracked_request = tracked.json()[0]
    assert tracked_request["status"] == "SUBMITTED"
    assert "requester_contact" not in tracked_request
    assert "needs_summary" not in tracked_request
    assert "latitude" not in tracked_request and "longitude" not in tracked_request


def test_role_header_cannot_authorize_protected_reports():
    client = TestClient(app)
    response = client.get("/api/v1/reports", headers={"x-user-role": "ADMIN"})
    assert response.status_code == 401

    denied = client.get("/api/v1/reports", headers={
        **AUTH_HEADERS["RESIDENT"], "x-user-role": "ADMIN"
    })
    assert denied.status_code == 403
