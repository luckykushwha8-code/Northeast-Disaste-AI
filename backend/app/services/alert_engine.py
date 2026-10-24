import datetime
from app.time_utils import utcnow
from typing import Optional
from sqlalchemy.orm import Session
from app.models.entities import Alert, AlertEvent
from app.services.notification_service import NotificationProvider
from app.services.audit_service import log_audit

VALID_TRANSITIONS = {
    "PROPOSED": ["REVIEWED", "REJECTED", "CANCELLED"],
    "REVIEWED": ["APPROVED", "REJECTED", "CANCELLED"],
    "APPROVED": ["ISSUED", "CANCELLED"],
    "ISSUED": ["ACKNOWLEDGED", "RESOLVED", "EXPIRED", "CANCELLED"],
    "ACKNOWLEDGED": ["RESOLVED", "EXPIRED", "CANCELLED"],
    "RESOLVED": [],
    "REJECTED": [],
    "EXPIRED": ["RESOLVED"],
    "CANCELLED": []
}

class AlertEngine:
    """Manages the full traceable 6-state alert lifecycle according to PRD FR-ALERT-04 and Section 7."""

    @staticmethod
    def create_proposal(
        db: Session,
        location_id: str,
        hazard_type: str,
        severity: str,
        title: str,
        description: str,
        action_instructions: str,
        source_type: str = "AI_ASSESSMENT",
        official_source_reference: Optional[str] = None,
        created_by: str = "SYSTEM_RULES_ENGINE",
        simulation_flag: bool = False,
        expiry_hours: int = 12
    ) -> Alert:
        now = utcnow()
        expires = now + datetime.timedelta(hours=expiry_hours)

        alert = Alert(
            location_id=location_id,
            hazard_type=hazard_type,
            source_type=source_type,
            severity=severity,
            lifecycle_status="PROPOSED",
            issued_at=None,
            expires_at=expires,
            official_source_reference=official_source_reference,
            created_by=created_by,
            title=title,
            description=description,
            action_instructions=action_instructions,
            simulation_flag=simulation_flag
        )
        db.add(alert)
        db.flush()

        # Record initial event
        event = AlertEvent(
            alert_id=alert.id,
            previous_status=None,
            new_status="PROPOSED",
            actor_id=created_by,
            reason="Automated proposal generated based on elevated risk threshold crossing (Rule R-04)"
        )
        db.add(event)
        db.commit()
        db.refresh(alert)
        return alert

    @staticmethod
    def transition(
        db: Session,
        alert_id: str,
        target_status: str,
        actor_id: str,
        actor_role: str,
        reason: Optional[str] = None,
        simulate_delivery_failure: bool = False
    ) -> Alert:
        alert = db.query(Alert).filter(Alert.id == alert_id).first()
        if not alert:
            raise ValueError(f"Alert with ID {alert_id} not found")

        # Authorization check (FR-ADMIN-02, Rule R-11)
        authorized_roles = ["OPERATOR", "ADMIN", "DISASTER_MANAGER"]
        if target_status in ["APPROVED", "ISSUED", "CANCELLED", "REJECTED"]:
            if actor_role.upper() not in authorized_roles and not actor_id.startswith("SYSTEM"):
                raise PermissionError(f"Role '{actor_role}' is not authorized to transition alert to '{target_status}'. Operator or Admin required.")

        current = alert.lifecycle_status
        allowed = VALID_TRANSITIONS.get(current, [])

        # Permit direct approval from PROPOSED as a convenience for emergency operators
        if current == "PROPOSED" and target_status == "APPROVED":
            allowed = allowed + ["APPROVED"]

        if target_status not in allowed:
            raise ValueError(f"Invalid alert lifecycle transition: '{current}' -> '{target_status}'. Allowed: {allowed}")

        previous = alert.lifecycle_status
        alert.lifecycle_status = target_status
        now = utcnow()

        if target_status == "APPROVED":
            # Auto-advance to ISSUED and dispatch notification
            alert.lifecycle_status = "ISSUED"
            alert.issued_at = now
            # Dispatch test notification
            NotificationProvider.send(
                db=db,
                alert=alert,
                channel="SMS_SIM",
                simulate_failure=simulate_delivery_failure
            )
            # Real public emails (residents + authorities) — guard chain inside
            # (simulation-sandbox, severity gate, freshness gate, master switch,
            # idempotency). Failures here must never abort the operator action.
            try:
                from app.services.email_alert_service import email_alert_service
                email_alert_service.dispatch_for_alert(db, alert)
            except Exception as e:  # pragma: no cover — defensive
                logger_name = "alert_engine"
                import logging
                logging.getLogger(logger_name).warning("email dispatch failed: %s", e)

        event = AlertEvent(
            alert_id=alert.id,
            previous_status=previous,
            new_status=alert.lifecycle_status,
            actor_id=actor_id,
            event_time=now,
            reason=reason or f"Transitioned from {previous} to {alert.lifecycle_status}"
        )
        db.add(event)

        # Log to immutable audit log
        log_audit(
            db=db,
            actor_id=actor_id,
            action=f"ALERT_STATUS_{alert.lifecycle_status}",
            resource_type="Alert",
            resource_id=alert.id,
            reason=reason
        )

        db.commit()
        db.refresh(alert)
        return alert

    @staticmethod
    def check_and_expire_alerts(db: Session) -> int:
        """Enforces Rule R-08: Expire alerts when validity period passes without claiming hazard has ended."""
        now = utcnow()
        expired_alerts = db.query(Alert).filter(
            Alert.lifecycle_status.in_(["ISSUED", "ACKNOWLEDGED"]),
            Alert.expires_at <= now
        ).all()

        count = 0
        for alert in expired_alerts:
            alert.lifecycle_status = "EXPIRED"
            event = AlertEvent(
                alert_id=alert.id,
                previous_status="ISSUED",
                new_status="EXPIRED",
                actor_id="SYSTEM_CRON_WATCHDOG",
                event_time=now,
                reason="Alert exceeded approved validity window (Rule R-08). Hazard may still persist."
            )
            db.add(event)
            count += 1
        
        if count > 0:
            db.commit()
        return count
