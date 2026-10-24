"""District alert subscription + email dispatch guard-chain tests.

No SMTP server is contacted: the transport is stubbed at
EmailAlertService._send_email. Every test documents honest behavior —
disabled public alerts NEVER result in a silently-skipped dispatch, the
BLOCKED/SMTP_UNCONFIGURED outcome is what would be recorded, and only truly
operator-approved, fresh, non-simulated HIGH/CRITICAL alerts produce email
waves. PUBLIC_ALERTS_ENABLED is only enabled via monkeypatch inside the
specific tests that exercise dispatch, never leaked between tests.
"""
import datetime
import json

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.database import Base, engine, SessionLocal
from app.data.seed_data import seed_database
from app.models.entities import Alert, Subscriber, NotificationDelivery, Observation, DataSource
from app.services.alert_engine import AlertEngine
from app.services.email_alert_service import email_alert_service
from app.config import settings


@pytest.fixture(scope="module", autouse=True)
def setup_sub_db():
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


def _sub(email, district="Kamrup Metropolitan", consent=True):
    db = SessionLocal()
    db.add(Subscriber(email=email, district=district, consent=consent, active=True))
    db.commit()
    db.close()


def _stub_transport(monkeypatch, accept=True):
    """Stub the SMTP transport. Returns the list of (to, subject) calls."""
    calls = []

    def fake_send(to, subject, body):
        calls.append((to, subject, body))
        return {"message_id": f"<test-{len(calls)}@test>", "accepted": accept,
                "message": "accepted_by_provider" if accept else "not_accepted"}

    monkeypatch.setattr(email_alert_service, "_send_email", fake_send)
    return calls


def _enable_dispatch(monkeypatch):
    """Turn the master switch on for dispatch-exercising tests only, and
    short-circuit the 'SMTP configured' check (transport is stubbed)."""
    monkeypatch.setattr(settings, "PUBLIC_ALERTS_ENABLED", True)
    monkeypatch.setattr(email_alert_service, "_configured", staticmethod(lambda: True))


def _add_fresh_obs(db, location_id, minutes_old=10):
    src = db.query(DataSource).filter(DataSource.id == "src_open_meteo_test").first()
    if not src:
        src = DataSource(id="src_open_meteo_test", name="Open-Meteo (test stub)",
                         source_type="Weather API")
        db.add(src)
    db.add(Observation(location_id=location_id, source_id=src.id,
                       observed_at=datetime.datetime.utcnow() - datetime.timedelta(minutes=minutes_old),
                       variable="river_level_m", value=48.7, unit="m",
                       provenance="test observation (synthetic, fresh)",
                       simulation_flag=False))
    db.commit()


def _fresh_alert(db, location_id="loc_pandu_ghat", severity="HIGH",
                 source_type="AI_ASSESSMENT", simulation_flag=False, minutes_old=10):
    _add_fresh_obs(db, location_id, minutes_old=minutes_old)
    return AlertEngine.create_proposal(
        db=db, location_id=location_id, hazard_type="FLOOD",
        severity=severity, title="Test alert — river level",
        description="synthetic test proposal (never presented as real data)",
        action_instructions="Test instructions.", source_type=source_type,
        created_by="TEST_RULES", simulation_flag=simulation_flag
    )


def _approve(db, alert_id):
    return AlertEngine.transition(
        db=db, alert_id=alert_id, target_status="APPROVED",
        actor_id="test_operator", actor_role="OPERATOR", reason="test approval"
    )


# ---- 1. subscription guards ----

def test_subscribe_validations_disallowed_district_and_consent_required(client):
    r1 = client.post("/api/v1/alerts/subscribe",
                     json={"email": "not-an-email", "district": "Kamrup Metropolitan", "consent": True})
    assert r1.status_code == 400
    r2 = client.post("/api/v1/alerts/subscribe",
                     json={"email": "a@b.co", "district": "UNKNOWN REGION", "consent": True})
    assert r2.status_code == 400 and "not monitored" in r2.json()["detail"]
    r3 = client.post("/api/v1/alerts/subscribe",
                     json={"email": "a@b.co", "district": "Kamrup Metropolitan", "consent": False})
    assert r3.status_code == 400 and "consent" in r3.json()["detail"].lower()


def test_subscribe_saves_consent_and_lists_districts(client):
    r = client.post("/api/v1/alerts/subscribe",
                    json={"email": "resident1@example.org", "district": "Kamrup Metropolitan", "consent": True})
    assert r.status_code == 200 and r.json()["status"] == "subscribed"
    assert r.json()["updated"] is False
    # re-subscribe = update not duplicate row
    r2 = client.post("/api/v1/alerts/subscribe",
                     json={"email": "resident1@example.org", "district": "Kamrup Metropolitan", "consent": True})
    assert r2.json()["updated"] is True
    db = SessionLocal()
    try:
        subs = db.query(Subscriber).filter(Subscriber.email == "resident1@example.org").all()
        assert len(subs) == 1 and subs[0].consent is True
    finally:
        db.close()
    d = client.get("/api/v1/alerts/districts").json()
    assert d and any(x["district"] == "Kamrup Metropolitan" for x in d)


def test_unsubscribe_withdraws_consent(client):
    for email in ("opt_out@example.org",):
        _sub(email)
    r = client.post("/api/v1/alerts/unsubscribe",
                    json={"email": "opt_out@example.org", "district": "Kamrup Metropolitan", "consent": False})
    assert r.status_code == 200 and r.json()["status"] == "unsubscribed"
    r2 = client.post("/api/v1/alerts/unsubscribe",
                     json={"email": "ghost@example.org", "district": "Kamrup Metropolitan", "consent": False})
    assert r2.status_code == 404
    db = SessionLocal()
    try:
        s = db.query(Subscriber).filter(Subscriber.email == "opt_out@example.org").first()
        assert s.consent is False and s.active is False
    finally:
        db.close()


# ---- 2. guard chain (settings left DISABLED) ----

def test_disabled_public_alerts_records_blocked_status():
    db = SessionLocal()
    try:
        alert = _fresh_alert(db)
        result = email_alert_service.dispatch_for_alert(db, alert)
        assert result["status"] == "BLOCKED_DISABLED", str(result)
        assert settings.PUBLIC_ALERTS_ENABLED is False  # nothing flipped it on
        # honest audit record exists for the blocked dispatch?
        # (no deliveries row: dispatch was refused before any send attempt —
        # the status string is the honest record on the API response/audit)
    finally:
        db.close()


def test_simulated_demo_alert_never_sends_real_email(monkeypatch):
    _enable_dispatch(monkeypatch)  # even with alerts enabled, simulation is sandboxed
    db = SessionLocal()
    try:
        alert = _fresh_alert(db, simulation_flag=True)
        monkeypatch.setattr(email_alert_service, "_send_email",
                            lambda *a, **k: (_ for _ in ()).throw(AssertionError("must not send")))
        result = email_alert_service.dispatch_for_alert(db, alert)
        assert result["status"] == "BLOCKED_SIMULATED", str(result)
    finally:
        db.close()


def test_moderate_severity_no_alert_needed(monkeypatch):
    _enable_dispatch(monkeypatch)
    db = SessionLocal()
    try:
        alert = _fresh_alert(db, severity="MODERATE")
        result = email_alert_service.dispatch_for_alert(db, alert)
        assert result["status"] == "BLOCKED_LOW_SEVERITY", str(result)
    finally:
        db.close()


def test_stale_observations_block_dispatch(monkeypatch):
    _enable_dispatch(monkeypatch)
    db = SessionLocal()
    try:
        # any positive observation age exceeds this window -> BLOCKED_STALE
        monkeypatch.setattr(settings, "ALERT_MAX_STALE_HOURS", -1.0)
        alert = _fresh_alert(db, minutes_old=10)
        result = email_alert_service.dispatch_for_alert(db, alert)
        assert result["status"] == "BLOCKED_STALE", str(result)
        assert "stale" in result["reason"]
    finally:
        db.close()


# ---- 3. enabled dispatch (transport stubbed) ----

def test_approved_alert_dispatches_to_consenting_district_residents(monkeypatch):
    _enable_dispatch(monkeypatch)
    _sub("me@example.org", consent=True)
    _sub("no-consent@example.org", consent=False)  # excluded

    calls = _stub_transport(monkeypatch, accept=True)
    db = SessionLocal()
    try:
        alert = _fresh_alert(db)
        _approve(db, alert.id)
        outs = db.query(NotificationDelivery).filter(
            NotificationDelivery.alert_id == alert.id,
            NotificationDelivery.channel == "EMAIL").all()
        emails = {o.recipient_reference for o in outs}
        assert emails == {"resident1@example.org", "me@example.org"}, str(emails)
        assert "no-consent@example.org" not in emails  # consent gate enforced
        for o in outs:
            assert o.provider_status == "ACCEPTED_BY_PROVIDER"
            assert o.delivered_at is None  # SMTP acceptance is NOT claimed as inbox delivery
        assert len(calls) == len(outs)
        assert "VERIFY BEFORE ACTING" in calls[0][2]
        assert calls[0][1].endswith("(NE-SAFE AI)")
    finally:
        db.close()


def test_authority_contacts_receive_email_when_enabled(monkeypatch):
    _enable_dispatch(monkeypatch)
    old = settings.AUTHORITY_CONTACTS_JSON
    settings.AUTHORITY_CONTACTS_JSON = json.dumps(
        {"Kamrup Metropolitan": ["ddma.kamrup@example.org", "not-an-email"]}
    )
    try:
        _stub_transport(monkeypatch, accept=True)
        db = SessionLocal()
        alert = _fresh_alert(db)
        _approve(db, alert.id)
        outs = db.query(NotificationDelivery).filter(
            NotificationDelivery.alert_id == alert.id,
            NotificationDelivery.channel == "EMAIL",
            NotificationDelivery.recipient_reference == "ddma.kamrup@example.org").all()
        assert len(outs) == 1 and outs[0].provider_status == "ACCEPTED_BY_PROVIDER"
        # placeholder values are dropped before dispatch
        bogus = db.query(NotificationDelivery).filter(
            NotificationDelivery.recipient_reference == "not-an-email").first()
        assert bogus is None
        db.close()
    finally:
        settings.AUTHORITY_CONTACTS_JSON = old


def test_smtp_failure_recorded_honestly(monkeypatch):
    _enable_dispatch(monkeypatch)
    old = settings.AUTHORITY_CONTACTS_JSON
    settings.AUTHORITY_CONTACTS_JSON = json.dumps({"Cachar": ["ddma.cachar@example.org"]})
    try:
        db = SessionLocal()
        try:
            def boom(to, subject, body):
                raise RuntimeError("connection refused (test)")
            monkeypatch.setattr(email_alert_service, "_send_email", boom)
            alert = _fresh_alert(db, location_id="loc_cachar_silchar")
            _approve(db, alert.id)
            outs = db.query(NotificationDelivery).filter(
                NotificationDelivery.alert_id == alert.id,
                NotificationDelivery.channel == "EMAIL").all()
            assert len(outs) == 1
            assert outs[0].provider_status == "FAILED"
            assert "connection refused" in (outs[0].failure_reason or "")
        finally:
            db.close()
    finally:
        settings.AUTHORITY_CONTACTS_JSON = old


def test_idempotent_no_second_wave_per_alert(monkeypatch):
    _enable_dispatch(monkeypatch)
    monkeypatch.setattr(email_alert_service, "_send_email",
                        lambda to, subject, body: {"message_id": "<idem@test>", "accepted": True,
                                                   "message": "accepted_by_provider"})
    db = SessionLocal()
    try:
        alert = _fresh_alert(db)
        _approve(db, alert.id)  # wave #1 inside transition
        result = email_alert_service.dispatch_for_alert(db, alert)
        assert result["status"] == "DUPLICATE_SUPPRESSED", str(result)
    finally:
        db.close()
