import datetime
from app.time_utils import utcnow
import uuid
from sqlalchemy.orm import Session
from app.models.entities import NotificationDelivery, Alert

class NotificationProvider:
    """Mock notification provider abstraction supporting simulated SMS, email, and webhooks with delivery receipts."""
    
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
            provider_message_id=f"msg_{uuid.uuid4().hex[:12]}",
            requested_at=utcnow(),
            provider_status="SENT" if not simulate_failure else "FAILED",
            retry_count=0
        )
        
        if simulate_failure:
            delivery.failure_reason = "Simulated carrier gateway timeout (HTTP 504)"
        else:
            # Under FR-ALERT-08, acknowledge actual delivery receipt
            delivery.provider_status = "DELIVERED"
            delivery.delivered_at = utcnow()

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
        # Success on retry
        delivery.provider_status = "DELIVERED"
        delivery.delivered_at = utcnow()
        delivery.failure_reason = None
        db.commit()
        db.refresh(delivery)
        return delivery
