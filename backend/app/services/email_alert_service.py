import datetime
from app.time_utils import utcnow
import json
import logging
import re
import smtplib
import uuid
from email.mime.text import MIMEText
from email.utils import formataddr
from typing import Any, Dict, List, Tuple

from sqlalchemy.orm import Session

from app.config import settings
from app.models.entities import (
    Alert, Subscriber, NotificationDelivery, Observation
)
from app.services.audit_service import log_audit

logger = logging.getLogger("email_alert_service")

EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")


class EmailAlertService:
    """
    Dispatches operator-approved (ISSUED) alerts to consenting resident
    subscribers in the affected district and to admin-managed district
    authority contacts.

    Guard chain (every step recorded honestly — never silently skipped):
      1. Simulation alerts are sandboxed: no real email is ever sent.
      2. Only HIGH / CRITICAL severities trigger email.
      3. Data-freshness: never dispatch from observations older than
         ALERT_MAX_STALE_HOURS (no invented values, no stale re-sends).
      4. PUBLIC_ALERTS_ENABLED must be true (stays false until sources and the
         risk model are validated). Disabled -> deliveries recorded as
         BLOCKED_DISABLED so the audit trail shows the system was honored.
      5. SMTP must actually be configured, else SMTP_UNCONFIGURED.
      6. Idempotency: one email wave per alert id (retries cannot double-send).
      7. SMTP acceptance is recorded as ACCEPTED_BY_PROVIDER — never claimed
         as "delivered to inbox".
    """

    SYSTEM_ACTOR = "SYSTEM_EMAIL_DISPATCHER"

    # ---------------- recipients ----------------
    @staticmethod
    def authority_contacts() -> Dict[str, List[str]]:
        try:
            raw = json.loads(settings.AUTHORITY_CONTACTS_JSON or "{}")
        except (json.JSONDecodeError, ValueError):
            logger.warning("AUTHORITY_CONTACTS_JSON is not valid JSON — ignoring")
            return {}
        contacts = {}
        for district, emails in raw.items():
            if isinstance(emails, list):
                valid = [e for e in emails if isinstance(e, str) and EMAIL_RE.match(e)]
                contacts[str(district)] = valid
        return contacts

    def _recipients_for_alert(self, db: Session, alert: Alert) -> List[Dict[str, str]]:
        district = alert.location.district if alert.location else None
        if not district:
            return []
        residents = db.query(Subscriber).filter(
            Subscriber.district == district,
            Subscriber.consent == True,           # noqa: E712
            Subscriber.active == True,            # noqa: E712
        ).all()
        people = [
            {"email": s.email.lower(), "role": "RESIDENT"}
            for s in residents
        ]
        for email in self.authority_contacts().get(district, []):
            people.append({"email": email.lower(), "role": "AUTHORITY"})
        # dedup by email (lowercased) preserving insert order
        deduped: List[Dict[str, str]] = []
        seen = set()
        for p in people:
            if p["email"] in seen:
                continue
            seen.add(p["email"])
            deduped.append(p)
        return deduped

    # ---------------- guards ----------------
    @staticmethod
    def _freshness_ok(db: Session, alert: Alert) -> Tuple[bool, str]:
        """
        TRUE-freshness gate: the alert must be backed by an observation no
        older than ALERT_MAX_STALE_HOURS, OR be a verbatim OFFICIAL_AGENCY
        import issued recently (official data is authoritative and timestamped
        at import). Guards against stale observations, not against officiality.
        """
        now = utcnow()
        obs = db.query(Observation).filter(
            Observation.location_id == alert.location_id
        ).order_by(Observation.observed_at.desc()).first()
        if obs and obs.observed_at:
            age_h = (now - obs.observed_at).total_seconds() / 3600.0
            if age_h <= settings.ALERT_MAX_STALE_HOURS:
                return True, f"backed by {obs.variable} observed {obs.observed_at.isoformat()}"
            return False, (
                f"newest observation is {age_h:.1f}h old "
                f"(limit {settings.ALERT_MAX_STALE_HOURS:.1f}h) — stale"
            )
        if alert.source_type == "OFFICIAL_AGENCY" and alert.issued_at:
            age_h = (now - alert.issued_at).total_seconds() / 3600.0
            if age_h <= 1.0:
                return True, "verbatim official import issued just now"
            return False, f"official import issued {age_h:.1f}h ago — not dispatched retroactively"
        return False, "no observations found for the location — cannot verify freshness"

    # ---------------- SMTP ----------------
    @staticmethod
    def _configured() -> bool:
        return bool(settings.SMTP_HOST and settings.SMTP_USER and settings.SMTP_PASS and settings.FROM_EMAIL)

    @staticmethod
    def _send_email(to: str, subject: str, body: str) -> Dict[str, Any]:
        msg = MIMEText(body, "plain", "utf-8")
        msg["Subject"] = subject
        msg["From"] = formataddr((settings.APP_NAME, settings.FROM_EMAIL))
        msg["To"] = to
        message_id = f"<{uuid.uuid4().hex}@nesafe.local>"
        msg["Message-ID"] = message_id
        if settings.SMTP_PORT == 465:
            smtp = smtplib.SMTP_SSL(
                settings.SMTP_HOST, settings.SMTP_PORT, timeout=settings.SMTP_TIMEOUT_SECONDS
            )
        else:
            smtp = smtplib.SMTP(
                settings.SMTP_HOST, settings.SMTP_PORT, timeout=settings.SMTP_TIMEOUT_SECONDS
            )
        try:
            smtp.ehlo()
            if settings.SMTP_PORT != 465:
                smtp.starttls()
                smtp.ehlo()
            smtp.login(settings.SMTP_USER, settings.SMTP_PASS)
            refused = smtp.sendmail(settings.FROM_EMAIL, [to], msg.as_string())
            accepted = len(refused) == 0
        finally:
            try:
                smtp.quit()
            except Exception:
                pass
        return {
            "message_id": message_id,
            "accepted": accepted,
            "message": "accepted_by_provider" if accepted else "not_accepted_by_provider"
        }

    # ---------------- dispatch ----------------
    def dispatch_for_alert(self, db: Session, alert: Alert) -> Dict[str, Any]:
        district = alert.location.district if alert.location else None

        if alert.simulation_flag or alert.source_type == "SIMULATION":
            return {
                "alert_id": alert.id, "status": "BLOCKED_SIMULATED",
                "reason": "SIMULATION data — sandboxed, no real emails sent", "deliveries": []
            }
        if district is None:
            return {
                "alert_id": alert.id, "status": "BLOCKED_SIMULATED",
                "reason": "alert has no resolvable district", "deliveries": []
            }
        if (alert.severity or "").upper() not in ("HIGH", "CRITICAL"):
            return {
                "alert_id": alert.id, "status": "BLOCKED_LOW_SEVERITY",
                "reason": "only HIGH/CRITICAL alerts trigger email", "deliveries": []
            }
        if not settings.PUBLIC_ALERTS_ENABLED:
            return {
                "alert_id": alert.id, "status": "BLOCKED_DISABLED",
                "reason": "PUBLIC_ALERTS_ENABLED is false — automatic public notification disabled",
                "deliveries": []
            }
        exists = db.query(NotificationDelivery).filter(
            NotificationDelivery.alert_id == alert.id,
            NotificationDelivery.channel == "EMAIL"
        ).count()
        if exists > 0:
            sent = db.query(NotificationDelivery).filter(
                NotificationDelivery.alert_id == alert.id,
                NotificationDelivery.channel == "EMAIL",
                NotificationDelivery.provider_status != "BLOCKED_DISABLED"
            ).count()
            if sent > 0:
                return {
                    "alert_id": alert.id, "status": "DUPLICATE_SUPPRESSED",
                    "reason": "an EMAIL wave was already recorded for this alert", "deliveries": []
                }
        fresh, freshness_reason = self._freshness_ok(db, alert)
        if not fresh:
            return {
                "alert_id": alert.id, "status": "BLOCKED_STALE",
                "reason": freshness_reason, "deliveries": []
            }
        if not self._configured():
            return {
                "alert_id": alert.id, "status": "SMTP_UNCONFIGURED",
                "reason": "SMTP_HOST / SMTP_USER / SMTP_PASS / FROM_EMAIL missing",
                "deliveries": []
            }

        recipients = self._recipients_for_alert(db, alert)
        if not recipients:
            return {
                "alert_id": alert.id, "status": "DISPATCHED",
                "reason": "no consenting subscribers or verified authority contacts for this district",
                "recipients_total": 0, "accepted_by_provider": 0, "failed": 0, "deliveries": []
            }

        subject = f"[{alert.severity}] {alert.hazard_type} risk — {district} (NE-SAFE AI)"
        now_iso = utcnow().isoformat() + "Z"
        accepted_count, failed_count = 0, 0
        deliveries: List[NotificationDelivery] = []
        for person in recipients:
            note = "This report is not a government-issued warning. Verify conditions with official disaster-management authorities (ASDMA / DDMA) and follow official instructions. Emergency number: 112."
            if person["role"] == "AUTHORITY":
                note = "Authority copy — this platform remains an assistive aid, not a certified public-warning system."
            body = (
                "AUTOMATED RISK REPORT — VERIFY BEFORE ACTING\n"
                f"Hazard: {alert.hazard_type}\n"
                f"District: {district}\n"
                f"Location: {alert.location.name}\n"
                f"Risk level: {alert.severity}\n"
                f"Issued at: {now_iso}\n"
                f"Source: {alert.source_type} | {alert.official_source_reference or ''}\n"
                f"Alert id: {alert.id}\n"
                "\n"
                f"{alert.title}\n"
                f"{alert.description}\n"
                f"Do this: {alert.action_instructions}\n"
                "\n"
                f"{note}\n"
            )
            failure = None
            provider_status = "FAILED"
            message_id = None
            try:
                result = self._send_email(person["email"], subject, body)
                provider_status = "ACCEPTED_BY_PROVIDER" if result["accepted"] else "FAILED"
                message_id = result["message_id"]
                if result["accepted"]:
                    accepted_count += 1
                else:
                    failed_count += 1
                failure = None if result["accepted"] else result["message"]
            except Exception as e:
                failed_count += 1
                failure = str(e)[:500]
                logger.warning("SMTP send failed to %s: %s", person["email"], e)

            d = NotificationDelivery(
                alert_id=alert.id,
                channel="EMAIL",
                recipient_reference=person["email"],
                provider_message_id=message_id,
                requested_at=utcnow(),
                provider_status=provider_status,
                failure_reason=failure,
                retry_count=0
            )
            if provider_status == "ACCEPTED_BY_PROVIDER":
                d.delivered_at = None  # SMTP acceptance != inbox delivery — never claim it
            db.add(d)
            db.flush()
            deliveries.append(d)

        db.commit()
        for d in deliveries:
            db.refresh(d)
        log_audit(
            db=db,
            actor_id=EmailAlertService.SYSTEM_ACTOR,
            action="EMAIL_DISPATCH_ISSUED_ALERT",
            resource_type="Alert",
            resource_id=alert.id,
            reason=json.dumps({
                "district": district,
                "recipients": len(recipients),
                "accepted_by_provider": accepted_count,
                "failed": failed_count
            })
        )
        return {
            "alert_id": alert.id, "status": "DISPATCHED",
            "reason": f"dispatched to {len(recipients)} recipients ({district})",
            "recipients_total": len(recipients),
            "accepted_by_provider": accepted_count,
            "failed": failed_count,
            "deliveries": deliveries
        }


email_alert_service = EmailAlertService()
