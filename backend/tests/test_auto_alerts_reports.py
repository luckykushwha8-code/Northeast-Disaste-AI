import pytest
import datetime
from unittest import mock

from app.database import Base, engine, SessionLocal
from app.data.seed_data import seed_database
from app.models.entities import (
    Alert, Location, Observation, RescueRequest, IncidentReport, DataSource
)
from app.services.auto_alert_service import auto_alert_service
from app.services.report_service import render_csv, render_pdf, build_report_data
from app.services.ingestion import IngestionService


@pytest.fixture(scope="module", autouse=True)
def setup_module_db():
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    seed_database(db)
    yield
    db.close()
    Base.metadata.drop_all(bind=engine)


def _set_obs(db, location_id, variable, value, hours_ago=0.0):
    return IngestionService.normalize_and_ingest(
        db=db,
        source_id="src_cwc_brahmaputra" if variable.startswith("river") else "src_imd_api",
        location_id=location_id,
        observed_at=datetime.datetime.utcnow() - datetime.timedelta(hours=hours_ago),
        variable=variable,
        raw_value=value,
        raw_unit="m" if variable.startswith("river") else "mm",
        provenance="test set",
        simulation_flag=False
    )


def test_danger_level_crossing_creates_official_ref_alert():
    db = SessionLocal()
    try:
        _set_obs(db, "loc_pandu_ghat", "river_level_m", 49.90)
        result = auto_alert_service.evaluate_and_generate_alerts(db)
        assert result["alerts_created"] >= 1
        assert any(c["rule_id"] == "AUTO-R1-cwc-marks" for c in result["new_alerts"])
        alert = db.query(Alert).filter(Alert.location_id == "loc_pandu_ghat", Alert.hazard_type == "FLOOD").first()
        assert alert is not None
        # AI rule alerts must be PROPOSED + flagged as AI assessment, never "ISSUED" automatically
        assert alert.lifecycle_status == "PROPOSED"
        assert alert.source_type == "AI_ASSESSMENT"
        text = alert.title + alert.description
        assert "CWC" in text or "official" in text.lower()
    finally:
        db.close()


def test_duplicate_rule_hits_are_skipped():
    db = SessionLocal()
    try:
        _set_obs(db, "loc_pandu_ghat", "river_level_m", 49.92)
        first = auto_alert_service.evaluate_and_generate_alerts(db)
        created_first = first["alerts_created"]
        second = auto_alert_service.evaluate_and_generate_alerts(db)
        assert created_first == 0 or second["alerts_created"] == 0
        if created_first == 0:
            assert second["duplicates_skipped"] >= 1
        else:
            assert first["duplicates_skipped"] >= 0
    finally:
        db.close()


def test_escalating_severity_expires_weaker_alert_and_creates_new():
    db = SessionLocal()
    try:
        _set_obs(db, "loc_cachar_silchar", "river_level_m", 19.10)  # above warning (18.87) -> HIGH
        auto_alert_service.evaluate_and_generate_alerts(db)
        _set_obs(db, "loc_cachar_silchar", "river_level_m", 20.10)  # above danger (19.83) -> CRITICAL
        result = auto_alert_service.evaluate_and_generate_alerts(db)
        assert any(c["rule_id"] == "AUTO-R1-cwc-marks" and c["severity"] == "CRITICAL"
                   for c in result["new_alerts"])
        active = db.query(Alert).filter(
            Alert.location_id == "loc_cachar_silchar", Alert.hazard_type == "FLOOD",
            Alert.lifecycle_status.in_(["PROPOSED", "ISSUED", "ACKNOWLEDGED", "APPROVED"])
        ).order_by(Alert.severity.desc()).all()
        assert active
        assert any(a.severity == "CRITICAL" for a in active)
        weaker = db.query(Alert).filter(
            Alert.location_id == "loc_cachar_silchar", Alert.severity == "HIGH",
            Alert.lifecycle_status == "EXPIRED"
        ).first()
        assert weaker is not None
    finally:
        db.close()


def test_heavy_rainfall_and_landslide_rules_fire():
    db = SessionLocal()
    try:
        _set_obs(db, "loc_cherrapunji_sohra", "rainfall_24h_mm", 165.0)
        auto_alert_service.evaluate_and_generate_alerts(db)
        # After 165mm/24h on that GSI zone an ACTIVE landslide alert must exist and
        # the heavier 165mm must have R3 or R4 provenance somewhere in its lineage.
        lands = db.query(Alert).filter(
            Alert.location_id == "loc_cherrapunji_sohra",
            Alert.hazard_type == "LANDSLIDE"
        ).all()
        severities = {a.severity for a in lands}
        provenance = " ".join(a.created_by or "" for a in lands)
        assert "AUTO-R3-heavy-rain" in provenance or "AUTO-R4-landslide-ari" in provenance
        assert any(a.lifecycle_status == "PROPOSED" for a in lands)
        # For Cherrapunji (slope 42deg, susceptibility ~0.9): 165mm must reach CRITICAL now
        assert "CRITICAL" in severities
    finally:
        db.close()


def test_no_false_positive_rules_below_thresholds():
    db = SessionLocal()
    try:
        _set_obs(db, "loc_teesta_mangan", "river_level_m", 855.0)  # below warning 860
        _set_obs(db, "loc_teesta_mangan", "rainfall_24h_mm", 40.0)
        result = auto_alert_service.evaluate_and_generate_alerts(db)
        teesta_new = [c for c in result["new_alerts"] if c["location_id"] == "loc_teesta_mangan"]
        assert teesta_new == [], f"Rules fired below official thresholds: {teesta_new}"
    finally:
        db.close()


# ----------------- Reports -----------------
def test_report_csv_bytes_valid():
    db = SessionLocal()
    try:
        data = build_report_data(db)
        raw = render_csv(data)
        text = raw.decode("utf-8-sig")
        assert "NE-SAFE AI" in text and "WEATHER SUMMARY" in text
        assert data["sources"], "report must list every data source"
        for s in data["sources"]:
            assert s["name"]
    finally:
        db.close()


def test_report_pdf_bytes_valid():
    db = SessionLocal()
    try:
        data = build_report_data(db)
        raw = render_pdf(data)
        assert raw[:5] == b"%PDF-" and len(raw) > 2000
    finally:
        db.close()
