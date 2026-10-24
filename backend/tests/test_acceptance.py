import pytest
import datetime
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.main import app
from app.database import Base, get_db
from app.data.seed_data import seed_database
from app.models.entities import Alert, DataSource, Observation
from app.services.alert_engine import AlertEngine
from app.services.notification_service import NotificationProvider

# Use StaticPool with in-memory SQLite so all sessions connect to the exact same database
SQLALCHEMY_DATABASE_URL = "sqlite:///:memory:"

engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    connect_args={"check_same_thread": False},
    poolclass=StaticPool
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

def override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture(scope="module", autouse=True)
def setup_test_db():
    app.dependency_overrides[get_db] = override_get_db
    Base.metadata.create_all(bind=engine)
    db = TestingSessionLocal()
    seed_database(db)
    db.close()
    yield
    # Undo the module-scoped dependency override so later test modules use the
    # standard file-backed get_db (post_import isolation across test modules)
    app.dependency_overrides.pop(get_db, None)
    Base.metadata.drop_all(bind=engine)

client = TestClient(app)

def test_health():
    res = client.get("/api/v1/health")
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "HEALTHY"
    assert data["monitored_district"] == "Kamrup Metropolitan"

def test_at01_import_valid_dataset():
    """AT-01: Import a valid dataset -> Records are imported and traceable"""
    payload = {
        "source_id": "src_cwc_brahmaputra",
        "location_id": "loc_pandu_ghat",
        "observed_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "variable": "river_level_m",
        "value": 49.35,
        "unit": "m",
        "provenance": "CWC Telemetry Gauge Feed 022-MBAPU",
        "simulation_flag": False
    }
    res = client.post("/api/v1/observations", json=payload)
    assert res.status_code == 200
    data = res.json()
    assert data["value"] == 49.35
    assert data["quality_status"] == "VALID"
    assert "CWC Telemetry" in data["provenance"]

def test_at02_import_malformed_record():
    """AT-02: Import a malformed record -> Record is rejected with a reason (FR-DATA-03)"""
    payload = {
        "source_id": "src_cwc_brahmaputra",
        "location_id": "loc_pandu_ghat",
        "observed_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "variable": "river_level_m",
        "value": 49.35,
        "unit": "invalid_unit_gallons",  # Incompatible unit
        "provenance": "Malformed record",
        "simulation_flag": False
    }
    res = client.post("/api/v1/observations", json=payload)
    assert res.status_code == 400
    assert "Incompatible unit" in res.json()["detail"]

def test_at03_query_prediction():
    """AT-03: Query a prediction -> Correct location, hazard, horizon and model version returned"""
    # Trigger generation
    gen_res = client.post("/api/v1/predictions/generate")
    assert gen_res.status_code == 200
    
    # Query predictions
    res = client.get("/api/v1/predictions?hazard_type=FLOOD")
    assert res.status_code == 200
    preds = res.json()
    assert len(preds) > 0
    p = preds[0]
    assert p["hazard_type"] == "FLOOD"
    assert p["model_version"] == "cwc-ml-hybrid-v1.2"
    assert p["risk_category"] in ["LOW", "MODERATE", "HIGH", "CRITICAL"]

def test_at04_simulate_stale_data():
    """AT-04: Simulate stale data -> UI/API shows stale status; no false live claim is made (Rule R-02)"""
    res = client.post("/api/v1/simulation/scenario/stale_feed_failure")
    assert res.status_code == 200

    # Inspect predictions
    preds_res = client.get("/api/v1/predictions?hazard_type=FLOOD")
    preds = preds_res.json()
    stale_preds = [p for p in preds if p["data_quality_status"] == "STALE"]
    assert len(stale_preds) > 0
    assert stale_preds[0]["risk_category"] == "UNAVAILABLE"
    assert "STALE" in stale_preds[0]["explanation"]["primary_reason"]

def test_at05_trigger_proposed_alert():
    """AT-05: Trigger a proposed alert -> Alert enters PROPOSED lifecycle state (FR-ALERT-04)"""
    payload = {
        "location_id": "loc_pandu_ghat",
        "hazard_type": "FLOOD",
        "severity": "HIGH",
        "title": "Proposed High Flood Advisory",
        "description": "Rising levels observed at Pandu river gauge.",
        "action_instructions": "Monitor riverside embankments.",
        "simulation_flag": True
    }
    res = client.post("/api/v1/alerts", json=payload)
    assert res.status_code == 200
    data = res.json()
    assert data["lifecycle_status"] == "PROPOSED"
    assert len(data["events"]) == 1
    assert data["events"][0]["new_status"] == "PROPOSED"

def test_at06_unauthorized_approval_attempt():
    """AT-06: Unauthorized approval attempt -> Request rejected with 403 Forbidden (FR-ADMIN-02)"""
    # Create proposal first
    alert_res = client.post("/api/v1/alerts", json={
        "location_id": "loc_kharghuli_hills",
        "hazard_type": "LANDSLIDE",
        "severity": "MODERATE",
        "title": "Test Slope Alert",
        "description": "Rainfall threshold test",
        "action_instructions": "Stay alert",
        "simulation_flag": True
    })
    alert_id = alert_res.json()["id"]

    # Try approving with unauthorized RESIDENT role
    res = client.post(
        f"/api/v1/alerts/{alert_id}/approve",
        json={"actor_id": "usr_resident_01", "reason": "Attempting resident approval"},
        headers={"x-user-role": "RESIDENT"}
    )
    assert res.status_code == 403
    assert "not authorized" in res.json()["detail"]

def test_at07_approve_test_alert():
    """AT-07: Approve a test alert -> Test notification sent through configured channel (FR-ALERT-08)"""
    alert_res = client.post("/api/v1/alerts", json={
        "location_id": "loc_pandu_ghat",
        "hazard_type": "FLOOD",
        "severity": "CRITICAL",
        "title": "Operator Approved Alert",
        "description": "Verified dangerous rise",
        "action_instructions": "Evacuate low ground",
        "simulation_flag": True
    })
    alert_id = alert_res.json()["id"]

    # Approve with OPERATOR role
    res = client.post(
        f"/api/v1/alerts/{alert_id}/approve",
        json={"actor_id": "usr_operator_01", "reason": "Verified against gauge data"},
        headers={"x-user-role": "OPERATOR"}
    )
    assert res.status_code == 200
    data = res.json()
    assert data["lifecycle_status"] == "ISSUED"
    assert len(data["deliveries"]) == 1
    delivery = data["deliveries"][0]
    assert delivery["provider_status"] == "DELIVERED"
    assert "[SIMULATION_SANDBOX]" in delivery["recipient_reference"]

def test_at08_notification_failure_retry():
    """AT-08: Notification provider fails -> Failure recorded and retry policy applied (Rule R-09)"""
    db = TestingSessionLocal()
    alert = db.query(Alert).first()
    
    # Simulate delivery failure
    failed_delivery = NotificationProvider.send(
        db=db,
        alert=alert,
        channel="SMS_SIM",
        simulate_failure=True
    )
    assert failed_delivery.provider_status == "FAILED"
    assert failed_delivery.failure_reason is not None

    # Retry delivery
    retried_delivery = NotificationProvider.retry_delivery(db, failed_delivery.id)
    assert retried_delivery.provider_status == "DELIVERED"
    assert retried_delivery.retry_count == 1
    db.close()

def test_at09_simulation_scenario_watermark():
    """AT-09: Load simulation scenario -> All related screens visibly label simulation data (FR-DATA-09)"""
    res = client.post("/api/v1/simulation/scenario/extreme_flood")
    assert res.status_code == 200
    data = res.json()
    alert_id = data["alert_id"]

    # Fetch alerts
    alerts = client.get("/api/v1/alerts?lifecycle_status=PROPOSED").json()
    assert len(alerts) > 0
    assert alerts[0]["simulation_flag"] is True

def test_at10_sensor_missing_fallback():
    """AT-10: Sensor missing fallback -> Returns UNAVAILABLE status and retains safety integrity (Rule R-03, R-14)"""
    res = client.post("/api/v1/simulation/scenario/sensor_missing_fallback")
    assert res.status_code == 200

    preds = client.get("/api/v1/predictions").json()
    missing_preds = [p for p in preds if p["data_quality_status"] == "MISSING_CRITICAL"]
    assert len(missing_preds) > 0
    assert missing_preds[0]["probability"] is None
    assert missing_preds[0]["risk_category"] == "UNAVAILABLE"

def test_at11_alert_expiry():
    """AT-11: Alert expires -> Status updates without claiming hazard has ended (Rule R-08)"""
    db = TestingSessionLocal()
    past_time = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(hours=2)
    expired_alert = Alert(
        location_id="loc_pandu_ghat",
        hazard_type="FLOOD",
        source_type="AI_ASSESSMENT",
        severity="HIGH",
        lifecycle_status="ISSUED",
        issued_at=past_time,
        expires_at=past_time + datetime.timedelta(hours=1),
        title="Expiring Alert",
        description="Testing expiration policy",
        action_instructions="Action instructions",
        simulation_flag=True
    )
    db.add(expired_alert)
    db.commit()

    expired_count = AlertEngine.check_and_expire_alerts(db)
    assert expired_count >= 1

    db.refresh(expired_alert)
    assert expired_alert.lifecycle_status == "EXPIRED"
    db.close()
