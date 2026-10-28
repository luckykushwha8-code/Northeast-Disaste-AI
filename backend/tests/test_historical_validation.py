import json
import pytest

from app.main import app
from app.database import Base, engine, SessionLocal
from app.data.seed_data import seed_database
from app.data.historical_cases import HISTORICAL_VALIDATION_CASES
from app.services.validation_service import run_historical_validation
from app.models.entities import DisasterEvent


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
        assert positives == []
        assert report["historical_hit_rate"] is None
        assert report["verdict"] == "NEEDS_REVIEW"
    finally:
        db.close()


def test_no_false_alarms_on_documented_normal_conditions():
    db = SessionLocal()
    try:
        report = run_historical_validation(db)
        negatives = [c for c in report["cases"] if c["case_type"] == "NEGATIVE_EVENT"]
        assert negatives == []
        assert report["false_alarm_rate"] is None
        assert report["verdict"] == "NEEDS_REVIEW"
    finally:
        db.close()


def test_safety_case_missing_gauge_never_fakes_low_risk():
    db = SessionLocal()
    try:
        report = run_historical_validation(db)
        safety = [c for c in report["cases"] if c["case_type"] == "SAFETY_CASE"]
        assert safety == []
        assert report["safety_rule_pass_rate"] is None
        assert "no independently verified evaluation dataset" in report["method_note"]
    finally:
        db.close()


def test_per_station_official_marks_applied():
    db = SessionLocal()
    try:
        report = run_historical_validation(db)
        assert report["cases"] == []
        assert report["by_hazard"] == {}
    finally:
        db.close()


def test_validation_report_structure_and_metrics():
    db = SessionLocal()
    try:
        report = run_historical_validation(db)
        assert report["total_cases"] == 0
        assert report["historical_hit_rate"] is None
        assert report["false_alarm_rate"] is None
        assert report["safety_rule_pass_rate"] is None
        assert report["verdict"] == "NEEDS_REVIEW"
        assert report["by_hazard"] == {}
        assert report["cases"] == []
    finally:
        db.close()


def test_unverified_historical_events_are_not_seeded_into_live_map_layer():
    db = SessionLocal()
    try:
        events = db.query(DisasterEvent).all()
        assert events == []
    finally:
        db.close()


def test_unverified_cases_do_not_produce_a_baseline_comparison():
    """No baseline score is reported without an independently verified dataset."""
    db = SessionLocal()
    try:
        report = run_historical_validation(db)
        assert "baseline" not in report
        assert report["baseline_cases"] == []
    finally:
        db.close()
