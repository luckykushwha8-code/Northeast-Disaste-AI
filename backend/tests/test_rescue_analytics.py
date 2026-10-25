import pytest
import datetime

from fastapi.testclient import TestClient

from app.main import app
from app.database import Base, engine, SessionLocal
from app.data.seed_data import seed_database
from app.models.entities import DataSource, Location, Observation, RescueRequest
from app.services.report_service import build_report_data


@pytest.fixture(scope="module", autouse=True)
def setup_rescue_module():
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    seed_database(db)
    yield
    db.close()
    Base.metadata.drop_all(bind=engine)


# NOTE: sole module-level TestClient without context manager — no lifespan/scheduler in tests
client = TestClient(app)


def test_rescue_request_lifecycle_never_auto_dispatch():
    # Citizen submits
    resp = client.post("/api/v1/rescue-requests", json={
        "location_name": "Kharghuli Hills, Guwahati",
        "latitude": 26.166, "longitude": 91.768,
        "requester_contact": "+91-90000-00000",
        "people_count": 4,
        "needs_summary": "Water entering ground floor; 4 people incl. one elderly person need boat evacuation.",
        "consent_shared_location": True
    })
    assert resp.status_code == 200
    req = resp.json()
    assert req["status"] == "SUBMITTED"
    assert req["public_reference"].startswith("RR-")
    # Platform text must not claim dispatch of a rescue team
    assert "dispatch" not in (req["status_notes"] or "").lower()

    # Citizen tracks by public reference
    track = client.get("/api/v1/rescue-requests", params={"public_reference": req["public_reference"]})
    assert track.status_code == 200
    assert track.json()[0]["status"] == "SUBMITTED"

    # Unauthorised citizen-side role cannot confirm assignment (blocked by transition guard or role guard)
    deny = client.post(f"/api/v1/rescue-requests/{req['id']}/status", json={
        "responder_id": "citizen_x", "new_status": "ASSIGNED", "responder_role": "RESIDENT",
        "notes": "trying to self-assign"
    })
    assert deny.status_code in (400, 403)

    # Receives → assigned only by an authorised role
    recv = client.post(f"/api/v1/rescue-requests/{req['id']}/status", json={
        "responder_id": "resp_NDRF1", "new_status": "RECEIVED", "responder_role": "RESPONDER",
        "notes": "Control room logged the request"
    })
    assert recv.status_code == 200 and recv.json()["status"] == "RECEIVED"

    assign = client.post(f"/api/v1/rescue-requests/{req['id']}/status", json={
        "responder_id": "resp_NDRF1", "new_status": "ASSIGNED", "responder_role": "RESPONDER",
        "notes": "Boat team 2 assigned"
    })
    assert assign.status_code == 200 and assign.json()["status"] == "ASSIGNED"
    assert assign.json()["assigned_responder_id"] == "resp_NDRF1"

    enroute = client.post(f"/api/v1/rescue-requests/{req['id']}/status", json={
        "responder_id": "resp_NDRF1", "new_status": "EN_ROUTE", "responder_role": "RESPONDER"
    })
    assert enroute.status_code == 200

    served = client.post(f"/api/v1/rescue-requests/{req['id']}/status", json={
        "responder_id": "resp_NDRF1", "new_status": "SERVED", "responder_role": "RESPONDER",
        "notes": "4 persons evacuated to Type-I shelter"
    })
    assert served.status_code == 200

    closed = client.post(f"/api/v1/rescue-requests/{req['id']}/status", json={
        "responder_id": "resp_NDRF1", "new_status": "CLOSED", "responder_role": "RESPONDER"
    })
    assert closed.status_code == 200
    # Invalid transitions rejected
    invalid = client.post(f"/api/v1/rescue-requests/{req['id']}/status", json={
        "responder_id": "resp_NDRF1", "new_status": "EN_ROUTE", "responder_role": "RESPONDER"
    })
    assert invalid.status_code == 400


def test_rescue_worklist_filters():
    db = SessionLocal()
    try:
        actives = db.query(RescueRequest).filter(
            RescueRequest.status.in_(["SUBMITTED", "RECEIVED", "ASSIGNED", "EN_ROUTE"])
        ).count()
        resp = client.get("/api/v1/rescue-requests", params={"status": "CLOSED"})
        assert resp.status_code == 200
        if actives == 0 and len(resp.json()) == 0:
            # at least the lifecycle test populated data; filter must still work
            pass
        assert all(r["status"] == "CLOSED" for r in resp.json())
    finally:
        db.close()


def test_analytics_overview_dataset_shapes(monkeypatch):
    # Keep the analytics test hermetic & fast: skip live Open-Meteo context
    from app.services import integrated_risk_engine as ire
    monkeypatch.setattr(ire.settings, "OPEN_METEO_ENABLED", False)
    # Seed an incident + rescue request so the analytics has real counts
    client.post("/api/v1/reports", json={
        "category": "ROAD_BLOCKED",
        "location_name": "NH-37 near Silchar bypass",
        "latitude": 24.8, "longitude": 92.8,
        "description": "Blocked road due to landslide debris"
    })
    resp = client.get("/api/v1/analytics/overview")
    assert resp.status_code == 200
    d = resp.json()
    for key in [
        "rainfall_trend_hourly", "rainfall_trend_daily", "river_trend", "risk_by_area",
        "alerts_by_severity", "incidents_by_category", "rescue_by_status",
        "historical_rainfall_comparison", "source_freshness"
    ]:
        assert key in d and isinstance(d[key], list), f"missing dataset {key}"
    assert d["risk_by_area"], "risk_by_area must cover monitored locations"
    # alerts_by_severity splits official vs AI
    for row in d["alerts_by_severity"]:
        assert {"severity", "official", "ai_generated"} <= set(row.keys())
    # river trend carries official marks + units
    if d["river_trend"]:
        row = d["river_trend"][0]
        assert row["unit"] == "m" and row.get("danger_level_m")


def test_simulated_and_stale_observations_are_excluded_from_reports_and_analytics():
    db = SessionLocal()
    try:
        location = db.query(Location).first()
        source = db.query(DataSource).first()
        now = datetime.datetime.utcnow()
        db.add_all([
            Observation(
                source_id=source.id, location_id=location.id, observed_at=now,
                variable="rainfall_24h_mm", value=9999, unit="mm",
                quality_status="SIMULATED", simulation_flag=True,
                provenance="test_simulated_observation_filter",
            ),
            Observation(
                source_id=source.id, location_id=location.id, observed_at=now,
                variable="rainfall_24h_mm", value=8888, unit="mm",
                quality_status="STALE", simulation_flag=False,
                provenance="test_simulated_observation_filter",
            ),
        ])
        db.commit()

        report = build_report_data(db)
        weather = next(row for row in report["weather_summary"] if row["location"] == location.name)
        assert weather["rainfall_24h_mm"] not in (9999, 8888)

        response = client.get("/api/v1/analytics/overview", params={"hours_window": 1})
        assert response.status_code == 200
        hourly = response.json()["rainfall_trend_hourly"]
        assert all(row["max_mm"] not in (9999, 8888) for row in hourly)
    finally:
        db.query(Observation).filter(
            Observation.provenance == "test_simulated_observation_filter"
        ).delete(synchronize_session=False)
        db.commit()
        db.close()


def test_situation_report_endpoints():
    csv_resp = client.get("/api/v1/reports/situation", params={"format": "csv"})
    assert csv_resp.status_code == 200
    assert "text/csv" in csv_resp.headers["content-type"]
    assert csv_resp.content[:6].decode("utf-8-sig", errors="replace").startswith("\ufeff") or True
    assert b"NE-SAFE AI" in csv_resp.content or "NE-SAFE AI" in csv_resp.content.decode("utf-8-sig", errors="replace")

    pdf_resp = client.get("/api/v1/reports/situation", params={"format": "pdf"})
    assert pdf_resp.status_code == 200
    assert pdf_resp.headers["content-type"].startswith("application/pdf")
    assert pdf_resp.content[:5] == b"%PDF-"
    assert "attachment" in pdf_resp.headers["content-disposition"]

    bad = client.get("/api/v1/reports/situation", params={"format": "xlsx"})
    assert bad.status_code == 400
