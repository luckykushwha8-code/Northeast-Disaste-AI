import pytest

from app.main import app
from app.database import Base, engine, SessionLocal
from app.data.seed_data import seed_database
from app.services import demo_service
from app.config import settings


@pytest.fixture(scope="module", autouse=True)
def setup_demo_module(monkeypatch_module=None):
    # Disable live Open-Meteo network inside the demo current-assessment path
    monkeypatched = None
    original_flag = settings.OPEN_METEO_ENABLED
    settings.OPEN_METEO_ENABLED = False
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    seed_database(db)
    yield
    db.close()
    settings.OPEN_METEO_ENABLED = original_flag
    Base.metadata.drop_all(bind=engine)


def test_demo_replay_end_to_end():
    db = SessionLocal()
    try:
        result = demo_service.run_documented_demo(db, "val_land_kharghuli_2022_06")
        # Event replay must hit or exceed documented categories (Kharghuli 2022 was CRITICAL)
        assert result["replayed_documented_assessment"]["predicted_category"] in ("HIGH", "CRITICAL")
        assert result["replayed_documented_assessment"]["passed"] is True
        # Alert lifecycle: PROPOSED -> APPROVED/ISSUED with receipt
        lc = result["alert_lifecycle"]
        assert lc["simulation_flag"] is True
        assert lc["final_status"] == "ISSUED"
        statuses = [ev["new_status"] for ev in lc["events"]]
        assert "PROPOSED" in statuses and "ISSUED" in statuses
        assert len(lc["delivery_receipts"]) >= 1
        assert all(d["provider_status"] == "SIMULATED" for d in lc["delivery_receipts"])
        # Watermarked, not presented as a real warning
        assert result["watermark"].startswith("DEMO")
    finally:
        db.close()


def test_demo_replay_repeat_resolves_previous_instances():
    db = SessionLocal()
    try:
        demo_service.run_documented_demo(db, "val_land_kharghuli_2022_06")
        demo_service.run_documented_demo(db, "val_land_kharghuli_2022_06")
        from app.models.entities import Alert
        active = db.query(Alert).filter(
            Alert.created_by.startswith("DEMO_REPLAY_val_land_kharghuli_2022_06"),
            Alert.lifecycle_status.in_(["PROPOSED", "ISSUED"])
        ).all()
        assert len(active) <= 1, f"Demo replays must supersede previous instances, found {len(active)}"
    finally:
        db.close()


def test_demo_unknown_case_is_rejected():
    db = SessionLocal()
    try:
        with pytest.raises(LookupError):
            demo_service.run_documented_demo(db, "val_nonexistent")
    finally:
        db.close()
