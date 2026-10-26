import datetime
from app.time_utils import utcnow
from sqlalchemy.orm import Session
from app.models.entities import NotificationDelivery, Alert

class NotificationProvider:
    """Simulation-only adapter; it never claims provider acceptance or delivery."""
    
    @staticmethod
    def send(
        db: Session,
        alert: Alert,
        channel: str = "SMS_SIM",
        recipient: str = "Kamrup Metro Disaster Response Hub",
        simulate_failure: bool = False
    ) -> NotificationDelivery:
        # Check Rule R-13: Test mode isolation
        recipient_target = recipient
        if alert.simulation_flag:
            recipient_target = f"[SIMULATION_SANDBOX] {recipient}"

        delivery = NotificationDelivery(
            alert_id=alert.id,
            channel=channel,
            recipient_reference=recipient_target,
            provider_message_id=None,
            requested_at=utcnow(),
            provider_status="FAILED" if simulate_failure else "SIMULATED",
            retry_count=0
        )
        
        if simulate_failure:
            delivery.failure_reason = "Simulated carrier gateway timeout (HTTP 504)"
        else:
            delivery.failure_reason = "Simulation only; no external provider was contacted"

        db.add(delivery)
        db.commit()
        db.refresh(delivery)
        return delivery

    @staticmethod
    def retry_delivery(db: Session, delivery_id: str) -> NotificationDelivery:
        delivery = db.query(NotificationDelivery).filter(NotificationDelivery.id == delivery_id).first()
        if not delivery:
            raise ValueError(f"Delivery record {delivery_id} not found")
        
        delivery.retry_count += 1
        # A retry in the mock adapter is still not an external provider attempt.
        delivery.provider_status = "SIMULATED"
        delivery.delivered_at = None
        delivery.failure_reason = "Simulation retry only; no external provider was contacted"
        db.commit()
        db.refresh(delivery)
        return delivery
