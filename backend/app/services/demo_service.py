import datetime
from app.time_utils import utcnow
from typing import Dict, Any, Optional

from sqlalchemy.orm import Session

from app.models.entities import (
    Alert, AlertEvent, Location, NotificationDelivery, Prediction, HistoricalValidationCase
)
from app.services.alert_engine import AlertEngine
from app.services.integrated_risk_engine import IntegratedRiskEngine
from app.services.validation_service import replay_case

DEMO_CASE_IDS = [
    "val_land_kharghuli_2022_06",
    "val_flood_pandu_2022_06",
    "val_land_tupul_2022_07",
    "val_flood_silchar_2022_06"
]


def run_documented_demo(db: Session, case_id: str = "val_land_kharghuli_2022_06") -> Dict[str, Any]:
    """
    Recorded-and-watermarked demo: replays a documented historical disaster's
    official inputs through the prediction engines, shows the current live
    assessment for comparison, and walks one alert through the full PROPOSED ->
    APPROVED -> ISSUED lifecycle with notification delivery receipts.
    Every artifact is flagged SIMULATION (Rule R-06) — demo outputs are never
    presented as real live warnings.
    """
    case = db.query(HistoricalValidationCase).filter(HistoricalValidationCase.id == case_id).first()
    if not case:
        raise LookupError(f"Unknown historical validation case: {case_id}. Available: {', '.join(DEMO_CASE_IDS)}")

    loc: Optional[Location] = db.query(Location).filter(Location.id == case.location_id).first()

    demo_tag = f"DEMO_REPLAY_{case.id}"
    # Resolve any previous demo alerts for the same case so the queue stays clean
    previous = db.query(Alert).filter(
        Alert.created_by.startswith(demo_tag),
        Alert.lifecycle_status.in_(["PROPOSED", "ISSUED", "APPROVED", "REVIEWED"])
    ).all()
    for a in previous:
        if a.lifecycle_status != "ISSUED":
            a.lifecycle_status = "EXPIRED"
        else:
            a.lifecycle_status = "RESOLVED"
        db.add(AlertEvent(
            alert_id=a.id, previous_status=a.lifecycle_status, new_status=a.lifecycle_status,
            actor_id="SYSTEM_DEMO_RESET", event_time=utcnow(),
            reason="Superseded by a fresh documented-scenario replay"
        ))
    db.commit()

    # BEFORE: current integrated live assessment (honest live/current state)
    current_ctx = IntegratedRiskEngine.evaluate_location(db, loc) if loc else None

    # DURING: replay of the documented event's official recorded inputs
    replay = replay_case(case)

    severity_rank = {"LOW": 0, "MODERATE": 1, "HIGH": 2, "CRITICAL": 3}
    replay_category = replay["predicted_category"]

    title_tag = "[SIMULATION — DOCUMENTED EVENT REPLAY]"
    alert = AlertEngine.create_proposal(
        db=db,
        location_id=case.location_id,
        hazard_type=case.hazard_type,
        severity=replay_category if severity_rank.get(replay_category, 0) >= 2 else "MODERATE",
        title=f"{title_tag} {case.event_name} — replayed inputs indicate {replay_category} {case.hazard_type.lower()} risk",
        description=(f"Replay of documented inputs from {case.event_name} ({case.event_date.date() if case.event_date else 'n/a'}), "
                     f"source: {case.source_reference}. Documented outcome: {case.documented_outcome}. "
                     f"This is a training/demo artifact and must never be treated as a real-time warning."),
        action_instructions=("Routing/exercise instructions for responders ONLY — verify current live "
                             "assessments and official CWC/IMD bulletins before any real action."),
        source_type="AI_ASSESSMENT",
        official_source_reference=f"{case.source_reference} | replayed {utcnow().isoformat()}",
        created_by=f"{demo_tag}_RULES_ENGINE",
        simulation_flag=True,
        expiry_hours=6
    )

    AlertEngine.transition(
        db=db,
        alert_id=alert.id,
        target_status="APPROVED",
        actor_id=f"{demo_tag}_OPERATOR",
        actor_role="ADMIN",
        reason="Demo lifecycle: auto-approved to demonstrate the traceable alert issuance path with delivery receipts"
    )

    db.refresh(alert)
    deliveries = db.query(NotificationDelivery).filter(
        NotificationDelivery.alert_id == alert.id
    ).all()
    events = db.query(AlertEvent).filter(AlertEvent.alert_id == alert.id).order_by(AlertEvent.event_time).all()

    return {
        "demo_case_id": case.id,
        "watermark": settings_note(),
        "case_summary": {
            "event_name": case.event_name,
            "event_date": case.event_date.isoformat() if case.event_date else None,
            "hazard_type": case.hazard_type,
            "location_id": case.location_id,
            "location_name": loc.name if loc else case.location_id,
            "documented_outcome": case.documented_outcome,
            "source_reference": case.source_reference
        },
        "current_live_assessment": {
            "note": "BEFORE — what the integrated engine says with today's real observations",
            "flood_category": current_ctx["flood"]["risk_category"] if current_ctx else None,
            "landslide_category": current_ctx["landslide"]["risk_category"] if current_ctx else None,
            "ari_mm": current_ctx["landslide"]["ari_mm"] if current_ctx else None,
            "weather_data_mode": (current_ctx or {}).get("data_factors", {}).get("weather_data_mode")
        },
        "replayed_documented_assessment": {
            "note": "DURING — engine output on the event's documented official inputs",
            "predicted_category": replay["predicted_category"],
            "predicted_probability": replay["predicted_probability"],
            "expected_categories": replay["expected_categories"],
            "passed": replay["passed"],
            "explanation": replay["engine_explanation"]
        },
        "alert_lifecycle": {
            "alert_id": alert.id,
            "final_status": alert.lifecycle_status,
            "simulation_flag": alert.simulation_flag,
            "events": [
                {
                    "event_time": ev.event_time.isoformat() if ev.event_time else None,
                    "previous_status": ev.previous_status,
                    "new_status": ev.new_status,
                    "actor_id": ev.actor_id,
                    "reason": ev.reason
                } for ev in events
            ],
            "delivery_receipts": [
                {
                    "delivery_id": d.id,
                    "channel": d.channel,
                    "recipient_reference": d.recipient_reference,
                    "provider_status": d.provider_status,
                    "provider_message_id": d.provider_message_id,
                    "requested_at": d.requested_at.isoformat() if d.requested_at else None,
                    "delivered_at": d.delivered_at.isoformat() if d.delivered_at else None
                } for d in deliveries
            ]
        }
    }


def settings_note() -> str:
    from app.config import settings
    return f"DEMO — {settings.SIMULATION_WATERMARK}"
