from sqlalchemy.orm import Session
from app.models.entities import AuditLog
import json
from typing import Optional, Dict, Any

def log_audit(
    db: Session,
    actor_id: str,
    action: str,
    resource_type: str,
    resource_id: str,
    reason: Optional[str] = None,
    metadata: Optional[Dict[str, Any]] = None
) -> AuditLog:
    """Records an immutable audit log entry for administrative, model, or alert actions."""
    entry = AuditLog(
        actor_id=actor_id,
        action=action,
        resource_type=resource_type,
        resource_id=resource_id,
        reason=reason,
        metadata_json=json.dumps(metadata) if metadata else None
    )
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return entry
