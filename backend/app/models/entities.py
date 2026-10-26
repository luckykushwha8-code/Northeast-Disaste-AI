import datetime
from app.time_utils import utcnow
import uuid
from sqlalchemy import (
    Column, String, Float, Integer, Boolean, DateTime, ForeignKey, Text, Enum,
    UniqueConstraint
)
from sqlalchemy.orm import relationship
from app.database import Base

def gen_uuid():
    return str(uuid.uuid4())

class User(Base):
    __tablename__ = "users"

    id = Column(String(36), primary_key=True, default=gen_uuid)
    display_name = Column(String(100), nullable=False)
    email = Column(String(150), unique=True, index=True, nullable=False)
    role = Column(String(50), nullable=False, default="RESIDENT")  # RESIDENT, RESPONDER, OPERATOR, ANALYST, ADMIN
    preferred_language = Column(String(10), default="en")  # en, as, bn, hi
    account_status = Column(String(20), default="ACTIVE")
    created_at = Column(DateTime, default=utcnow)

class Location(Base):
    __tablename__ = "locations"

    id = Column(String(50), primary_key=True)  # e.g., loc_pandu_ghat, loc_kharghuli_hills
    name = Column(String(150), nullable=False)
    state = Column(String(50), nullable=False, default="Assam")
    district = Column(String(100), nullable=False, default="Kamrup Metropolitan")
    location_type = Column(String(50), nullable=False)  # RIVER_STATION, SLOPE_ZONE, URBAN_CATCHMENT, SHELTER_HUB
    latitude = Column(Float, nullable=False)
    longitude = Column(Float, nullable=False)
    elevation_m = Column(Float, nullable=True)
    geometry_geojson = Column(Text, nullable=True)
    active = Column(Boolean, default=True)

    terrain = relationship("TerrainFeature", back_populates="location", uselist=False)
    observations = relationship("Observation", back_populates="location")
    predictions = relationship("Prediction", back_populates="location")
    alerts = relationship("Alert", back_populates="location")

class DataSource(Base):
    __tablename__ = "data_sources"

    id = Column(String(50), primary_key=True)  # e.g., src_cwc_brahmaputra, src_imd_guwahati
    name = Column(String(150), nullable=False)
    source_type = Column(String(50), nullable=False)  # IMD, CWC, GSI, SYNTH_IOT
    configuration_reference = Column(String(255), nullable=True)
    expected_update_interval_hours = Column(Float, default=2.0)
    enabled = Column(Boolean, default=True)
    last_success_at = Column(DateTime, nullable=True)
    last_error_at = Column(DateTime, nullable=True)
    status = Column(String(50), default="NOT_CHECKED")  # OPERATIONAL, DELAYED, STALE, FAILED, AUTH_REQUIRED, SIMULATED

    observations = relationship("Observation", back_populates="source")

class Observation(Base):
    __tablename__ = "observations"

    id = Column(String(36), primary_key=True, default=gen_uuid)
    source_id = Column(String(50), ForeignKey("data_sources.id"), nullable=False, index=True)
    location_id = Column(String(50), ForeignKey("locations.id"), nullable=False, index=True)
    observed_at = Column(DateTime, nullable=False, index=True)
    ingested_at = Column(DateTime, default=utcnow)
    variable = Column(String(50), nullable=False)  # rainfall_1h_mm, rainfall_24h_mm, river_level_m, river_rate_m_hr, soil_moisture_pct
    value = Column(Float, nullable=False)
    unit = Column(String(20), nullable=False)  # mm, m, m/hr, %
    quality_status = Column(String(30), default="VALID")  # VALID, STALE, MISSING, SUSPECT, SIMULATED
    provenance = Column(String(255), nullable=True)
    simulation_flag = Column(Boolean, default=False)

    source = relationship("DataSource", back_populates="observations")
    location = relationship("Location", back_populates="observations")

class TerrainFeature(Base):
    __tablename__ = "terrain_features"

    id = Column(String(36), primary_key=True, default=gen_uuid)
    location_id = Column(String(50), ForeignKey("locations.id"), unique=True, nullable=False)
    slope_deg = Column(Float, nullable=False)
    elevation_m = Column(Float, nullable=False)
    geology = Column(String(100), nullable=False)
    land_cover = Column(String(100), nullable=False)
    drainage_density = Column(Float, nullable=False)
    susceptibility_score = Column(Float, default=0.5)  # 0 to 1 scale from GSI baseline
    dataset_version = Column(String(50), default="GSI_BHUKOSH_2024")
    updated_at = Column(DateTime, default=utcnow)

    location = relationship("Location", back_populates="terrain")

class DisasterEvent(Base):
    __tablename__ = "disaster_events"

    id = Column(String(36), primary_key=True, default=gen_uuid)
    hazard_type = Column(String(30), nullable=False)  # FLOOD, LANDSLIDE
    location_id = Column(String(50), ForeignKey("locations.id"), nullable=False)
    event_start = Column(DateTime, nullable=False)
    event_end = Column(DateTime, nullable=True)
    severity = Column(String(30), default="HIGH")
    verification_status = Column(String(30), default="VERIFIED")  # VERIFIED, UNVERIFIED
    source_reference = Column(String(255), nullable=True)
    description = Column(Text, nullable=True)

class HistoricalValidationCase(Base):
    __tablename__ = "historical_validation_cases"

    id = Column(String(50), primary_key=True)  # e.g., val_flood_pandu_2022_06
    case_type = Column(String(20), nullable=False)  # POSITIVE_EVENT, NEGATIVE_EVENT, SAFETY_CASE
    hazard_type = Column(String(30), nullable=False)
    location_id = Column(String(50), ForeignKey("locations.id"), nullable=False)
    event_date = Column(DateTime, nullable=False)
    event_name = Column(String(255), nullable=False)
    documented_inputs_json = Column(Text, nullable=False)
    expected_categories_json = Column(Text, nullable=False)  # e.g. ["HIGH","CRITICAL"]
    documented_outcome = Column(Text, nullable=True)
    source_reference = Column(String(255), nullable=True)

class ModelVersion(Base):
    __tablename__ = "model_versions"

    id = Column(String(50), primary_key=True)  # e.g., flood_xgb_v1, landslide_rf_v1
    hazard_type = Column(String(30), nullable=False)  # FLOOD, LANDSLIDE
    version = Column(String(30), nullable=False)
    artifact_reference = Column(String(255), nullable=True)
    training_data_version = Column(String(100), nullable=False)
    evaluation_metrics_json = Column(Text, nullable=True)
    approval_status = Column(String(30), default="APPROVED")  # APPROVED, DEMO_ONLY, RETIRED
    released_at = Column(DateTime, default=utcnow)
    known_limitations = Column(Text, nullable=True)

class Prediction(Base):
    __tablename__ = "predictions"

    id = Column(String(36), primary_key=True, default=gen_uuid)
    location_id = Column(String(50), ForeignKey("locations.id"), nullable=False, index=True)
    hazard_type = Column(String(30), nullable=False)  # FLOOD, LANDSLIDE
    model_version_id = Column(String(50), ForeignKey("model_versions.id"), nullable=False)
    generated_at = Column(DateTime, default=utcnow)
    horizon_start = Column(DateTime, nullable=False)
    horizon_end = Column(DateTime, nullable=False)
    probability = Column(Float, nullable=True)  # Can be None if missing critical data
    risk_category = Column(String(30), nullable=False)  # LOW, MODERATE, HIGH, CRITICAL, UNAVAILABLE
    data_quality_status = Column(String(30), default="FRESH")  # FRESH, DELAYED, STALE, MISSING_CRITICAL, SIMULATED
    input_snapshot_json = Column(Text, nullable=True)
    explanation_json = Column(Text, nullable=True)
    simulation_flag = Column(Boolean, default=False)

    location = relationship("Location", back_populates="predictions")

class Alert(Base):
    __tablename__ = "alerts"

    id = Column(String(36), primary_key=True, default=gen_uuid)
    location_id = Column(String(50), ForeignKey("locations.id"), nullable=False, index=True)
    hazard_type = Column(String(30), nullable=False)  # FLOOD, LANDSLIDE
    source_type = Column(String(50), nullable=False)  # OFFICIAL_AGENCY, AI_ASSESSMENT, OPERATOR_MANUAL, SIMULATION
    severity = Column(String(30), nullable=False)  # LOW, MODERATE, HIGH, CRITICAL
    lifecycle_status = Column(String(30), default="PROPOSED")  # PROPOSED, REVIEWED, APPROVED, ISSUED, ACKNOWLEDGED, RESOLVED, REJECTED, EXPIRED, CANCELLED
    issued_at = Column(DateTime, nullable=True)
    expires_at = Column(DateTime, nullable=True)
    official_source_reference = Column(String(255), nullable=True)
    created_by = Column(String(100), default="SYSTEM_RULES_ENGINE")
    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=False)
    action_instructions = Column(Text, nullable=False)
    simulation_flag = Column(Boolean, default=False)

    location = relationship("Location", back_populates="alerts")
    events = relationship("AlertEvent", back_populates="alert", cascade="all, delete-orphan")
    deliveries = relationship("NotificationDelivery", back_populates="alert", cascade="all, delete-orphan")

class AlertEvent(Base):
    __tablename__ = "alert_events"

    id = Column(String(36), primary_key=True, default=gen_uuid)
    alert_id = Column(String(36), ForeignKey("alerts.id"), nullable=False, index=True)
    previous_status = Column(String(30), nullable=True)
    new_status = Column(String(30), nullable=False)
    actor_id = Column(String(100), nullable=False)  # user id or SYSTEM_RULES_ENGINE
    event_time = Column(DateTime, default=utcnow)
    reason = Column(Text, nullable=True)
    metadata_json = Column(Text, nullable=True)

    alert = relationship("Alert", back_populates="events")

class NotificationDelivery(Base):
    __tablename__ = "notification_deliveries"

    id = Column(String(36), primary_key=True, default=gen_uuid)
    alert_id = Column(String(36), ForeignKey("alerts.id"), nullable=False, index=True)
    channel = Column(String(50), nullable=False)  # SMS_SIM, EMAIL_SIM, BROWSER_PUSH, WEBHOOK
    recipient_reference = Column(String(100), nullable=False)  # e.g., "Kamrup Metro Disaster Response Hub"
    provider_message_id = Column(String(100), nullable=True)
    requested_at = Column(DateTime, default=utcnow)
    provider_status = Column(String(30), default="QUEUED")  # QUEUED, ACCEPTED_BY_PROVIDER, SIMULATED, FAILED, BLOCKED_DISABLED
    delivered_at = Column(DateTime, nullable=True)
    failure_reason = Column(Text, nullable=True)
    retry_count = Column(Integer, default=0)

    alert = relationship("Alert", back_populates="deliveries")

class Shelter(Base):
    __tablename__ = "shelters"

    id = Column(String(36), primary_key=True, default=gen_uuid)
    name = Column(String(150), nullable=False)
    location_name = Column(String(150), nullable=False)
    latitude = Column(Float, nullable=False)
    longitude = Column(Float, nullable=False)
    capacity = Column(Integer, default=500)
    current_occupancy = Column(Integer, default=0)
    accessibility_info = Column(String(255), default="Wheelchair accessible; Ground floor ramp available")
    operational_status = Column(String(30), default="OPEN")  # OPEN, FULL, PREPARING, CLOSED
    verified_at = Column(DateTime, default=utcnow)
    verified_by = Column(String(100), default="Kamrup DDMA Officer")
    contact_phone = Column(String(50), default="+91-361-2733052")

class IncidentReport(Base):
    __tablename__ = "incident_reports"

    id = Column(String(36), primary_key=True, default=gen_uuid)
    reporter_name = Column(String(100), default="Concerned Resident")
    category = Column(String(50), nullable=False)  # WATERLOGGING, RIVER_BREACH, SLOPE_CRACK, ROAD_BLOCKED, DEBRIS_FALL
    location_name = Column(String(150), nullable=False)
    latitude = Column(Float, nullable=False)
    longitude = Column(Float, nullable=False)
    report_time = Column(DateTime, default=utcnow)
    description = Column(Text, nullable=False)
    verification_status = Column(String(30), default="UNVERIFIED")  # UNVERIFIED, VERIFIED, REJECTED
    reviewer_id = Column(String(100), nullable=True)
    reviewed_at = Column(DateTime, nullable=True)
    photo_reference = Column(String(500), nullable=True)  # client-side photo reference (no server-side file storage in prototype)

class RescueRequest(Base):
    """Citizen rescue/assistance request. Never auto-marked DISPATCHED: only an
    authorised responder can confirm assignment (transition RECEIVED -> ASSIGNED)."""
    __tablename__ = "rescue_requests"

    id = Column(String(36), primary_key=True, default=gen_uuid)
    public_reference = Column(String(20), unique=True, nullable=False)  # e.g. RR-789234
    location_name = Column(String(150), nullable=False)
    latitude = Column(Float, nullable=False)
    longitude = Column(Float, nullable=False)
    requester_contact = Column(String(60), nullable=False)  # phone (citizen-provided, optional name)
    people_count = Column(Integer, default=1)
    needs_summary = Column(Text, nullable=False)
    photo_reference = Column(String(500), nullable=True)
    consent_shared_location = Column(Boolean, default=True)
    status = Column(String(30), default="SUBMITTED")  # SUBMITTED, RECEIVED, ASSIGNED, EN_ROUTE, SERVED, CLOSED, UNREACHABLE
    assigned_responder_id = Column(String(100), nullable=True)
    status_notes = Column(Text, nullable=True)
    submitted_at = Column(DateTime, default=utcnow)
    last_updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id = Column(String(36), primary_key=True, default=gen_uuid)
    actor_id = Column(String(100), nullable=False)
    action = Column(String(100), nullable=False)  # ALERT_APPROVED, MODEL_DEPLOYED, DATA_OVERRIDE, USER_ROLE_CHANGED
    resource_type = Column(String(50), nullable=False)  # Alert, ModelVersion, Observation, User
    resource_id = Column(String(100), nullable=False)
    timestamp = Column(DateTime, default=utcnow)
    reason = Column(Text, nullable=True)
    metadata_json = Column(Text, nullable=True)

class Subscriber(Base):
    """
    District alert subscription (resident consent record).
    People opt in to a district explicitly — the platform never infers a
    visitor's location from browsing. Emails are only sent when consent=True,
    active=True, the alert is operator-approved (lifecycle ISSUED), the alert
    is not simulated, and PUBLIC_ALERTS_ENABLED is on.
    """
    __tablename__ = "subscribers"
    __table_args__ = (
        UniqueConstraint("email", "district", name="uq_subscriber_email_district"),
    )

    id = Column(String(36), primary_key=True, default=gen_uuid)
    email = Column(String(254), nullable=False, index=True)
    district = Column(String(100), nullable=False, index=True)
    state = Column(String(50), nullable=False, default="Assam")
    role = Column(String(30), nullable=False, default="RESIDENT")  # RESIDENT (authority contacts live in config, never self-subscribed)
    consent = Column(Boolean, nullable=False, default=False)
    active = Column(Boolean, nullable=False, default=True)
    email_verified = Column(Boolean, nullable=False, default=False)  # requires verification before real sends
    created_at = Column(DateTime, default=utcnow)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)
    source = Column(String(50), nullable=False, default="WEB_FORM")

class LiveDataCache(Base):
    __tablename__ = "live_data_cache"

    cache_key = Column(String(100), primary_key=True)
    payload_json = Column(Text, nullable=False)
    source_url = Column(String(500), nullable=True)
    data_mode = Column(String(20), default="LIVE")  # LIVE, CACHED
    fetched_at = Column(DateTime, default=utcnow)

class TinyFishRetrievalRecord(Base):
    __tablename__ = "tinyfish_retrievals"

    id = Column(String(36), primary_key=True, default=gen_uuid)
    source_url = Column(String(500), nullable=False, index=True)
    target_domain = Column(String(100), nullable=False, index=True)
    source_agency = Column(String(50), nullable=False)  # IMD, CWC, GSI, NRSC_BHUVAN, OTHER
    retrieval_timestamp = Column(DateTime, default=utcnow, nullable=False)
    publication_timestamp = Column(DateTime, nullable=True)
    title = Column(String(255), nullable=True)
    extracted_text = Column(Text, nullable=True)
    content_format = Column(String(20), default="markdown")
    data_quality_status = Column(String(30), default="VALID")  # VALID, STALE, SUSPECT, FAILED
    simulation_flag = Column(Boolean, default=False)
    data_classification = Column(String(50), default="EXTRACTED_WEB_INFORMATION")
    # Classifications: "OFFICIAL_PUBLISHED_WARNING", "EXTRACTED_WEB_INFORMATION", "EXPERIMENTAL_AI_ESTIMATE", "SYNTHETIC_DEMO_DATA"
    http_status = Column(Integer, nullable=True)
    error_message = Column(Text, nullable=True)
    metadata_json = Column(Text, nullable=True)

