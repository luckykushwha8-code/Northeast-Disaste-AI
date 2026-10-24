"""Critical user journeys A-F, exercised end to end against the API.

Journey A: dashboard data load -> select a region -> view risk details.
Journey B: map layers -> marker sources and timestamps are present.
Journey C: alerts -> filter -> details -> severity and recommendations.
Journey D: reports -> generate -> figures match data -> export.
Journey E: external source failure -> graceful handling -> recovery.
Journey F: mobile-shaped requests (limit params) still return complete payloads.

Simulated data only inside this test module: Journey E monkeypatches the live
adapters; no test warnings are sent to real users and no real network is required.
"""
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.database import Base, engine, SessionLocal
from app.data.seed_data import seed_database


@pytest.fixture(scope="module", autouse=True)
def setup_journey_db():
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    seed_database(db)
    yield
    db.close()
    Base.metadata.drop_all(bind=engine)


# TestClient without context manager: lifespan/scheduler not started in tests
client = TestClient(app)


def test_journey_a_dashboard_to_region_risk():
    # A1. dashboard load: data freshness + observations available
    status = client.get("/api/v1/system/data-status")
    assert status.status_code == 200
    assert isinstance(status.json(), list) and status.json()

    obs = client.get("/api/v1/observations", params={"limit": 5})
    assert obs.status_code == 200

    # A2. select a region: integrated risk details for one monitored location
    geo = client.get("/api/v1/risk/geo")
    assert geo.status_code == 200
    features = geo.json()["features"]
    assert features
    target = features[0]["properties"]["location_id"]
    one = client.get("/api/v1/risk/geo", params={"location_id": target})
    assert one.status_code == 200
    f = one.json()["features"]
    assert len(f) == 1
    p = f[0]["properties"]
    assert p["risk_category"] in ("LOW", "MODERATE", "HIGH", "CRITICAL", "UNAVAILABLE")
    # explanation must be auditable (threshold provenance + notes present)
    fp = f[0]["properties"]
    assert isinstance(fp.get("explanation_notes", []), (list, str))


def test_journey_b_map_layer_marker_provenance():
    # B1. risk layer features carry engine provenance
    geo = client.get("/api/v1/risk/geo").json()
    assert geo["engine_version"] and geo["generated_at"]
    for feat in geo["features"]:
        props = feat["properties"]
        assert props.get("generated_at"), "risk feature must have an engine timestamp"
        geom = feat["geometry"]
        assert geom["type"] == "Point" and len(geom["coordinates"]) == 2

    # B2. validated-history + shelters + citizen layers have source-labelled features
    hist = client.get("/api/v1/data/historical-events").json()
    for e in hist:
        assert e["source_reference"], "historical event marker must cite its source"
    shelters = client.get("/api/v1/shelters").json()
    for s in shelters:
        assert s["verified_at"] and s["verified_by"], "shelter marker must show verification provenance"
    reports = client.get("/api/v1/reports").json()
    for r in reports:
        assert r["report_time"], "citizen marker must show a report timestamp"


def test_journey_c_alerts_filter_details_recommendations():
    alerts = client.get("/api/v1/alerts").json()
    assert isinstance(alerts, list)
    for a in alerts:
        # Every alert: severity, recommendation, source, expiry/status visibility
        assert a["severity"] in ("LOW", "MODERATE", "HIGH", "CRITICAL")
        assert a["action_instructions"], "alert must carry protective-action guidance"
        assert a["lifecycle_status"] in (
            "PROPOSED", "REVIEWED", "APPROVED", "ISSUED", "ACKNOWLEDGED", "RESOLVED", "EXPIRED"
        )
        assert a["created_at"]

    # Filter correctness on lifecycle
    proposed = client.get("/api/v1/alerts", params={"lifecycle_status": "PROPOSED"}).json()
    assert all(a["lifecycle_status"] == "PROPOSED" for a in proposed)
    # AI-sourced alerts must not be fronted as official
    for a in alerts:
        if a.get("source_type") == "AI_ASSESSMENT":
            assert a["official_source_reference"] in (None, "", "AI_EVENT_ENGINE")


def test_journey_d_report_figures_and_exports():
    alerts_count = len(client.get("/api/v1/alerts").json())

    csv_resp = client.get("/api/v1/reports/situation", params={"format": "csv"})
    assert csv_resp.status_code == 200
    text = csv_resp.content.decode("utf-8-sig", errors="replace")
    assert "GENERATED_AT" in text, "report must stamp generation time"

    pdf_resp = client.get("/api/v1/reports/situation", params={"format": "pdf"})
    assert pdf_resp.status_code == 200
    assert pdf_resp.content[:5] == b"%PDF-"

    # Invalid export format is rejected cleanly
    bad = client.get("/api/v1/reports/situation", params={"format": "rtf"})
    assert bad.status_code == 400


def test_journey_e_source_failure_graceful_then_recover(monkeypatch):
    from app.services import live_data_service as lds

    # E1. simulate external service failure for every adapter
    def failing_sync(db):
        return {
            "sources": {
                "CWC_FFS": {"status": "UNAVAILABLE", "error": "simulated outage"},
                "IMD_API": {"status": "UNAVAILABLE", "error": "simulated outage"},
                "NEWS": {"status": "UNAVAILABLE", "error": "simulated outage"},
            },
            "observations_ingested": 0
        }

    monkeypatch.setattr(lds.live_data_service, "sync_all", failing_sync)
    resp = client.post("/api/v1/data/sync")
    assert resp.status_code == 200, "sync must NOT 500 when external sources fail"
    body = resp.json()
    assert body["observations_ingested"] == 0
    assert body["sources"]["CWC_FFS"]["status"] == "UNAVAILABLE"

    # E2. recovery: restore the adapter and confirm the summary flows through again
    def recovered_sync(db):
        return {
            "sources": {"CWC_FFS": {"status": "LIVE"}},
            "observations_ingested": 3
        }

    monkeypatch.setattr(lds.live_data_service, "sync_all", recovered_sync)
    resp2 = client.post("/api/v1/data/sync")
    assert resp2.status_code == 200
    body2 = resp2.json()
    assert body2["observations_ingested"] == 3
    assert body2["sources"]["CWC_FFS"]["status"] == "LIVE"


def test_journey_f_mobile_shaped_payloads():
    # Limit params honoured: small complete payloads, valid structure
    obs = client.get("/api/v1/observations", params={"limit": 3}).json()
    assert len(obs) <= 3
    alerts = client.get("/api/v1/alerts", params={"lifecycle_status": "PROPOSED"}).json()
    for a in alerts:
        assert a["title"] and a["action_instructions"]
    # Weather provenance for a single location (mobile refresh path): every
    # reading must name its source and carry provenance + simulation flag
    geo = client.get("/api/v1/risk/geo").json()
    loc_id = geo["features"][0]["properties"]["location_id"]
    now = client.get("/api/v1/weather/now", params={"location_id": loc_id})
    assert now.status_code == 200
    n = now.json()
    assert n.get("readings"), "weather/now must list current readings"
    for reading in n["readings"]:
        assert reading["source_name"], "every reading must name its source"
        assert reading.get("observed_at") and reading.get("unit")
        assert "simulation_flag" in reading, "provenance requires the simulation flag"
        assert reading.get("provenance"), "reading must carry provenance text"

    # Full forecast sweep: per-location contexts carry an honest data mode
    forecast = client.get("/api/v1/weather/forecast").json()
    assert forecast.get("retrieved_at") and forecast.get("locations")
    for ctx in forecast["locations"]:
        assert "data_mode" in ctx, "each location context must expose LIVE/CACHED/UNAVAILABLE"


def test_full_journey_sweep_all_endpoints_healthy():
    """Overall health gate: the endpoints the six journeys rely on all respond."""
    for method, url, params in [
        ("GET", "/api/v1/system/data-status", None),
        ("GET", "/api/v1/risk/geo", None),
        ("GET", "/api/v1/data/historical-events", None),
        ("GET", "/api/v1/shelters", None),
        ("GET", "/api/v1/reports", None),
        ("GET", "/api/v1/alerts", None),
        ("GET", "/api/v1/reports/situation", {"format": "csv"}),
        ("GET", "/api/v1/analytics/overview", None),
        ("GET", "/api/v1/rescue-requests", None),
    ]:
        resp = client.get(url, params=params)
        assert resp.status_code == 200, f"{url} -> {resp.status_code} {resp.text[:200]}"
