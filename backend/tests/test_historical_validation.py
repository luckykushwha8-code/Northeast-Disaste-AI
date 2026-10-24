import json
import pytest

from app.main import app
from app.database import Base, engine, SessionLocal
from app.data.seed_data import seed_database
from app.data.historical_cases import HISTORICAL_VALIDATION_CASES
from app.services.validation_service import run_historical_validation, seed_historical_validation_cases
from app.models.entities import DisasterEvent, Location


@pytest.fixture(scope="module", autouse=True)
def setup_validation_module():
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    seed_database(db)
    yield
    db.close()
    Base.metadata.drop_all(bind=engine)


def test_all_documented_positive_events_predicted():
    db = SessionLocal()
    try:
        report = run_historical_validation(db)
        positives = [c for c in report["cases"] if c["case_type"] == "POSITIVE_EVENT"]
        assert len(positives) >= 6
        failed = [c for c in positives if not c["passed"]]
        assert failed == [], f"Predictions contradicted documented outcomes: {[(f['case_id'], f['predicted_category']) for f in failed]}"
    finally:
        db.close()


def test_no_false_alarms_on_documented_normal_conditions():
    db = SessionLocal()
    try:
        report = run_historical_validation(db)
        negatives = [c for c in report["cases"] if c["case_type"] == "NEGATIVE_EVENT"]
        assert len(negatives) >= 2
        false_alarms = [c for c in negatives if not c["passed"]]
        assert false_alarms == [], f"False alarms raised on documented normal conditions: {[(c['case_id'], c['predicted_category']) for c in false_alarms]}"
    finally:
        db.close()


def test_safety_case_missing_gauge_never_fakes_low_risk():
    db = SessionLocal()
    try:
        report = run_historical_validation(db)
        safety = [c for c in report["cases"] if c["case_type"] == "SAFETY_CASE"]
        assert len(safety) >= 1
        for c in safety:
            assert c["predicted_category"] == "UNAVAILABLE", (
                f"Rule R-03 violated: prediction {c['predicted_category']} emitted without gauge data"
            )
            assert c["predicted_probability"] is None
    finally:
        db.close()


def test_per_station_official_marks_applied():
    db = SessionLocal()
    try:
        report = run_historical_validation(db)
        silchar = next(c for c in report["cases"] if c["case_id"] == "val_flood_silchar_2022_06")
        assert silchar["predicted_category"] in ("HIGH", "CRITICAL")
        danger_used = silchar["engine_explanation"]["official_cwc_danger_level_m"]
        assert danger_used == 19.83, f"Silchar case must use official Barak danger mark, got {danger_used}"
    finally:
        db.close()


def test_validation_report_structure_and_metrics():
    db = SessionLocal()
    try:
        report = run_historical_validation(db)
        assert report["total_cases"] == len(HISTORICAL_VALIDATION_CASES)
        assert report["historical_hit_rate"] == 1.0
        assert report["false_alarm_rate"] == 0.0
        assert report["safety_rule_pass_rate"] == 1.0
        assert report["verdict"] == "VALIDATED"
        assert set(report["by_hazard"].keys()) == {"FLOOD", "LANDSLIDE"}
        for case in report["cases"]:
            assert case["source_reference"], "Every validation case must carry an official source reference"
    finally:
        db.close()


def test_documented_events_seeded_for_map_layer():
    db = SessionLocal()
    try:
        events = db.query(DisasterEvent).all()
        assert len(events) >= 10
        assert all(e.source_reference for e in events)
        flood_events = [e for e in events if e.hazard_type == "FLOOD"]
        land_events = [e for e in events if e.hazard_type == "LANDSLIDE"]
        assert flood_events and land_events
    finally:
        db.close()


def test_official_marks_only_baseline_comparison():
    """Baseline (no-AI operational practice) must be beatable in the landslide
    domain - there is NO official real-time landslide rule, so the always-LOW
    baseline scores 0 on positive landslide events while the engine scores 1.0.
    On flood events the official CWC marks alone are already strong."""
    db = SessionLocal()
    try:
        report = run_historical_validation(db)
        baseline = report["baseline"]
        assert baseline["name"] == "official-marks-only-no-ai"
        # Flood: official marks alone catch mark-crossing documented events
        assert baseline["by_hazard"]["FLOOD"]["hit_rate"] == 1.0
        # Landslide: official practice has no real-time rule -> no-skill 0.0
        assert baseline["by_hazard"]["LANDSLIDE"]["hit_rate"] == 0.0
        # Model gain: no improvement on flood (marks suffice), full +1.0 on landslide
        assert report["baseline"]["model_gain_over_baseline"]["LANDSLIDE"] == 1.0
        assert report["baseline"]["model_gain_over_baseline"]["FLOOD"] == 0.0
        # Baseline safety semantics: missing-gauge case stays UNAVAILABLE (not faked LOW)
        fake = [c for c in report["baseline_cases"] if c["case_type"] == "SAFETY_CASE"]
        assert fake and all(c["predicted_category"] == "UNAVAILABLE" for c in fake)
        # Every model case must also have a matching baseline case
        assert len(report["baseline_cases"]) == len(report["cases"])
    finally:
        db.close()
