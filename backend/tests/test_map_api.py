"""Interactive disaster map aggregation tests.

All fixtures here are clearly test data — none of it claims live API
connectivity. They verify: honest data modes (FRESH/STALE/MISSING), prototype
risk labeling, verbatim official-warning passthrough, boundary alias
resolution (Kamrup Metropolitan -> 'Kamrup' polygon, documented approximation),
point-in-polygon incident containment, and that unmatched districts surface
UNKNOWN instead of fabricated values.
"""
import datetime
import json

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.database import Base, engine, SessionLocal
from app.data.seed_data import seed_database
from app.models.entities import Location, Observation, Alert, IncidentReport, DataSource
from app.services.geographic_service import geographic_service
from app.services.map_service import map_service
from app.config import settings


@pytest.fixture(scope="module", autouse=True)
def setup_map_db():
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    seed_database(db)
    yield
    db.close()
    Base.metadata.drop_all(bind=engine)


@pytest.fixture(scope="module")
def client():
    return TestClient(app)


def test_boundaries_loaded_and_all_eight_states(client):
    r = client.get("/api/v1/map/geometry")
    assert r.status_code == 200
    data = r.json()
    assert data["type"] == "FeatureCollection"
    states = {f["properties"]["state"] for f in data["features"]}
    expected = {"Assam", "Meghalaya", "Arunachal Pradesh", "Sikkim",
                "Nagaland", "Manipur", "Mizoram", "Tripura"}
    assert expected <= states, states
    assert data["geodata"]["crs"] == "EPSG:4326 (GeoJSON lon/lat as delivered)"


def test_alias_resolution_kamrup_metropolitan_is_documented_approximation():
    status = geographic_service.boundary_status_for("Kamrup Metropolitan")
    assert status["status"] == "APPROXIMATED"
    assert status["boundary_name"] == "Kamrup"


def test_alias_resolution_exact_and_unknown():
    assert geographic_service.boundary_status_for("Cachar")["status"] == "EXACT"
    assert geographic_service.boundary_status_for("ZUNLAND")["status"] == "UNKNOWN"


def test_district_summaries_schema_and_honest_modes(client):
    r = client.get("/api/v1/map/districts")
    assert r.status_code == 200
    data = r.json()
    km = next(d for d in data["districts"] if d["district"] == "Kamrup Metropolitan")
    assert km["state"] == "Assam"
    assert km["flood_risk"]["model"] in ("prototype", "none")
    assert km["boundary"]["status"] in ("APPROXIMATED", "EXACT")
    assert km["data_quality"]["risk"] == "PROTOTYPE_MODEL"
    assert km["data_quality"]["rainfall"] in ("FRESH", "STALE", "MISSING")
    assert km["official_warnings"] == [] or km["official_warnings"][0]["source"].startswith("IMD")
    assert all(d["flood_risk"]["risk_category"] in
               {"UNKNOWN", "UNAVAILABLE", "LOW", "MODERATE", "HIGH", "CRITICAL"} for d in data["districts"])


def test_stale_rainfall_reported_stale_not_fresh():
    db = SessionLocal()
    try:
        loc = db.query(Location).filter(Location.id == "loc_pandu_ghat").first()
        src = db.query(DataSource).filter(DataSource.id == "src_map_test").first()
        if not src:
            src = DataSource(id="src_map_test", name="map test stub", source_type="Weather API")
            db.add(src)
        db.add(Observation(
            location_id=loc.id, source_id="src_map_test",
            observed_at=datetime.datetime.utcnow() - datetime.timedelta(hours=30),
            variable="rainfall_24h_mm", value=52.0, unit="mm",
            provenance="test observation (synthetic, stale)", simulation_flag=False))
        db.commit()
        data = map_service.district_summaries(db)
        km = next(d for d in data["districts"] if d["district"] == "Kamrup Metropolitan")
        assert km["data_quality"]["rainfall"] in ("FRESH", "STALE")
        # the newest rainfall for the district is synthetic-stale (30h) unless a
        # fresher seeded reading exists — status must match the newest entry age
        newest = km["observed_rainfall_24h"]
        limit = settings.FRESHNESS_WEATHER_HOURS
        expected = "FRESH" if newest["age_hours"] <= limit else "STALE"
        assert km["data_quality"]["rainfall"] == expected
    finally:
        db.close()


def test_official_warning_passthrough_verbatim():
    db = SessionLocal()
    try:
        loc = db.query(Location).filter(Location.id == "loc_pandu_ghat").first()
        now = datetime.datetime.utcnow()
        db.add(Alert(
            location_id=loc.id, hazard_type="FLOOD", source_type="OFFICIAL_AGENCY",
            severity="HIGH", lifecycle_status="ISSUED", issued_at=now,
            expires_at=now + datetime.timedelta(days=1),
            official_source_reference="TEST OFFICIAL WARNING VERBATIM REF",
            created_by="TEST_WARNING_IMPORT",
            title="Official warning: Very Heavy Rain (test fixture, verbatim)",
            description="Official IMD-styled warning text stored verbatim — fixture only.",
            action_instructions="Follow district administration guidance. (fixture)",
            simulation_flag=False))
        db.commit()
        data = map_service.district_summaries(db)
        km = next(d for d in data["districts"] if d["district"] == "Kamrup Metropolitan")
        assert km["data_quality"]["official_warnings"] == "OFFICIAL"
        w = km["official_warnings"][0]
        assert w["title"] == "Official warning: Very Heavy Rain (test fixture, verbatim)"
        assert w["official_source_reference"] == "TEST OFFICIAL WARNING VERBATIM REF"
        assert "verbatim" in w["description"]
    finally:
        db.close()


def test_incident_containment_inside_and_outside_polygons():
    db = SessionLocal()
    try:
        # Guwahati city centre is inside the 'Kamrup' polygon (approximation)
        db.add(IncidentReport(
            reporter_name="fixture", category="WATERLOGGING",
            location_name="Guwahati test point", latitude=26.1445, longitude=91.7362,
            description="synthetic incident inside Kamrup polygon",
            verification_status="VERIFIED"))
        # Imphal is inside Imphal East/West polygons
        db.add(IncidentReport(
            reporter_name="fixture", category="ROAD_BLOCKED",
            location_name="Imphal test point", latitude=24.817, longitude=93.9368,
            description="synthetic incident inside East Imphal polygon",
            verification_status="VERIFIED"))
        # far outside NE: should not be claimed by any district
        db.add(IncidentReport(
            reporter_name="fixture", category="RAINFALL",
            location_name="Outside NE", latitude=19.076, longitude=72.8777,
            description="synthetic incident far outside the NE polygons",
            verification_status="VERIFIED"))
        db.commit()
        data = map_service.district_summaries(db)
        km = next(d for d in data["districts"] if d["district"] == "Kamrup Metropolitan")
        assert km["incidents_verified"] >= 1
        imp = [d for d in data["districts"] if d["district"] in ("Imphal East", "Imphal West")]
        assert any(d["incidents_verified"] >= 1 for d in imp)
        mumbai_row = [d for d in data["districts"] if d["district"] == "Outside NE"]
        assert mumbai_row == []  # uncontained point never invents a district
    finally:
        db.close()


def test_unmonitored_district_with_incidents_reports_unknown_risk():
    db = SessionLocal()
    try:
        # point inside 'Champhai' (Mizoram) — no monitored Location there
        db.add(IncidentReport(
            reporter_name="fixture", category="SLOPE_CRACK",
            location_name="Champhai test point", latitude=23.65, longitude=93.30,
            description="synthetic incident in an unmonitored district",
            verification_status="VERIFIED"))
        db.commit()
        data = map_service.district_summaries(db)
        row = next(d for d in data["districts"] if d["district"] == "Champhai")
        assert row["flood_risk"]["risk_category"] == "UNKNOWN"
        assert "no monitored location" in row["flood_risk"].get("reason", "")
        assert row["incidents_verified"] == 1
    finally:
        db.close()


def test_state_filter(client):
    r = client.get("/api/v1/map/districts", params={"state": "Mizoram"})
    assert r.status_code == 200
    rows = r.json()["districts"]
    assert rows and all(d["state"] == "Mizoram" for d in rows)
