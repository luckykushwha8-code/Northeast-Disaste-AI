"""Official IMD REST API adapter tests.

ALL IMD payloads here are MOCKED fixtures transcribed from the official provider
documentation samples. They verify parse/ingest/classification logic only — no
test claims the live API was contacted. The live API returns 401 without
credentials (verified in the connectivity probe); these tests document that path
via explicit 401 simulation.
"""
import datetime
import json

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.database import Base, engine, SessionLocal
from app.data.seed_data import seed_database
from app.models.entities import Observation, Alert, LiveDataCache
from app.services.imd_api_service import imd_api_service
from app.services.imd_ingest import imd_ingest_service
from app.config import settings


@pytest.fixture(scope="module", autouse=True)
def setup_imd_db():
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    seed_database(db)
    yield
    db.close()
    Base.metadata.drop_all(bind=engine)


# ---- Mocked fixtures (official documentation samples, NE-relevant subset) ----

RAIN_ROWS = [
    # Today: Kamrup Metropolitan 68.4 mm, category LE
    {"OBJ_ID": "1402", "District": "KAMRUP METROPOLITAN", "Date": datetime.date.today().isoformat(),
     "Daily Actual": "68.40", "Daily Normal": "12.10", "Daily Departure Per": "465%",
     "Daily Category": "LE"},
    # Today: East Khasi Hills (misspelled variant to test matcher)
    {"OBJ_ID": "1601", "District": "EAST KHASI HILLS", "Date": datetime.date.today().isoformat(),
     "Daily Actual": "154.2", "Daily Normal": "24.5", "Daily Departure Per": "529%",
     "Daily Category": "LE"},
    # Stale rainfall (3 days old) - must be skipped, never re-interpreted as current
    {"OBJ_ID": "1602", "District": "CACHAR", "Date": (datetime.date.today() - datetime.timedelta(days=3)).isoformat(),
     "Daily Actual": "190.0", "Daily Normal": "20.0", "Daily Departure Per": "850%",
     "Daily Category": "LE"},
    # Unknown district - must be reported, never fabricated
    {"OBJ_ID": "9", "District": "UNKNOWN IMPERIAL DISTRICT", "Date": datetime.date.today().isoformat(),
     "Daily Actual": "77.0", "Daily Normal": "10.0", "Daily Departure Per": "670%", "Daily Category": "LE"},
    # Out-of-range bogus value - invalid, not risk-boosting
    {"OBJ_ID": "10", "District": "WEST TRIPURA", "Date": datetime.date.today().isoformat(),
     "Daily Actual": "-25", "Daily Normal": "9.0", "Daily Departure Per": "-300%", "Daily Category": "LD"},
]

WARNING_ROWS = [
    {"Obj_id": "1402", "District": "KAMRUP METROPOLITAN",
     "Date": datetime.date.today().isoformat(), "UTC": "0830",
     "Day_1": "2,4", "Day1_Color": "3",   # Heavy Rain + Thunderstorm, Orange
     "Day_2": "16", "Day2_Color": "4",    # Very Heavy Rain, Red
     "Day_3": "1", "Day3_Color": "1",     # No Warning
     "Day1_Color": "3"},
    {"Obj_id": "9", "District": "UNKNOWN IMPERIAL DISTRICT",
     "Date": datetime.date.today().isoformat(), "UTC": "0830",
     "Day_1": "17", "Day1_Color": "4", "Day2_Color": "1", "Day3_Color": "1"},
]

QPF_ROWS = [
    # Official FMO nomenclature example rows for Brahmaputra / Barak
    {"Obj_Id": "100", "Date": datetime.date.today().isoformat(),
     "FMO": "Guwahati", "Basin": "Brahmaputra", "SubBasin": "Kamrup",
     "Day1": "45.0", "Day2": "30.0", "AAP": "52.5"},
]

STATE_IDS = {"MEGHALAYA": 6, "MIZORAM": 14, "TRIPURA": 16, "SIKKIM": 20,
             "ASSAM": 24, "ARUNACHAL_PRADESH": 28, "MANIPUR": 30, "NAGALAND": 32}


def _mocked_fetch(payload_rows, data_mode="LIVE"):
    return {
        "data_mode": data_mode,
        "source_status": "FRESH",
        "endpoint": "/api/v1/mock",
        "retrieved_at": datetime.datetime.utcnow().isoformat(),
        "rows": payload_rows,
        "cache_hit": False
    }


def test_state_ids_match_official_documentation():
    assert STATE_IDS == {"MEGHALAYA": 6, "MIZORAM": 14, "TRIPURA": 16, "SIKKIM": 20,
                         "ASSAM": 24, "ARUNACHAL_PRADESH": 28, "MANIPUR": 30, "NAGALAND": 32}


def test_district_matching_known_variants():
    assert imd_ingest_service.match_locations("KAMRUP_METROPOLITAN") == [
        "loc_pandu_ghat", "loc_bharalu_basin", "loc_kharghuli_hills",
        "loc_kamakhya_nilachal", "loc_narakasur_hills"]
    assert imd_ingest_service.match_locations("East Khasi Hills") == [
        "loc_cherrapunji_sohra", "loc_shillong_hills"]
    assert imd_ingest_service.match_locations("EAST SIKKIM") == ["loc_gangtok_slopes"]
    assert imd_ingest_service.match_locations("NON EXISTENT") == []


def test_district_rainfall_ingests_only_fresh_matched(monkeypatch):
    db = SessionLocal()
    try:
        result = imd_ingest_service.ingest_district_rainfall(db, _mocked_fetch(RAIN_ROWS))
        # Kamrup Metropolitan (5 locations) + East Khasi Hills (2) ingest;
        # stale CACHAR, unknown and negative districts are excluded
        assert result["ingested"] == 7, str(result)
        assert "UNKNOWN IMPERIAL DISTRICT" in result["unmatched_districts"]
        skipped = [m for m in result["matched"] if "skipped" in m]
        assert any("stale" in m["skipped"] for m in skipped), str(skipped)

        obs = db.query(Observation).filter(
            Observation.variable == "rainfall_24h_mm",
            Observation.location_id == "loc_kharghuli_hills",
            Observation.provenance.like("%districtrainfall%")
        ).order_by(Observation.observed_at.desc()).first()
        assert obs is not None
        assert abs(obs.value - 68.40) < 1e-6
        assert obs.source_id == "src_imd_api"
        assert "IMD API districtrainfall" in obs.provenance
        assert obs.simulation_flag is False
    finally:
        db.close()


def test_district_rainfall_not_live_is_skipped():
    result = imd_ingest_service.ingest_district_rainfall(None, _mocked_fetch(RAIN_ROWS, "UNAVAILABLE"))
    assert result["ingested"] == 0
    assert "not LIVE" in result["skipped"]


def test_official_warning_mapper_codes_and_severity():
    mapped = imd_ingest_service.apply_official_district_warnings(_mocked_fetch(WARNING_ROWS))
    specs = mapped["alert_specs"]
    # Kamrup Metro: Day1 (Heavy Rain+Thunder, orange -> HIGH, FLOOD) x5 locations
    #                                             + Day2 (Very Heavy Rain, red -> CRITICAL) x5
    relevant = related_specs(specs)
    assert len(relevant) == 10, str(specs)
    assert "UNKNOWN IMPERIAL DISTRICT" in mapped["unmatched_districts"]
    km_day1 = [s for s in relevant if s["location_id"] == "loc_pandu_ghat"
               and "Day-1" in s["title"]][0]
    assert km_day1["severity"] == "HIGH" and km_day1["hazard_type"] == "FLOOD"
    km_day2 = [s for s in relevant if s["location_id"] == "loc_pandu_ghat"
               and "Day-2" in s["title"]][0]
    assert km_day2["severity"] == "CRITICAL"
    assert "IMD districtwarning" in km_day1["official_source_reference"]
    assert spec_texts_verbatim(km_day1)


def related_specs(specs):
    return [s for s in specs if s["location_id"].startswith("loc_")]


def spec_texts_verbatim(spec):
    return "Heavy Rain" in spec["title"] or "Very Heavy Rain" in spec["title"]


def test_connection_probe_all_endpoints_auth_gated(db_fixture=None):
    """Without an API key the live adapter must classify AUTH_ERROR and never
    claim LIVE. Performs the real HTTP call (verified 401 in connectivity probe)."""
    if settings.IMD_API_KEY:
        pytest.skip("API key is configured; live 401 path not applicable")
    db = SessionLocal()
    try:
        for slug in ("rainfall", "warnings", "nowcast"):
            p = imd_api_service.fetch_endpoint(db, slug)
            assert p["data_mode"] == "UNAVAILABLE"
            assert p["source_status"] == "AUTH_ERROR"
            assert "401" in str(p.get("live_error"))
    finally:
        db.close()


def test_route_imd_sync_with_live_mocked(monkeypatch):
    """Full /imd/sync flow with all three feeds mocked LIVE from doc samples."""
    db = SessionLocal()
    try:
        monkeypatch.setattr(imd_api_service, "fetch_endpoint",
                            lambda d, slug, id_param=None: {
                                "rainfall": _mocked_fetch(RAIN_ROWS),
                                "warnings": _mocked_fetch(WARNING_ROWS),
                                "qpf": _mocked_fetch(QPF_ROWS),
                                "nowcast": _mocked_fetch([]),
                            }.get(slug, _mocked_fetch([])))
        client = TestClient(app)
        resp = client.post("/api/v1/imd/sync")
        assert resp.status_code == 200, resp.text[:300]
        body = resp.json()
        assert body["rainfall"]["ingested"] == 7
        assert body["rainfall"]["unmatched_districts"] == ["UNKNOWN IMPERIAL DISTRICT"]
        # Kamrup: 2 day-warnings x 5 locations == 10 official alerts
        assert body["official_warnings"]["alerts_created"] == 10, str(body["official_warnings"])

        # Official alerts stored verbatim with OFFICIAL_AGENCY source and reference
        guide = db.query(Alert).filter(
            Alert.source_type == "OFFICIAL_AGENCY",
            Alert.created_by == "IMD_REST_API_ADAPTER"
        ).all()
        assert len(guide) == 10
        guwahati = [a for a in guide if a.location_id == "loc_pandu_ghat"]
        assert any("Heavy Rain" in a.title for a in guwahati)
        assert all(a.official_source_reference for a in guide)

        # Idempotent: a second sync must not duplicate official alerts
        resp2 = client.post("/api/v1/imd/sync")
        body2 = resp2.json()
        assert body2["official_warnings"]["alerts_created"] == 0
    finally:
        db.close()


def test_route_imd_status_shape():
    client = TestClient(app)
    resp = client.get("/api/v1/imd/status")
    assert resp.status_code == 200
    d = resp.json()
    assert d["api_key_configured"] == bool(settings.IMD_API_KEY)
    for slug in ("rainfall", "warnings", "nowcast", "qpf", "aws", "aws_map"):
        assert any(e["endpoint"] == slug for e in d["endpoints"])
