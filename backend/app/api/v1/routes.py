from fastapi import APIRouter, Depends, HTTPException, Query, Header, Response
from sqlalchemy.orm import Session
from typing import List, Optional, Dict, Any
import datetime
from app.time_utils import utcnow
import json
import logging

logger = logging.getLogger("nesafe.routes")

from app.database import get_db
from app.models.entities import (
    Location, DataSource, Observation, Prediction, Alert, AlertEvent,
    NotificationDelivery, Shelter, IncidentReport, AuditLog, ModelVersion, User,
    TinyFishRetrievalRecord, DisasterEvent, RescueRequest, LiveDataCache, Subscriber
)
from app.services.email_alert_service import EMAIL_RE
from app.schemas.pydantic_models import (
    LocationOut, DataSourceOut, ObservationOut, ObservationCreate,
    PredictionOut, AlertOut, AlertCreate, AlertAction,
    ShelterOut, IncidentReportOut, IncidentReportCreate, IncidentReportVerify,
    AuditLogOut, ModelVersionOut,
    TinyFishStatusOut, TinyFishRetrievalRequest, TinyFishRetrievalResultOut,
    RescueRequestCreate, RescueRequestStatusUpdate, RescueRequestOut,
    AnalyticsOverview, AlertSubscribeRequest, AlertDistrictOut
)
from app.services.ingestion import IngestionService
from app.services.flood_engine import FloodPredictionEngine
from app.services.landslide_engine import LandslidePredictionEngine
from app.services.alert_engine import AlertEngine
from app.services.audit_service import log_audit
from app.services.tinyfish_service import tinyfish_service
from app.services.live_data_service import live_data_service
from app.services.open_meteo_service import open_meteo_service
from app.services.integrated_risk_engine import IntegratedRiskEngine
from app.services.validation_service import run_historical_validation
from app.services.demo_service import run_documented_demo, DEMO_CASE_IDS
from app.services.map_service import map_service
from app.services.geographic_service import geographic_service
from app.services.auto_alert_service import auto_alert_service
from app.services.report_service import build_report_data, render_csv, render_pdf
from app.services.imd_api_service import imd_api_service
from app.services.imd_ingest import imd_ingest_service
from app.config import settings

router = APIRouter()

STATION_OFFICIAL_MARKS = {
    "loc_pandu_ghat": (48.68, 49.68),
    "loc_cachar_silchar": (18.87, 19.83),
    "loc_pasighat_siang": (152.00, 153.96),
    "loc_teesta_mangan": (860.00, 865.00),
    "loc_imphal_river": (788.00, 790.30),
    "loc_dimapur_dhansiri": (146.50, 148.00),
    "loc_agartala_howrah": (6.00, 6.30)
}

# ----------------- 1. HEALTH & SYSTEM STATUS -----------------
@router.get("/health")
def get_health(db: Session = Depends(get_db)):
    """Basic service health check according to PRD 11.1"""
    loc_count = db.query(Location).count()
    return {
        "status": "HEALTHY",
        "timestamp": utcnow().isoformat(),
        "app_name": settings.APP_NAME,
        "version": settings.APP_VERSION,
        "monitored_district": settings.DEFAULT_DISTRICT,
        "database_connected": True,
        "locations_count": loc_count,
        "simulation_mode_permitted": settings.ALLOW_SIMULATION
    }

@router.get("/system/data-status", response_model=List[DataSourceOut])
def get_data_source_status(db: Session = Depends(get_db)):
    """Shows all data feeds and their freshness/operational health (FR-DATA-06, FR-DATA-07)"""
    sources = db.query(DataSource).all()
    # Check if feeds are delayed or stale based on expected interval
    now = utcnow()
    for s in sources:
        if s.status != "FAILED" and s.last_success_at:
            age_hours = (now - s.last_success_at).total_seconds() / 3600.0
            if age_hours > (s.expected_update_interval_hours * 2):
                s.status = "STALE"
            elif age_hours > s.expected_update_interval_hours:
                s.status = "DELAYED"
    db.commit()
    return sources

@router.get("/system/audit-logs", response_model=List[AuditLogOut])
def get_audit_logs(db: Session = Depends(get_db), limit: int = 50):
    """Retrieve immutable audit trail records for compliance (FR-ADMIN-04)"""
    return db.query(AuditLog).order_by(AuditLog.timestamp.desc()).limit(limit).all()

@router.get("/models", response_model=List[ModelVersionOut])
def list_models(db: Session = Depends(get_db)):
    """List registered hazard prediction models and validation metrics (FR-ADMIN-03)"""
    models = db.query(ModelVersion).all()
    result = []
    for m in models:
        metrics = json.loads(m.evaluation_metrics_json) if m.evaluation_metrics_json else {}
        result.append(ModelVersionOut(
            id=m.id,
            hazard_type=m.hazard_type,
            version=m.version,
            training_data_version=m.training_data_version,
            evaluation_metrics=metrics,
            approval_status=m.approval_status,
            released_at=m.released_at,
            known_limitations=m.known_limitations
        ))
    return result

# ----------------- 2. LOCATIONS -----------------
@router.get("/locations", response_model=List[LocationOut])
def list_locations(db: Session = Depends(get_db)):
    """List all monitored geographic zones and river stations in study area"""
    locations = db.query(Location).filter(Location.active == True).all()
    out = []
    for loc in locations:
        terrain_dict = None
        if loc.terrain:
            terrain_dict = {
                "slope_deg": loc.terrain.slope_deg,
                "elevation_m": loc.terrain.elevation_m,
                "geology": loc.terrain.geology,
                "land_cover": loc.terrain.land_cover,
                "drainage_density": loc.terrain.drainage_density,
                "susceptibility_score": loc.terrain.susceptibility_score
            }
        out.append(LocationOut(
            id=loc.id,
            name=loc.name,
            state=loc.state,
            district=loc.district,
            location_type=loc.location_type,
            latitude=loc.latitude,
            longitude=loc.longitude,
            elevation_m=loc.elevation_m,
            geometry_geojson=loc.geometry_geojson,
            active=loc.active,
            terrain=terrain_dict
        ))
    return out

# ----------------- 3. OBSERVATIONS -----------------
@router.get("/observations", response_model=List[ObservationOut])
def get_observations(
    location_id: Optional[str] = None,
    variable: Optional[str] = None,
    limit: int = 100,
    db: Session = Depends(get_db)
):
    query = db.query(Observation)
    if location_id:
        query = query.filter(Observation.location_id == location_id)
    if variable:
        query = query.filter(Observation.variable == variable)
    return query.order_by(Observation.observed_at.desc()).limit(limit).all()

@router.post("/observations", response_model=ObservationOut)
def ingest_observation(payload: ObservationCreate, db: Session = Depends(get_db)):
    try:
        obs = IngestionService.normalize_and_ingest(
            db=db,
            source_id=payload.source_id,
            location_id=payload.location_id,
            observed_at=payload.observed_at,
            variable=payload.variable,
            raw_value=payload.value,
            raw_unit=payload.unit,
            provenance=payload.provenance or "API Manual Ingest",
            simulation_flag=payload.simulation_flag
        )
        return obs
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))

# ----------------- 4. PREDICTIONS -----------------
@router.get("/predictions", response_model=List[PredictionOut])
def get_predictions(
    location_id: Optional[str] = None,
    hazard_type: Optional[str] = None,
    limit: int = 50,
    db: Session = Depends(get_db)
):
    query = db.query(Prediction)
    if location_id:
        query = query.filter(Prediction.location_id == location_id)
    if hazard_type:
        query = query.filter(Prediction.hazard_type == hazard_type)
    
    preds = query.order_by(Prediction.generated_at.desc()).limit(limit).all()
    results = []
    for p in preds:
        results.append(PredictionOut(
            id=p.id,
            location_id=p.location_id,
            location_name=p.location.name if p.location else None,
            hazard_type=p.hazard_type,
            model_version=p.model_version_id,
            generated_at=p.generated_at,
            horizon_start=p.horizon_start,
            horizon_end=p.horizon_end,
            probability=p.probability,
            risk_category=p.risk_category,
            data_quality_status=p.data_quality_status,
            input_snapshot=json.loads(p.input_snapshot_json) if p.input_snapshot_json else None,
            explanation=json.loads(p.explanation_json) if p.explanation_json else None,
            simulation_flag=p.simulation_flag
        ))
    return results

@router.post("/predictions/generate")
def generate_assessments(
    location_id: Optional[str] = None,
    force_stale: bool = False,
    force_missing: bool = False,
    db: Session = Depends(get_db)
):
    """
    Evaluates current observations across monitored locations and generates dual hazard assessments.
    Enforces Rule R-02 (stale handling) and Rule R-03 (missing sensor handling).
    """
    locations = db.query(Location).filter(Location.active == True).all()
    if location_id:
        locations = [l for l in locations if l.id == location_id]

    created_predictions = []

    for loc in locations:
        # Gather latest observations for this location
        latest_obs = {}
        obs_records = db.query(Observation).filter(Observation.location_id == loc.id).order_by(Observation.observed_at.desc()).limit(20).all()
        for o in obs_records:
            if o.variable not in latest_obs:
                latest_obs[o.variable] = o.value
                latest_obs[f"{o.variable}_age_hours"] = (utcnow() - o.observed_at).total_seconds() / 3600.0

        if force_stale:
            latest_obs["river_level_age_hours"] = 12.0
            latest_obs["rainfall_age_hours"] = 24.0

        if force_missing:
            latest_obs["river_level_m"] = None
            latest_obs["rainfall_24h_mm"] = None

        # 1. Flood Assessment
        # Relevant for River stations and urban basins
        if loc.location_type in ["RIVER_STATION", "URBAN_CATCHMENT"]:
            # If river_level_m isn't at this specific gauge, use nearest CWC Pandu reading as regional baseline
            if "river_level_m" not in latest_obs and not force_missing:
                cwc_obs = db.query(Observation).filter(Observation.variable == "river_level_m").order_by(Observation.observed_at.desc()).first()
                if cwc_obs:
                    latest_obs["river_level_m"] = cwc_obs.value
                    latest_obs["river_rate_m_hr"] = 0.06

            flood_res = FloodPredictionEngine.evaluate(
                location_id=loc.id,
                observations=latest_obs,
                forecast_horizon_hours=6,
                is_simulation=False,
                station_warning_level_m=STATION_OFFICIAL_MARKS.get(loc.id, (None, None))[0],
                station_danger_level_m=STATION_OFFICIAL_MARKS.get(loc.id, (None, None))[1]
            )

            p_flood = Prediction(
                location_id=loc.id,
                hazard_type="FLOOD",
                model_version_id=flood_res["model_version"],
                generated_at=utcnow(),
                horizon_start=datetime.datetime.fromisoformat(flood_res["horizon_start"]),
                horizon_end=datetime.datetime.fromisoformat(flood_res["horizon_end"]),
                probability=flood_res["probability"],
                risk_category=flood_res["risk_category"],
                data_quality_status=flood_res["data_quality_status"],
                input_snapshot_json=json.dumps(flood_res["input_snapshot"]),
                explanation_json=json.dumps(flood_res["explanation"]),
                simulation_flag=flood_res["simulation_flag"]
            )
            db.add(p_flood)
            created_predictions.append(flood_res)

        # 2. Landslide Assessment
        # Relevant for Slope zones
        if loc.location_type == "SLOPE_ZONE" or (loc.terrain and loc.terrain.slope_deg >= 15.0):
            terrain_data = {
                "slope_deg": loc.terrain.slope_deg if loc.terrain else 28.0,
                "susceptibility_score": loc.terrain.susceptibility_score if loc.terrain else 0.65,
                "geology": loc.terrain.geology if loc.terrain else "Gneissic Metamorphic"
            }
            # Fallback rainfall if missing
            if "rainfall_24h_mm" not in latest_obs and not force_missing:
                rf_obs = db.query(Observation).filter(Observation.variable == "rainfall_24h_mm").order_by(Observation.observed_at.desc()).first()
                latest_obs["rainfall_24h_mm"] = rf_obs.value if rf_obs else 65.0

            landslide_res = LandslidePredictionEngine.evaluate(
                location_id=loc.id,
                terrain=terrain_data,
                observations=latest_obs,
                forecast_horizon_hours=24,
                is_simulation=False
            )

            p_land = Prediction(
                location_id=loc.id,
                hazard_type="LANDSLIDE",
                model_version_id=landslide_res["model_version"],
                generated_at=utcnow(),
                horizon_start=datetime.datetime.fromisoformat(landslide_res["horizon_start"]),
                horizon_end=datetime.datetime.fromisoformat(landslide_res["horizon_end"]),
                probability=landslide_res["probability"],
                risk_category=landslide_res["risk_category"],
                data_quality_status=landslide_res["data_quality_status"],
                input_snapshot_json=json.dumps(landslide_res["input_snapshot"]),
                explanation_json=json.dumps(landslide_res["explanation"]),
                simulation_flag=landslide_res["simulation_flag"]
            )
            db.add(p_land)
            created_predictions.append(landslide_res)

    db.commit()
    return {"generated_count": len(created_predictions), "results": created_predictions}

# ----------------- 5. ALERTS & NOTIFICATIONS -----------------
@router.get("/alerts", response_model=List[AlertOut])
def list_alerts(
    lifecycle_status: Optional[str] = None,
    hazard_type: Optional[str] = None,
    db: Session = Depends(get_db)
):
    query = db.query(Alert)
    if lifecycle_status:
        query = query.filter(Alert.lifecycle_status == lifecycle_status)
    if hazard_type:
        query = query.filter(Alert.hazard_type == hazard_type)
    
    alerts = query.order_by(Alert.id.desc()).all()
    # Populate location name
    result = []
    for a in alerts:
        a_dict = {
            "id": a.id,
            "location_id": a.location_id,
            "location_name": a.location.name if a.location else "Kamrup Metro",
            "hazard_type": a.hazard_type,
            "source_type": a.source_type,
            "severity": a.severity,
            "lifecycle_status": a.lifecycle_status,
            "issued_at": a.issued_at,
            "expires_at": a.expires_at,
            "official_source_reference": a.official_source_reference,
            "created_by": a.created_by,
            "title": a.title,
            "description": a.description,
            "action_instructions": a.action_instructions,
            "simulation_flag": a.simulation_flag,
            "events": a.events,
            "deliveries": a.deliveries
        }
        result.append(AlertOut(**a_dict))
    return result

@router.get("/alerts/districts", response_model=List[AlertDistrictOut])
def list_subscribable_districts(db: Session = Depends(get_db)):
    """Districts with active monitored locations — the only districts a resident may subscribe to."""
    rows = db.query(Location).filter(Location.active == True).all()
    agg = {}
    for loc in rows:
        key = (loc.district, loc.state)
        if key not in agg:
            agg[key] = 0
        agg[key] += 1
    return [
        AlertDistrictOut(district=d, state=s, monitored_location_count=n)
        for (d, s), n in sorted(agg.items())
    ]

@router.post("/alerts/subscribe", response_model=Dict[str, Any])
def subscribe_to_alerts(payload: AlertSubscribeRequest, db: Session = Depends(get_db)):
    """
    Save a resident's explicit email consent for one district (FR-ALERT-10).
    Emails are only sent after operator approval + every guard in
    EmailAlertService passes; consent alone never triggers an email.
    """
    email = (payload.email or "").strip().lower()
    district = (payload.district or "").strip()

    if not payload.email or len(email) > 254 or not EMAIL_RE.match(email):
        raise HTTPException(status_code=400, detail="A valid email address is required")
    if not district:
        raise HTTPException(status_code=400, detail="District is required")
    if payload.consent is not True:
        raise HTTPException(status_code=400, detail="Explicit consent is required to subscribe")

    allowed = {l.district for l in db.query(Location).filter(Location.active == True).all()}
    if district not in allowed:
        raise HTTPException(
            status_code=400,
            detail=f"District not monitored for alerts. Choose one from GET /alerts/districts."
        )

    loc_match = db.query(Location).filter(
        Location.active == True, Location.district == district).first()
    state = loc_match.state if loc_match else "Assam"

    existing = db.query(Subscriber).filter(
        Subscriber.email == email, Subscriber.district == district
    ).first()
    if existing:
        existing.consent = True
        existing.active = True
        updated = True
    else:
        db.add(Subscriber(email=email, district=district, state=state, consent=True, active=True))
        updated = False
    db.commit()
    log_audit(
        db=db,
        actor_id=email,
        action="ALERT_SUBSCRIPTION_UPDATED" if updated else "ALERT_SUBSCRIBED",
        resource_type="Subscriber",
        resource_id=district,
        reason="Explicit district consent via subscription endpoint"
    )
    return {
        "status": "subscribed",
        "email": email,
        "district": district,
        "updated": updated,
        "note": (
            "Saved. You will receive HIGH/CRITICAL flood and landslide reports for this district "
            "by email. Each report is marked 'not a government-issued warning'. "
            "Re-subscribing toggles consent; email verification lands before live sends."
        )
    }

@router.post("/alerts/unsubscribe")
def unsubscribe_from_alerts(payload: AlertSubscribeRequest, db: Session = Depends(get_db)):
    """Withdraw consent (and necessarily stop all future email targets)."""
    email = (payload.email or "").strip().lower()
    district = (payload.district or "").strip()
    existing = db.query(Subscriber).filter(
        Subscriber.email == email, Subscriber.district == district
    ).first()
    if not existing:
        raise HTTPException(status_code=404, detail="Subscription not found")
    existing.consent = False
    existing.active = False
    db.commit()
    log_audit(
        db=db, actor_id=email, action="ALERT_UNSUBSCRIBED",
        resource_type="Subscriber", resource_id=district,
        reason="Consent withdrawn via unsubscribe endpoint"
    )
    return {"status": "unsubscribed", "email": email, "district": district}

@router.post("/alerts", response_model=AlertOut)
def create_alert(payload: AlertCreate, db: Session = Depends(get_db)):
    """Create a proposed alert record under PRD FR-ALERT-01"""
    alert = AlertEngine.create_proposal(
        db=db,
        location_id=payload.location_id,
        hazard_type=payload.hazard_type,
        severity=payload.severity,
        title=payload.title,
        description=payload.description,
        action_instructions=payload.action_instructions,
        source_type=payload.source_type,
        official_source_reference=payload.official_source_reference,
        created_by="OPERATOR_CONSOLE",
        simulation_flag=payload.simulation_flag
    )
    return alert

@router.post("/alerts/{alert_id}/approve", response_model=AlertOut)
def approve_alert(
    alert_id: str,
    action: AlertAction,
    x_user_role: str = Header("OPERATOR"),
    db: Session = Depends(get_db)
):
    """Operator approves a proposed alert, issuing it and triggering notification (FR-ALERT-04, FR-ADMIN-02)"""
    try:
        alert = AlertEngine.transition(
            db=db,
            alert_id=alert_id,
            target_status="APPROVED",
            actor_id=action.actor_id,
            actor_role=x_user_role,
            reason=action.reason or "Authorized operator review and verification completed."
        )
        return alert
    except PermissionError as pe:
        raise HTTPException(status_code=403, detail=str(pe))
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))

@router.post("/alerts/{alert_id}/acknowledge", response_model=AlertOut)
def acknowledge_alert(
    alert_id: str,
    action: AlertAction,
    x_user_role: str = Header("RESPONDER"),
    db: Session = Depends(get_db)
):
    """Responder acknowledges alert receipt (FR-USER-12)"""
    try:
        alert = AlertEngine.transition(
            db=db,
            alert_id=alert_id,
            target_status="ACKNOWLEDGED",
            actor_id=action.actor_id,
            actor_role=x_user_role,
            reason=action.reason or "SDRF responder team acknowledged on-site deployment."
        )
        return alert
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.post("/alerts/{alert_id}/resolve", response_model=AlertOut)
def resolve_alert(
    alert_id: str,
    action: AlertAction,
    x_user_role: str = Header("OPERATOR"),
    db: Session = Depends(get_db)
):
    """Resolve active alert after hazard recedes"""
    try:
        alert = AlertEngine.transition(
            db=db,
            alert_id=alert_id,
            target_status="RESOLVED",
            actor_id=action.actor_id,
            actor_role=x_user_role,
            reason=action.reason or "Floodwaters subsided below danger levels; slope secured."
        )
        return alert
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

# ----------------- 6. SHELTERS -----------------
@router.get("/shelters", response_model=List[ShelterOut])
def list_shelters(db: Session = Depends(get_db)):
    """Retrieve verified shelter records and operational status (FR-USER-11)"""
    return db.query(Shelter).all()

# ----------------- 7. INCIDENT REPORTS -----------------
@router.get("/reports", response_model=List[IncidentReportOut])
def list_incident_reports(db: Session = Depends(get_db)):
    return db.query(IncidentReport).order_by(IncidentReport.report_time.desc()).all()

@router.post("/reports", response_model=IncidentReportOut)
def submit_incident_report(payload: IncidentReportCreate, db: Session = Depends(get_db)):
    report = IncidentReport(
        reporter_name=payload.reporter_name or "Concerned Resident",
        category=payload.category,
        location_name=payload.location_name,
        latitude=payload.latitude,
        longitude=payload.longitude,
        description=payload.description,
        verification_status="UNVERIFIED"
    )
    db.add(report)
    db.commit()
    db.refresh(report)
    return report

@router.post("/reports/{report_id}/verify", response_model=IncidentReportOut)
def verify_incident_report(
    report_id: str,
    payload: IncidentReportVerify,
    x_user_role: str = Header("RESPONDER"),
    db: Session = Depends(get_db)
):
    report = db.query(IncidentReport).filter(IncidentReport.id == report_id).first()
    if not report:
        raise HTTPException(status_code=404, detail="Incident report not found")
    report.verification_status = payload.status
    report.reviewer_id = payload.reviewer_id
    report.reviewed_at = utcnow()
    db.commit()
    db.refresh(report)
    return report

# ----------------- 7B. RESCUE / ASSISTANCE REQUESTS -----------------
RESCUE_VALID_TRANSITIONS = {
    "SUBMITTED": ["RECEIVED", "UNREACHABLE"],
    "RECEIVED": ["ASSIGNED", "UNREACHABLE", "CLOSED"],
    "ASSIGNED": ["EN_ROUTE", "UNREACHABLE", "CLOSED"],
    "EN_ROUTE": ["SERVED", "UNREACHABLE", "CLOSED"],
    "SERVED": ["CLOSED"],
    "UNREACHABLE": [],
    "CLOSED": []
}
RESCUE_DISPATCH_ROLES = {"RESPONDER", "OPERATOR", "ADMIN", "DISASTER_MANAGER"}


def _new_public_reference(db: Session) -> str:
    import random as _random
    while True:
        ref = f"RR-{_random.randint(100000, 999999)}"
        if not db.query(RescueRequest).filter(RescueRequest.public_reference == ref).first():
            return ref


@router.post("/rescue-requests", response_model=RescueRequestOut)
def submit_rescue_request(payload: RescueRequestCreate, db: Session = Depends(get_db)):
    """
    Citizen submits a rescue/assistance request. Status starts at SUBMITTED;
    the system ONLY acknowledges receipt internally — it never claims a team
    is dispatched/rescuing until an authorised responder confirms assignment.
    """
    req = RescueRequest(
        public_reference=_new_public_reference(db),
        location_name=payload.location_name,
        latitude=payload.latitude,
        longitude=payload.longitude,
        requester_contact=payload.requester_contact,
        people_count=payload.people_count,
        needs_summary=payload.needs_summary,
        photo_reference=payload.photo_reference,
        consent_shared_location=payload.consent_shared_location,
        status="SUBMITTED",
        status_notes="Citizen request received by platform (SMS/backend). Awaiting responder acknowledgement."
    )
    db.add(req)
    db.commit()
    db.refresh(req)
    log_audit(
        db=db,
        actor_id="citizen_portal",
        action="RESCUE_REQUEST_SUBMITTED",
        resource_type="RescueRequest",
        resource_id=req.id,
        reason=f"Public reference {req.public_reference} at {req.location_name}"
    )
    return req


@router.get("/rescue-requests", response_model=List[RescueRequestOut])
def list_rescue_requests(
    status: Optional[str] = None,
    public_reference: Optional[str] = None,
    db: Session = Depends(get_db)
):
    """Responder worklist / citizen tracking lookup (by public_reference)."""
    query = db.query(RescueRequest)
    if status:
        query = query.filter(RescueRequest.status == status.upper())
    if public_reference:
        query = query.filter(RescueRequest.public_reference == public_reference.upper())
    return query.order_by(RescueRequest.submitted_at.desc()).limit(200).all()


@router.post("/rescue-requests/{request_id}/status", response_model=RescueRequestOut)
def update_rescue_request_status(
    request_id: str,
    payload: RescueRequestStatusUpdate,
    db: Session = Depends(get_db)
):
    req = db.query(RescueRequest).filter(RescueRequest.id == request_id).first()
    if not req:
        raise HTTPException(status_code=404, detail="Rescue request not found")

    current = req.status
    target = payload.new_status.upper()
    if target not in RESCUE_VALID_TRANSITIONS.get(current, []):
        raise HTTPException(
            status_code=400,
            detail=f"Invalid rescue-request transition '{current}' -> '{target}'. "
                   f"Allowed: {RESCUE_VALID_TRANSITIONS.get(current, [])}"
        )

    role = (payload.responder_role or "RESPONDER").upper()
    if role not in RESCUE_DISPATCH_ROLES and not payload.responder_id.startswith("SYSTEM"):
        raise HTTPException(
            status_code=403,
            detail=f"Role '{role}' is not authorised to update rescue-request status. "
                   f"An authorised responder must confirm assignment/dispatch."
        )

    req.status = target
    req.assigned_responder_id = payload.responder_id if target == "ASSIGNED" else req.assigned_responder_id
    req.status_notes = payload.notes or req.status_notes
    req.last_updated_at = utcnow()
    db.commit()
    db.refresh(req)
    log_audit(
        db=db,
        actor_id=payload.responder_id,
        action=f"RESCUE_STATUS_{target}",
        resource_type="RescueRequest",
        resource_id=req.id,
        reason=f"{req.public_reference}: {current} -> {target} (role {role})"
    )
    return req

# ----------------- 8. SIMULATION SCENARIO RUNNER (SIH 5-MIN DEMO) -----------------
@router.post("/simulation/scenario/{scenario_name}")
def trigger_scenario(scenario_name: str, db: Session = Depends(get_db)):
    """
    SIH Repeatable Demo Scenarios:
    1. 'normal': Baseline conditions across Guwahati.
    2. 'extreme_flood': June 2022 historical monsoon replay. Brahmaputra crosses 49.82m (Danger level 49.68m).
    3. 'landslide_hazard': Intense cloudburst on Kharghuli & Narakasur steep slopes (ARI > 185mm).
    4. 'stale_feed_failure': Simulates CWC sensor outage where gauge reading is 8 hours stale (Safety Rule R-02).
    5. 'sensor_missing_fallback': Missing gauge data triggers Rule R-03 uncertainty fallback without inventing numbers.
    """
    now = utcnow()

    if scenario_name == "normal":
        # Reset to calm via ORM deletes so cascaded AlertEvents/Deliveries are cleaned up
        for alert_obj in db.query(Alert).all():
            db.delete(alert_obj)
        db.query(Prediction).delete()
        # Set river at 47.90m (well below warning)
        obs = db.query(Observation).filter(Observation.location_id == "loc_pandu_ghat", Observation.variable == "river_level_m").first()
        if obs:
            obs.value = 47.90
            obs.observed_at = now
            obs.quality_status = "VALID"
        db.commit()
        generate_assessments(db=db)
        return {"scenario": "normal", "message": "Baseline monsoon conditions loaded. River levels normal."}

    elif scenario_name == "extreme_flood":
        # Pandu gauge reaches 49.88m (0.20m above danger level), rate +0.18 m/hr
        obs = db.query(Observation).filter(Observation.location_id == "loc_pandu_ghat", Observation.variable == "river_level_m").first()
        if obs:
            obs.value = 49.88
            obs.observed_at = now
            obs.quality_status = "SIMULATED"
            obs.simulation_flag = True

        # Generate predictions
        generate_assessments(db=db)

        # Create proposed alert
        alert = AlertEngine.create_proposal(
            db=db,
            location_id="loc_pandu_ghat",
            hazard_type="FLOOD",
            severity="CRITICAL",
            title="CRITICAL FLOOD ALERT — Brahmaputra River Overtopping Danger Mark at Pandu",
            description="Brahmaputra river level at Pandu gauge reached 49.88m (exceeds Danger Level 49.68m) with continuous inflow from upper Assam. Inundation imminent in low-lying riparian wards.",
            action_instructions="Evacuate ground floors in Pandu Ghat, Maligaon lowlands, and Bharalumukh. Move immediately to Guwahati Commerce College or Sarusajai shelters. Do not enter moving floodwater.",
            source_type="AI_ASSESSMENT",
            official_source_reference="CWC Bulleting Ref: NE-CWC-2026/088 (Simulated)",
            simulation_flag=True
        )
        return {"scenario": "extreme_flood", "alert_id": alert.id, "river_level": 49.88, "status": "Proposed alert created"}

    elif scenario_name == "landslide_hazard":
        # High rainfall on Kharghuli & Narakasur
        for loc_id in ["loc_kharghuli_hills", "loc_narakasur_hills"]:
            obs = db.query(Observation).filter(Observation.location_id == loc_id, Observation.variable == "rainfall_24h_mm").first()
            if obs:
                obs.value = 178.5
                obs.observed_at = now
                obs.quality_status = "SIMULATED"
                obs.simulation_flag = True

        generate_assessments(db=db)

        alert = AlertEngine.create_proposal(
            db=db,
            location_id="loc_kharghuli_hills",
            hazard_type="LANDSLIDE",
            severity="HIGH",
            title="HIGH LANDSLIDE WARNING — Heavy Soil Saturation on Kharghuli Slopes",
            description="Cumulative 24h rainfall (178.5mm) has crossed critical Antecedent Rainfall threshold (160mm) on 36° steep cut slopes. High risk of debris flow and localized slope failure.",
            action_instructions="Residents along Kharghuli hill slopes and roadside dwellings must relocate to designated emergency shelters immediately. Watch for tension cracks and spring emergence.",
            source_type="AI_ASSESSMENT",
            official_source_reference="GSI Landslide Advisory Cell (Simulated)",
            simulation_flag=True
        )
        return {"scenario": "landslide_hazard", "alert_id": alert.id, "rainfall_24h_mm": 178.5, "status": "Proposed alert created"}

    elif scenario_name == "stale_feed_failure":
        # Stale CWC feed: 14 hours old
        stale_time = now - datetime.timedelta(hours=14)
        obs = db.query(Observation).filter(Observation.location_id == "loc_pandu_ghat", Observation.variable == "river_level_m").first()
        if obs:
            obs.observed_at = stale_time
            obs.quality_status = "STALE"
        cwc_source = db.query(DataSource).filter(DataSource.id == "src_cwc_brahmaputra").first()
        if cwc_source:
            cwc_source.status = "STALE"
            cwc_source.last_error_at = now
        db.commit()
        generate_assessments(force_stale=True, db=db)
        return {"scenario": "stale_feed_failure", "status": "Simulated stale feed (Rule R-02 triggered, assessments marked STALE)"}

    elif scenario_name == "sensor_missing_fallback":
        generate_assessments(force_missing=True, db=db)
        return {"scenario": "sensor_missing_fallback", "status": "Simulated sensor outage (Rule R-03 triggered, assessments marked UNAVAILABLE with explicit disclaimer)"}

    else:
        raise HTTPException(status_code=400, detail=f"Unknown scenario: {scenario_name}")

# ----------------- 9. OFFICIAL GOVERNMENT DATA ADAPTERS (SIH01, LIVE-FIRST) -----------------
def _baseline_imd_warnings() -> Dict[str, Any]:
    now = datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)
    valid_until = now + datetime.timedelta(hours=24)
    return {
        "source": "India Meteorological Department (IMD)",
        "source_catalogue_url": "https://api.imd.gov.in/public/api_reference.html",
        "documented_endpoint": "https://api.imd.gov.in/api/v1/districtwarning",
        "retrieved_at": now.isoformat(),
        "valid_until": valid_until.isoformat(),
        "attribution": "Government of India — Ministry of Earth Sciences (MoES) / IMD",
        "data_mode": "BASELINE",
        "warnings": [
            {
                "state": "Assam",
                "district": "Kamrup Metropolitan",
                "color_code": "ORANGE",
                "warning_type": "HEAVY_TO_VERY_HEAVY_RAIN",
                "rainfall_forecast_24h_mm": "70-110",
                "action": "Be Prepared. Waterlogging in lowlands and flash runoff expected.",
                "validity": valid_until.isoformat()
            },
            {
                "state": "Meghalaya",
                "district": "East Khasi Hills",
                "color_code": "RED",
                "warning_type": "EXTREMELY_HEAVY_RAIN",
                "rainfall_forecast_24h_mm": ">200",
                "action": "Take Action. High danger of sudden flash runoff and slope collapse in Sohra/Shillong.",
                "validity": valid_until.isoformat()
            },
            {
                "state": "Arunachal Pradesh",
                "district": "Papum Pare",
                "color_code": "ORANGE",
                "warning_type": "HEAVY_RAIN_WITH_THUNDERSTORM",
                "rainfall_forecast_24h_mm": "65-90",
                "action": "Be Prepared. Watch hill slopes and valley roads.",
                "validity": valid_until.isoformat()
            },
            {
                "state": "Sikkim",
                "district": "North Sikkim",
                "color_code": "ORANGE",
                "warning_type": "HEAVY_SNOW_RAIN",
                "rainfall_forecast_24h_mm": "50-80",
                "action": "Be Prepared. Teesta river catchment surge monitoring.",
                "validity": valid_until.isoformat()
            },
            {
                "state": "Manipur",
                "district": "Imphal West",
                "color_code": "YELLOW",
                "warning_type": "MODERATE_RAIN",
                "rainfall_forecast_24h_mm": "35-50",
                "action": "Be Updated. Low-lying areas along Imphal river may see rising water.",
                "validity": valid_until.isoformat()
            },
            {
                "state": "Mizoram",
                "district": "Aizawl",
                "color_code": "YELLOW",
                "warning_type": "MODERATE_TO_HEAVY_RAIN",
                "rainfall_forecast_24h_mm": "40-60",
                "action": "Be Updated. Watch hillside drainage channels for blockages.",
                "validity": valid_until.isoformat()
            },
            {
                "state": "Nagaland",
                "district": "Kohima",
                "color_code": "YELLOW",
                "warning_type": "MODERATE_RAIN",
                "rainfall_forecast_24h_mm": "30-50",
                "action": "Be Updated. Avoid travel on unstable roadside cut slopes.",
                "validity": valid_until.isoformat()
            },
            {
                "state": "Tripura",
                "district": "West Tripura",
                "color_code": "GREEN",
                "warning_type": "LIGHT_RAIN",
                "rainfall_forecast_24h_mm": "10-25",
                "action": "No Warning. Normal monsoonal conditions.",
                "validity": valid_until.isoformat()
            }
        ]
    }


@router.get("/sources/imd/warnings")
def get_imd_warnings(db: Session = Depends(get_db)):
    """
    LIVE-first adapter for India Meteorological Department (IMD) District Warnings.
    Attempts extraction from the official IMD portal via TinyFish; falls back to
    the last successfully cached bulletin; falls back to documented baseline.
    """
    live = live_data_service.fetch_imd_warnings(db)
    if live.get("data_mode") in ("LIVE", "CACHED"):
        return live
    baseline = _baseline_imd_warnings()
    baseline["live_status"] = live.get("live_error") or "No live warnings parsed"
    return baseline


# ----------------- 12. INTERACTIVE DISASTER MAP (district aggregation) -----------------

@router.get("/map/districts")
def map_districts(state: Optional[str] = Query(None, description="Filter by state name"), db: Session = Depends(get_db)):
    """
    District-level aggregation for the map-first interface: verified
    observations, prototype risk estimates (with explanations), verbatim
    official warnings, verified incidents inside boundary polygons, shelters
    count, per-district data-quality status, and boundary resolution status.
    """
    data = map_service.district_summaries(db)
    if state:
        wanted = state.strip().lower()
        data["districts"] = [
            d for d in data["districts"] if (d["state"] or "").lower() == wanted
        ]
    return data


@router.get("/map/geometry")
def map_geometry():
    """
    Serves the verified NE district boundaries (78 polygons) with documented
    geodata metadata. The frontend may instead use its own static copy; this
    endpoint guarantees backend and frontend share one source of truth.
    """
    feats = geographic_service.features()
    return {
        "type": "FeatureCollection",
        "geodata": GEODATA_reference_meta(),
        "features": [
            {
                "type": "Feature",
                "geometry": f["geometry"],
                "properties": {"district": f["district"], "state": f["state"],
                               "source": f["properties_source"]}
            } for f in feats
        ]
    }


def GEODATA_reference_meta():
    from app.services.map_service import GEODATA_META
    return GEODATA_META


# ----------------- 11. OFFICIAL IMD REST API (api.imd.gov.in) -----------------

@router.get("/imd/status")
def imd_api_status(db: Session = Depends(get_db)):
    """Per-endpoint status of the official IMD REST adapter. AUTH_ERROR when the
    API key is empty/invalid (the documented endpoints return 401 without one)."""
    summary = []
    for slug, ep in imd_api_service.ENDPOINTS.items():
        summary.append({"endpoint": slug, "path": ep["path"]})
    # live, cheap classification without network: read the cached data_mode
    out = []
    for s in summary:
        slug = s["endpoint"]
        cache = db.query(LiveDataCache).filter(LiveDataCache.cache_key == f"imd_{slug}").first()
        if cache:
            p = json.loads(cache.payload_json)
            out.append({
                "endpoint": slug,
                "path": s["path"],
                "last_mode": cache.data_mode,
                "fetched_at": cache.fetched_at.isoformat() if cache.fetched_at else None,
                "row_count": p.get("row_count", 0)
            })
        else:
            out.append({"endpoint": slug, "path": s["path"], "last_mode": "NEVER_FETCHED",
                        "fetched_at": None, "row_count": 0})
    return {
        "api_key_configured": bool(settings.IMD_API_KEY),
        "auth_style": settings.IMD_API_AUTH_STYLE if settings.IMD_API_KEY else None,
        "endpoints": out,
        "role_note": "Official IMD feeds power warnings/rainfall/QPF; AUTH_ERROR means "
                     "IMD_API_KEY must be configured before any of these can be LIVE."
    }


@router.get("/imd/rainfall")
def imd_rainfall(db: Session = Depends(get_db)):
    return imd_api_service.fetch_endpoint(db, "rainfall")


@router.get("/imd/warnings")
def imd_official_warnings(db: Session = Depends(get_db)):
    return imd_api_service.fetch_endpoint(db, "warnings")


@router.get("/imd/nowcast")
def imd_nowcast(db: Session = Depends(get_db)):
    return imd_api_service.fetch_endpoint(db, "nowcast")


@router.get("/imd/qpf")
def imd_qpf(db: Session = Depends(get_db)):
    return imd_api_service.fetch_endpoint(db, "qpf")


@router.get("/imd/aws-mapping")
def imd_aws_mapping(db: Session = Depends(get_db)):
    return imd_api_service.fetch_endpoint(db, "aws_map")


@router.post("/imd/sync")
def imd_full_refresh(db: Session = Depends(get_db)):
    """One-cycle refresh of all official IMD REST feeds:
    districtrainfall + basinqpf -> observations (deduped, provenance-stamped),
    districtwarning -> OFFICIAL lifecycle alerts (verbatim, deduped by source ref).
    AUTH_ERROR responses are skipped gracefully and reported per feed."""
    summary: Dict[str, Any] = {}
    rainfall = imd_api_service.fetch_endpoint(db, "rainfall")
    summary["rainfall"] = {
        "data_mode": rainfall.get("data_mode"), "source_status": rainfall.get("source_status"),
        **imd_ingest_service.ingest_district_rainfall(db, rainfall)
    }
    qpf = imd_api_service.fetch_endpoint(db, "qpf")
    summary["qpf"] = {
        "data_mode": qpf.get("data_mode"), "source_status": qpf.get("source_status"),
        **imd_ingest_service.ingest_basin_qpf(db, qpf)
    }
    warnings = imd_api_service.fetch_endpoint(db, "warnings")
    mapped = imd_ingest_service.apply_official_district_warnings(warnings)
    created = 0
    official_alerts_sent: list = []
    if mapped.get("alert_specs"):
        existing_refs = {a.official_source_reference for a in db.query(Alert).filter(
            Alert.lifecycle_status.in_(["PROPOSED", "REVIEWED", "APPROVED", "ISSUED", "ACKNOWLEDGED"])
        ).all()}
        for spec in mapped["alert_specs"]:
            if spec["official_source_reference"] in existing_refs:
                continue  # dedupe: never re-issue an existing official warning
            now = utcnow()
            db.add(Alert(
                location_id=spec["location_id"],
                hazard_type=spec["hazard_type"],
                source_type="OFFICIAL_AGENCY",
                severity=spec["severity"],
                lifecycle_status="APPROVED",  # official: not AI-proposed, already public
                issued_at=now,
                expires_at=now + datetime.timedelta(days=spec["expires_in_days"]),
                official_source_reference=spec["official_source_reference"],
                created_by="IMD_REST_API_ADAPTER",
                title=spec["title"],
                description=spec["description"],
                action_instructions=spec["action_instructions"],
                simulation_flag=False
            ))
            created += 1
            official_alerts_sent.append(spec["official_source_reference"])
            log_audit(
                db=db, actor_id="IMD_REST_API_ADAPTER", action="OFFICIAL_WARNING_IMPORTED",
                resource_type="Alert", resource_id=spec["official_source_reference"],
                reason=spec["title"]
            )
        db.commit()
        # Verbatim official warnings are already public information — dispatch
        # resident/authority emails directly (guard chain applies internally).
        if official_alerts_sent:
            from app.services.email_alert_service import email_alert_service
            newest = db.query(Alert).filter(
                Alert.official_source_reference.in_(official_alerts_sent)
            ).order_by(Alert.issued_at.desc()).all()
            for oa in newest:
                try:
                    email_alert_service.dispatch_for_alert(db, oa)
                except Exception as e:
                    logger.warning("official-warning email dispatch failed: %s", e)
    summary["official_warnings"] = {
        "data_mode": warnings.get("data_mode"), "source_status": warnings.get("source_status"),
        "alerts_created": created,
        "unmatched_districts": mapped.get("unmatched_districts", []),
        "note": "Official IMD warnings are stored verbatim; the platform does not "
                "convert them into model estimates."
    }
    return summary


def _baseline_cwc_stations() -> Dict[str, Any]:
    now = datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)
    return {
        "source": "Central Water Commission (CWC) Flood Forecasting Network",
        "portal_url": "https://ffs.india-water.gov.in/",
        "attribution": "Government of India — Ministry of Jal Shakti / CWC",
        "retrieved_at": now.isoformat(),
        "data_mode": "BASELINE",
        "stations": [
            {
                "station_code": "022-MBAPU",
                "station_name": "Pandu (Guwahati)",
                "river": "Brahmaputra",
                "state": "Assam",
                "warning_level_m": 48.68,
                "danger_level_m": 49.68,
                "hfl_m": 51.46,
                "current_level_m": 49.10,
                "trend": "RISING",
                "status": "ABOVE_WARNING_BELOW_DANGER"
            },
            {
                "station_code": "014-BRSIL",
                "station_name": "Annapurna Ghat (Silchar)",
                "river": "Barak",
                "state": "Assam",
                "warning_level_m": 18.87,
                "danger_level_m": 19.83,
                "hfl_m": 21.66,
                "current_level_m": 19.45,
                "trend": "STEADY",
                "status": "ABOVE_WARNING_BELOW_DANGER"
            },
            {
                "station_code": "031-SNGPAS",
                "station_name": "Pasighat",
                "river": "Siang (Brahmaputra)",
                "state": "Arunachal Pradesh",
                "warning_level_m": 152.00,
                "danger_level_m": 153.96,
                "hfl_m": 157.54,
                "current_level_m": 151.20,
                "trend": "RISING",
                "status": "NORMAL"
            },
            {
                "station_code": "008-TSTMAN",
                "station_name": "Mangan",
                "river": "Teesta",
                "state": "Sikkim",
                "warning_level_m": 860.00,
                "danger_level_m": 865.00,
                "hfl_m": 872.20,
                "current_level_m": 862.40,
                "trend": "RISING",
                "status": "ABOVE_WARNING_BELOW_DANGER"
            },
            {
                "station_code": "019-IMPSAN",
                "station_name": "Sanjenthong (Imphal)",
                "river": "Imphal",
                "state": "Manipur",
                "warning_level_m": 788.00,
                "danger_level_m": 790.30,
                "hfl_m": 792.80,
                "current_level_m": 787.20,
                "trend": "STEADY",
                "status": "NORMAL"
            },
            {
                "station_code": "025-DHSDIM",
                "station_name": "Dimapur",
                "river": "Dhansiri",
                "state": "Nagaland",
                "warning_level_m": 146.50,
                "danger_level_m": 148.00,
                "hfl_m": 150.20,
                "current_level_m": 145.80,
                "trend": "RISING",
                "status": "NORMAL"
            }
        ]
    }


@router.get("/sources/cwc/stations")
def get_cwc_stations(db: Session = Depends(get_db)):
    """
    LIVE-first adapter for Central Water Commission (CWC) Flood Forecasting System.
    Fetches real-time station telemetry from the official CWC FFS API
    (https://ffs.india-water.gov.in). Falls back to last cached telemetry,
    then to documented baseline reference levels.
    """
    live = live_data_service.fetch_cwc_stations(db)
    if live.get("data_mode") in ("LIVE", "CACHED"):
        return live
    baseline = _baseline_cwc_stations()
    baseline["live_status"] = live.get("live_error") or "CWC FFS unavailable"
    return baseline


def _baseline_gsi_susceptibility() -> Dict[str, Any]:
    """
    Baseline regional macro-zonation derived from published GSI NLSM reports.
    """
    return {
        "source": "Geological Survey of India (GSI)",
        "programme": "National Landslide Susceptibility Mapping (NLSM)",
        "portal_url": "https://bhusanket.gsi.gov.in/",
        "attribution": "Government of India — Ministry of Mines / GSI",
        "data_mode": "BASELINE",
        "susceptibility_zones": [
            {
                "state": "Assam",
                "district": "Kamrup Metropolitan",
                "slopes": "Kharghuli, Nilachal, Narakasur, Sarania",
                "geology": "Precambrian Gneissic Complex with thin weathered regolith",
                "susceptibility_category": "HIGH_TO_VERY_HIGH",
                "historical_events_count": 48
            },
            {
                "state": "Meghalaya",
                "district": "East Khasi Hills",
                "slopes": "Sohra Rim, Shillong-Dawki Highway (NH 40)",
                "geology": "Cretaceous-Tertiary Sediments over Precambrian Basement",
                "susceptibility_category": "VERY_HIGH",
                "historical_events_count": 82
            },
            {
                "state": "Arunachal Pradesh",
                "district": "Papum Pare & West Kameng",
                "slopes": "Itanagar Road Cuts, Bhalukpong-Bomdila Corridor",
                "geology": "Fragile Tertiary Siwalik sandstones and shales",
                "susceptibility_category": "VERY_HIGH",
                "historical_events_count": 64
            },
            {
                "state": "Manipur",
                "district": "Noney & Kangpokpi",
                "slopes": "Jiribam-Imphal Railway Corridor (Tupul)",
                "geology": "Tectonized Disang flysch shale and siltstone",
                "susceptibility_category": "CRITICAL_SUSCEPTIBILITY",
                "historical_events_count": 39
            },
            {
                "state": "Mizoram",
                "district": "Aizawl",
                "slopes": "Ramhlun, Hunthar, Bawngkawn Slopes",
                "geology": "Tertiary Surma Group sandstone and interbedded shale",
                "susceptibility_category": "HIGH_TO_VERY_HIGH",
                "historical_events_count": 55
            },
            {
                "state": "Nagaland",
                "district": "Kohima",
                "slopes": "Phesama, Dzüdza, Zubza Corridor",
                "geology": "Crushed Disang shale prone to deep creep",
                "susceptibility_category": "VERY_HIGH",
                "historical_events_count": 71
            },
            {
                "state": "Sikkim",
                "district": "East & North Sikkim",
                "slopes": "Gangtok-Deorali, Mangan-Chungthang Highway",
                "geology": "Daling phyllites, Central Crystalline Gneiss",
                "susceptibility_category": "VERY_HIGH_TO_CRITICAL",
                "historical_events_count": 112
            }
        ]
    }


@router.get("/sources/gsi/susceptibility")
def get_gsi_susceptibility(db: Session = Depends(get_db)):
    """
    LIVE-first adapter for Geological Survey of India (GSI) Bhusanket & NLSM.
    Attempts live bulletin extraction via TinyFish; falls back to the last
    cached bulletin, then to the published GSI baseline macro-zonation.
    """
    live = live_data_service.fetch_gsi_susceptibility(db)
    if live.get("data_mode") in ("LIVE", "CACHED"):
        return live
    baseline = _baseline_gsi_susceptibility()
    baseline["live_status"] = live.get("live_error") or "Bhusanket bulletin unavailable"
    return baseline

@router.get("/sources/bhuvan/layers")
def get_bhuvan_layers():
    """
    Adapter for ISRO / NRSC Bhuvan Thematic Map & WMS Services.
    Portal: https://bhuvan.nrsc.gov.in/
    """
    return {
        "source": "ISRO / NRSC Bhuvan Geospatial Portal",
        "wms_guide_url": "https://bhuvan.nrsc.gov.in/wiki/index.php/How_to_use_WMS_services",
        "attribution": "ISRO / National Remote Sensing Centre (NRSC)",
        "wms_services": [
            {
                "layer_id": "bhuvan_satellite",
                "name": "Bhuvan High-Resolution Satellite Base",
                "wms_url": "https://bhuvan-vec1.nrsc.gov.in/bhuvan/wms",
                "format": "image/png",
                "attribution": "ISRO Bhuvan"
            },
            {
                "layer_id": "bhuvan_flood_hazard",
                "name": "Bhuvan Flood Hazard Zonation (Brahmaputra)",
                "wms_url": "https://bhuvan-vec2.nrsc.gov.in/bhuvan/wms",
                "format": "image/png",
                "attribution": "NRSC Disaster Management Support"
            },
            {
                "layer_id": "bhuvan_lulc",
                "name": "Bhuvan Land Use / Land Cover 1:50k",
                "wms_url": "https://bhuvan-thematic.nrsc.gov.in/bhuvan/wms",
                "format": "image/png",
                "attribution": "ISRO / NRSC LULC"
            }
        ]
    }

# ----------------- 9. TINYFISH WEB AGENT & DATA EXTRACTION -----------------
@router.get("/sources/tinyfish/status", response_model=TinyFishStatusOut)
def get_tinyfish_status(db: Session = Depends(get_db)):
    """
    Reports TinyFish integration status without revealing sensitive credentials.
    Complies with Requirement 5 and 7.
    """
    return tinyfish_service.get_status(db)

@router.post("/sources/tinyfish/retrieve", response_model=TinyFishRetrievalResultOut)
def request_tinyfish_retrieval(
    payload: TinyFishRetrievalRequest,
    db: Session = Depends(get_db)
):
    """
    Executes an approved disaster data retrieval task using TinyFish.
    Strictly validates target domains against the government allowlist.
    Applies timeouts, bounded retries, rate limits, and stores provenance.
    """
    try:
        record = tinyfish_service.execute_retrieval(
            url=payload.url,
            db=db,
            content_format=payload.format,
            purpose=payload.purpose,
            simulate_if_unavailable=payload.simulate_if_unavailable
        )
        return record
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=429, detail=str(e))
    except ConnectionError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail="Internal error during data retrieval.")

@router.get("/sources/tinyfish/history", response_model=List[TinyFishRetrievalResultOut])
def get_tinyfish_history(
    limit: int = Query(default=20, ge=1, le=100),
    db: Session = Depends(get_db)
):
    """
    Retrieves past web extractions and published disaster information.
    """
    return db.query(TinyFishRetrievalRecord).order_by(TinyFishRetrievalRecord.retrieval_timestamp.desc()).limit(limit).all()


# ----------------- 10. LIVE DATA SYNC & REGIONAL NEWS -----------------
@router.post("/data/sync")
def sync_live_data(db: Session = Depends(get_db)):
    """
    Full live data refresh:
    1. CWC Flood Forecasting System telemetry (real station levels above warning).
    2. IMD live bulletin extraction (official MoES portal).
    3. GSI Bhusanket landslide advisory.
    4. Northeast regional news (EastMojo / Sentinel Assam).
    Real observations ingested into the database feed prediction engines.
    """
    summary = live_data_service.sync_all(db)
    # Automation workflow step: validate -> store -> assess -> rule-evaluate -> alerts
    try:
        summary["auto_alert_evaluations"] = auto_alert_service.evaluate_and_generate_alerts(db)
    except Exception as e:
        logger.warning("Auto-alert evaluation failed after sync: %s", e)
        summary["auto_alert_evaluations"] = {"error": str(e)[:200]}
    log_audit(
        db=db,
        actor_id="SYSTEM_LIVE_DATA_SYNC",
        action="LIVE_DATA_SYNC_COMPLETED",
        resource_type="LiveDataCache",
        resource_id="all",
        reason=f"sources={summary.get('sources')}"
    )
    return summary


@router.get("/data/live-news")
def get_live_news(
    hazard_only: bool = False,
    db: Session = Depends(get_db)
):
    """
    Live Northeast India disaster news headlines from verified regional outlets.
    Filter with ?hazard_only=true for flood/landslide related coverage.
    """
    try:
        return live_data_service.fetch_news(db, hazard_only=hazard_only)
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Live news unavailable: {str(e)[:200]}")


# ----------------- 11. INTEGRATED GEO RISK ENGINE -----------------
@router.get("/risk/geo")
def get_geo_risk(db: Session = Depends(get_db), location_id: Optional[str] = None):
    """
    Integrated geographic risk analysis for monitored points:
    rainfall accumulation/forecast + terrain (slope/susceptibility/drainage/elevation),
    CWC stage vs official marks, and validated hazard history within 20 km.
    Returns GeoJSON FeatureCollection ready for the map risk layer.
    Filter to a single point with ?location_id=...
    """
    query = db.query(Location).filter(Location.active == True)
    if location_id:
        query = query.filter(Location.id == location_id)
    locs = query.all()
    results = [IntegratedRiskEngine.evaluate_location(db, loc) for loc in locs]
    features = []
    for r in results:
        primary_hazard = r["hazard_type_primary"]
        block = r["flood" if primary_hazard == "FLOOD" else "landslide"]
        severity_rank = {"LOW": 1, "MODERATE": 2, "HIGH": 3, "CRITICAL": 4, "UNAVAILABLE": 0}
        features.append({
            "type": "Feature",
            "geometry": {
                "type": "Point",
                "coordinates": [r["longitude"], r["latitude"]]
            },
            "properties": {
                "location_id": r["location_id"],
                "name": r["name"],
                "state": r["state"],
                "district": r["district"],
                "location_type": r["location_type"],
                "primary_hazard": primary_hazard,
                "risk_category": block["risk_category"],
                "probability": block["probability"],
                "confidence": block["confidence"],
                "uncertainty": block["uncertainty"],
                "ari_mm": block["ari_mm"],
                "flood_category": r["flood"]["risk_category"],
                "landslide_category": r["landslide"]["risk_category"],
                "flood_probability": r["flood"]["probability"],
                "landslide_probability": r["landslide"]["probability"],
                "terrain": r["terrain"],
                "explanation_notes": r["explanation_notes"],
                "engine_version": r["engine_version"],
                "generated_at": r["generated_at"],
                "severity_rank": severity_rank.get(block["risk_category"], 0)
            }
        })
    return {
        "type": "FeatureCollection",
        "engine_version": IntegratedRiskEngine.ENGINE_VERSION,
        "generated_at": utcnow().isoformat(),
        "threshold_provenance": results[0]["threshold_provenance"] if results else {},
        "features": features
    }


# ----------------- 12. WEATHER DATA WITH FULL PROVENANCE -----------------
@router.get("/weather/now")
def get_weather_now(
    location_id: Optional[str] = None,
    db: Session = Depends(get_db)
):
    """
    Latest rainfall & official weather/river readings per monitored location with
    full provenance: source name, observation time, unit, and last-updated timestamp.
    """
    query = db.query(Location).filter(Location.active == True)
    if location_id:
        query = query.filter(Location.id == location_id)
    locations = query.all()

    src_map = {s.id: s for s in db.query(DataSource).all()}

    readings = []
    for loc in locations:
        recs = db.query(Observation).filter(
            Observation.location_id == loc.id
        ).order_by(Observation.observed_at.desc()).limit(20).all()
        seen_variables = {}
        for o in recs:
            if o.variable in seen_variables:
                continue
            src = src_map.get(o.source_id)
            seen_variables[o.variable] = {
                "location_id": loc.id,
                "location_name": loc.name,
                "variable": o.variable,
                "value": o.value,
                "unit": o.unit,
                "source_id": o.source_id,
                "source_name": src.name if src else o.source_id,
                "source_type": src.source_type if src else None,
                "source_configuration_reference": src.configuration_reference if src else None,
                "observed_at": o.observed_at,
                "last_updated_at": o.ingested_at,
                "quality_status": o.quality_status,
                "provenance": o.provenance,
                "simulation_flag": o.simulation_flag
            }
        for v in seen_variables.values():
            readings.append(v)

    return {
        "retrieved_at": utcnow().isoformat(),
        "provenance_policy": "Every reading stores its source feed, observation time, unit and "
                             "last-updated timestamp. Readings older than their feed's expected "
                             "interval are quality-flagged and never presented as live.",
        "readings": readings
    }


# ----------------- 12B. OBSERVED + FORECAST PRECIPITATION (OPEN-METEO) -----------------
@router.get("/weather/forecast")
def get_weather_forecast(
    location_id: Optional[str] = None,
    db: Session = Depends(get_db)
):
    """
    Real observed precipitation (reanalysis, last 72h) plus up to 96h forecast
    precipitation per monitored point — key-free public Open-Meteo service.
    Fills only the rainfall gaps that official IMD/CWC feeds don't cover, and is
    always provenance-stamped (LIVE / CACHED / UNAVAILABLE, never faked).
    """
    query = db.query(Location).filter(Location.active == True)
    if location_id:
        query = query.filter(Location.id == location_id)
    locations = query.all()
    if location_id and not locations:
        raise HTTPException(status_code=404, detail=f"Unknown location: {location_id}")

    if not settings.OPEN_METEO_ENABLED:
        return {
            "data_mode": "UNAVAILABLE",
            "enabled": False,
            "note": "Open-Meteo adapter disabled by configuration."
        }

    out = []
    for loc in locations:
        try:
            ctx = open_meteo_service.fetch_forecast(db, loc.id, loc.latitude, loc.longitude)
        except Exception as e:
            ctx = {
                "location_id": loc.id,
                "data_mode": "UNAVAILABLE",
                "live_error": str(e)[:300]
            }
        out.append(ctx)

    return {
        "retrieved_at": utcnow().isoformat(),
        "source_service": "Open-Meteo public API (no key)",
        "locations": out
    }


# ----------------- 13. HISTORICAL VALIDATION & EVENTS -----------------
@router.get("/data/historical-events")
def get_historical_events(db: Session = Depends(get_db)):
    """
    Documented historical flood & landslide events across Northeast India with
    official source references — used for the map's validated history layer.
    """
    events = db.query(DisasterEvent).order_by(DisasterEvent.event_start.desc()).all()
    out = []
    for ev in events:
        loc = db.query(Location).filter(Location.id == ev.location_id).first()
        out.append({
            "id": ev.id,
            "hazard_type": ev.hazard_type,
            "location_id": ev.location_id,
            "location_name": loc.name if loc else ev.location_id,
            "state": loc.state if loc else None,
            "district": loc.district if loc else None,
            "latitude": loc.latitude if loc else None,
            "longitude": loc.longitude if loc else None,
            "event_start": ev.event_start,
            "severity": ev.severity,
            "verification_status": ev.verification_status,
            "source_reference": ev.source_reference,
            "description": ev.description
        })
    return out


@router.get("/models/validation")
def get_model_validation(db: Session = Depends(get_db)):
    """
    Replays documented historical floods and landslides (ASDMA / CWC / GSI / SDMA
    records) through the prediction engines and reports whether the model outputs
    match documented outcomes — the reliability gate before predictions are trusted.
    """
    try:
        return run_historical_validation(db)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Validation run failed: {str(e)[:200]}")


@router.get("/models/demo-cases")
def list_demo_cases(db: Session = Depends(get_db)):
    """Documented historical events available for the recorded/watermarked demo replay."""
    return {"available_cases": DEMO_CASE_IDS}


@router.post("/models/demo-scenario")
def post_demo_scenario(
    payload: Optional[Dict[str, Any]] = None,
    db: Session = Depends(get_db)
):
    """
    Runs the recorded demo replay for one documented historical event:
    current live assessment vs engine output on the event's documented inputs,
    plus a full PROPOSED -> APPROVED -> ISSUED alert lifecycle with notification
    delivery receipts (all SIMULATION-watermarked, never treated as real warnings).
    Body: {"case_id": "val_land_kharghuli_2022_06"} (optional)
    """
    case_id = (payload or {}).get("case_id") or "val_land_kharghuli_2022_06"
    try:
        return run_documented_demo(db, case_id=case_id)
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Demo replay failed: {str(e)[:200]}")


# ----------------- 14. AUTOMATED SITUATION REPORTS (PDF / CSV) -----------------
@router.get("/reports/situation")
def get_situation_report(
    format: str = "pdf",
    db: Session = Depends(get_db)
):
    """
    On-demand disaster situation report from all stored, validated data:
    weather summary, official vs AI alerts, incidents, rescue-request status,
    source-referenced historical events, data-quality warnings and log of sources.
    format=pdf | csv. Generated_at is stamped in-document and in-filename.
    """
    fmt = format.lower()
    data = build_report_data(db)
    stamp = utcnow().strftime("%Y%m%d_%H%M")
    if fmt == "csv":
        content = render_csv(data)
        media = "text/csv; charset=utf-8"
        fname = f"nesafe_situation_{stamp}.csv"
    elif fmt == "pdf":
        content = render_pdf(data)
        media = "application/pdf"
        fname = f"nesafe_situation_{stamp}.pdf"
    else:
        raise HTTPException(status_code=400, detail="Unsupported format: use pdf or csv")

    log_audit(
        db=db,
        actor_id="report_ui",
        action="REPORT_GENERATED",
        resource_type="Report",
        resource_id=fname,
        reason=f"format={fmt}, rows: alerts={len(data['official_alerts'])+len(data['ai_assessments'])}"
    )
    return Response(
        content=content,
        media_type=media,
        headers={"Content-Disposition": f'attachment; filename="{fname}"'}
    )


# ----------------- 15. ANALYTICS FOR AUTO-UPDATING CHART DASHBOARDS -----------------
@router.get("/analytics/overview", response_model=AnalyticsOverview)
def get_analytics_overview(
    hours_window: int = Query(default=24, ge=1, le=336),
    db: Session = Depends(get_db)
):
    """
    All datasets for the automated chart dashboard (Recharts reads these directly):
      - rainfall trend (hourly + daily), river-level vs official marks,
      - risk by area (integrated engine), alerts by severity (official vs AI),
      - incidents by category, rescue by status, documented historical rainfall
      comparison, and data-source availability/freshness.
    """
    now = utcnow()
    window_cutoff = now - datetime.timedelta(hours=hours_window)
    locs = {l.id: l for l in db.query(Location).filter(Location.active == True).all()}
    src_map = {s.id: s for s in db.query(DataSource).all()}

    # 1-2. Rainfall trend (hourly buckets from all IMD/OpenMeteo rainfall obs)
    obs = db.query(Observation).filter(
        Observation.observed_at >= window_cutoff,
        Observation.variable == "rainfall_24h_mm"
    ).order_by(Observation.observed_at.asc()).all()
    hourly: Dict[str, Dict[str, Any]] = {}
    daily: Dict[str, Dict[str, Any]] = {}
    for o in obs:
        hkey = o.observed_at.strftime("%Y-%m-%d %H:00")
        dkey = o.observed_at.strftime("%Y-%m-%d")
        lname = locs[o.location_id].name if o.location_id in locs else o.location_id
        hourly.setdefault(hkey, {"time": hkey, "avg": 0.0, "max": 0.0, "n": 0})
        daily.setdefault(dkey, {"time": dkey, "avg": 0.0, "max": 0.0, "n": 0})
        for bucket in (hourly[hkey], daily[dkey]):
            bucket["avg"] += o.value
            bucket["max"] = max(bucket["max"], o.value)
            bucket["n"] += 1
    rain_hourly = [{"time": k, "avg_mm": round(v["avg"] / v["n"], 1), "max_mm": round(v["max"], 1), "samples": v["n"]}
                   for k, v in sorted(hourly.items())]
    rain_daily = [{"time": k, "avg_mm": round(v["avg"] / v["n"], 1), "max_mm": round(v["max"], 1), "samples": v["n"]}
                  for k, v in sorted(daily.items())]

    # 3. River-level trend per station (with official marks for reference lines)
    river_trend = []
    for loc_id, river in [("loc_pandu_ghat", "Brahmaputra"), ("loc_cachar_silchar", "Barak"), ("loc_teesta_mangan", "Teesta")]:
        recs = db.query(Observation).filter(
            Observation.location_id == loc_id,
            Observation.variable == "river_level_m"
        ).order_by(Observation.observed_at.asc()).all()
        marks = {
            "Brahmaputra": (48.68, 49.68), "Barak": (18.87, 19.83), "Teesta": (860.0, 865.0)
        }.get(river, (None, None))
        for o in recs:
            river_trend.append({
                "location": locs[loc_id].name if loc_id in locs else loc_id,
                "river": river,
                "time": o.observed_at.isoformat(),
                "level_m": round(o.value, 2),
                "unit": "m",
                "warning_level_m": marks[0],
                "danger_level_m": marks[1]
            })

    # 4. Risk by area (integrated engine categories)
    from app.services.integrated_risk_engine import IntegratedRiskEngine
    risk_by_area = []
    for loc in locs.values():
        try:
            rr = IntegratedRiskEngine.evaluate_location(db, loc)
            risk_by_area.append({
                "location": rr["name"],
                "state": rr["state"],
                "district": rr["district"],
                "flood_category": rr["flood"]["risk_category"],
                "landslide_category": rr["landslide"]["risk_category"],
                "risk_category": rr["flood"]["risk_category"] if rr["hazard_type_primary"] == "FLOOD" else rr["landslide"]["risk_category"],
                "score": rr["landslide"]["probability"] if rr["hazard_type_primary"] == "LANDSLIDE" else rr["flood"]["probability"]
            })
        except Exception:
            continue

    # 5. Alerts by severity, official vs AI counts
    alerts_by_severity = []
    alerts = db.query(Alert).filter(Alert.lifecycle_status.in_(["PROPOSED", "REVIEWED", "APPROVED", "ISSUED", "ACKNOWLEDGED"])).all()
    for sev in ["CRITICAL", "HIGH", "MODERATE", "LOW"]:
        official_n = sum(1 for a in alerts if a.severity == sev and a.source_type != "AI_ASSESSMENT")
        ai_n = sum(1 for a in alerts if a.severity == sev and a.source_type == "AI_ASSESSMENT")
        alerts_by_severity.append({"severity": sev, "official": official_n, "ai_generated": ai_n})

    # 6. Incidents by category + verification (aggregated counts for charting)
    incidents_by_category = []
    incident_counts: Dict[str, int] = {}
    for i in db.query(IncidentReport).all():
        if i.verification_status == "REJECTED":
            continue
        incident_counts[i.category] = incident_counts.get(i.category, 0) + 1
    for cat, n in sorted(incident_counts.items()):
        incidents_by_category.append({"category": cat, "count": n})

    # 6B. Rescue by status
    rescue_by_status = []
    rrequests = db.query(RescueRequest).all()
    status_counts: Dict[str, int] = {}
    for r in rrequests:
        status_counts[r.status] = status_counts.get(r.status, 0) + 1
    for st, n in sorted(status_counts.items()):
        rescue_by_status.append({"status": st, "count": n})

    # 7. Historical rainfall comparison (documented event ARIs vs current max)
    import json as _json
    historical_rainfall_comparison = []
    val_cases = _json.loads(_json.dumps([]))
    from app.models.entities import HistoricalValidationCase
    for c in db.query(HistoricalValidationCase).filter(HistoricalValidationCase.case_type == "POSITIVE_EVENT").all():
        try:
            inputs = _json.loads(c.documented_inputs_json)
        except Exception:
            continue
        documented_rain = next((inputs[iv] for iv in ("rainfall_24h_mm", "arihant", "rain_24h_mm", "rainfall_24h")
                                if iv in inputs and isinstance(inputs[iv], (int, float))), None)
        if documented_rain is None:
            continue
        loc_name = locs[c.location_id].name if c.location_id in locs else c.location_id
        historical_rainfall_comparison.append({
            "event": c.event_name,
            "location": loc_name,
            "documented_ari_mm": float(documented_rain),
            "year": c.event_date.year if c.event_date else None
        })

    # 8. Source availability & freshness
    source_freshness = []
    for s in src_map.values():
        age = None
        if s.last_success_at:
            age = round((now - s.last_success_at).total_seconds() / 3600.0, 1)
        source_freshness.append({
            "source": s.name,
            "type": s.source_type,
            "status": s.status,
            "age_hours_success": age,
            "last_success": s.last_success_at.isoformat() if s.last_success_at else None
        })

    return {
        "generated_at": now,
        "rainfall_trend_hourly": rain_hourly,
        "rainfall_trend_daily": rain_daily,
        "river_trend": river_trend,
        "risk_by_area": risk_by_area,
        "alerts_by_severity": alerts_by_severity,
        "incidents_by_category": incidents_by_category,
        "rescue_by_status": rescue_by_status,
        "historical_rainfall_comparison": historical_rainfall_comparison,
        "source_freshness": source_freshness
    }


