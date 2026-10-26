from pydantic import BaseModel, Field, ConfigDict
from typing import Optional, List, Dict, Any, Literal
from datetime import datetime


class AuthLogin(BaseModel):
    username: str = Field(min_length=1, max_length=80)
    password: str = Field(min_length=1, max_length=1024)

# --- Locations ---
class LocationBase(BaseModel):
    id: str
    name: str
    state: str = "Assam"
    district: str = "Kamrup Metropolitan"
    location_type: str  # RIVER_STATION, SLOPE_ZONE, URBAN_CATCHMENT, SHELTER_HUB
    latitude: float
    longitude: float
    elevation_m: Optional[float] = None
    geometry_geojson: Optional[str] = None
    active: bool = True

class LocationOut(LocationBase):
    terrain: Optional[Dict[str, Any]] = None
    model_config = ConfigDict(from_attributes=True)

# --- Data Sources & Health ---
class DataSourceOut(BaseModel):
    id: str
    name: str
    source_type: str  # IMD, CWC, GSI, SYNTH_IOT
    configuration_reference: Optional[str] = None
    expected_update_interval_hours: float
    enabled: bool
    last_success_at: Optional[datetime] = None
    last_error_at: Optional[datetime] = None
    status: str  # OPERATIONAL, DELAYED, STALE, FAILED
    last_fetch_attempt_at: Optional[datetime] = None
    latest_observation_at: Optional[datetime] = None
    latest_observation_ingested_at: Optional[datetime] = None
    latest_variable: Optional[str] = None
    latest_value: Optional[float] = None
    latest_unit: Optional[str] = None
    latest_observation_status: Optional[str] = None
    latest_observation_simulated: Optional[bool] = None
    latest_forecast_24h_mm: Optional[float] = None
    latest_forecast_period_start_at: Optional[datetime] = None
    latest_forecast_period_end_at: Optional[datetime] = None
    latest_forecast_fetched_at: Optional[datetime] = None
    latest_forecast_status: Optional[str] = None
    model_config = ConfigDict(from_attributes=True)

# --- Observations ---
class ObservationCreate(BaseModel):
    source_id: str
    location_id: str
    observed_at: datetime
    variable: str
    value: float
    unit: str
    provenance: Optional[str] = "Manual Ingestion / IMD API"
    simulation_flag: bool = False

class ObservationOut(BaseModel):
    id: str
    source_id: str
    location_id: str
    observed_at: datetime
    ingested_at: datetime
    variable: str
    value: float
    unit: str
    quality_status: str
    provenance: Optional[str] = None
    simulation_flag: bool
    model_config = ConfigDict(from_attributes=True)

# --- Predictions ---
class PredictionOut(BaseModel):
    id: str
    location_id: str
    location_name: Optional[str] = None
    hazard_type: str  # FLOOD, LANDSLIDE
    model_version: str
    generated_at: datetime
    horizon_start: datetime
    horizon_end: datetime
    probability: Optional[float] = None
    risk_category: str  # LOW, MODERATE, HIGH, CRITICAL, UNAVAILABLE
    data_quality_status: str  # FRESH, DELAYED, STALE, MISSING_CRITICAL, SIMULATED
    input_snapshot: Optional[Dict[str, Any]] = None
    explanation: Optional[Dict[str, Any]] = None
    simulation_flag: bool = False
    model_config = ConfigDict(from_attributes=True)

# --- Alerts & Lifecycles ---
class AlertCreate(BaseModel):
    location_id: str = Field(min_length=1, max_length=50)
    hazard_type: Literal["FLOOD", "LANDSLIDE"]
    source_type: Literal["OPERATOR_MANUAL", "AI_ASSESSMENT", "OFFICIAL_AGENCY", "SIMULATION"] = "OPERATOR_MANUAL"
    severity: Literal["LOW", "MODERATE", "HIGH", "CRITICAL"]
    title: str = Field(min_length=3, max_length=200)
    description: str = Field(min_length=3, max_length=2000)
    action_instructions: str = Field(min_length=3, max_length=2000)
    official_source_reference: Optional[str] = Field(default=None, max_length=255)
    simulation_flag: bool = False

class AlertAction(BaseModel):
    actor_id: Optional[str] = None  # Ignored for authorization; actor comes from signed login token.
    reason: Optional[str] = Field(default=None, max_length=1000)

class NotificationDeliveryOut(BaseModel):
    id: str
    channel: str
    recipient_reference: str
    provider_message_id: Optional[str] = None
    requested_at: datetime
    provider_status: str  # QUEUED, ACCEPTED_BY_PROVIDER, SIMULATED, FAILED, BLOCKED_DISABLED
    delivered_at: Optional[datetime] = None
    failure_reason: Optional[str] = None
    retry_count: int
    model_config = ConfigDict(from_attributes=True)

class AlertEventOut(BaseModel):
    id: str
    previous_status: Optional[str] = None
    new_status: str
    actor_id: str
    event_time: datetime
    reason: Optional[str] = None
    model_config = ConfigDict(from_attributes=True)

class AlertOut(BaseModel):
    id: str
    location_id: str
    location_name: Optional[str] = None
    hazard_type: str
    source_type: str
    severity: str
    lifecycle_status: str
    issued_at: Optional[datetime] = None
    expires_at: Optional[datetime] = None
    official_source_reference: Optional[str] = None
    created_by: str
    title: str
    description: str
    action_instructions: str
    simulation_flag: bool
    events: List[AlertEventOut] = []
    deliveries: List[NotificationDeliveryOut] = []
    model_config = ConfigDict(from_attributes=True)

# --- Shelters ---
class ShelterOut(BaseModel):
    id: str
    name: str
    location_name: str
    latitude: float
    longitude: float
    capacity: int
    current_occupancy: int
    accessibility_info: str
    operational_status: str  # OPEN, FULL, PREPARING, CLOSED
    verified_at: datetime
    verified_by: str
    contact_phone: str
    model_config = ConfigDict(from_attributes=True)

# --- Incident Reports ---
class IncidentReportCreate(BaseModel):
    reporter_name: Optional[str] = Field(default="Concerned Citizen", max_length=100)
    category: Literal["WATERLOGGING", "RIVER_BREACH", "SLOPE_CRACK", "ROAD_BLOCKED", "DEBRIS_FALL"]
    location_name: str = Field(min_length=2, max_length=150)
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    description: str = Field(min_length=5, max_length=2000)
    photo_reference: Optional[str] = Field(default=None, max_length=500)

class IncidentReportVerify(BaseModel):
    reviewer_id: Optional[str] = None  # Ignored; reviewer comes from signed login token.
    status: Literal["VERIFIED", "REJECTED"]
    notes: Optional[str] = Field(default=None, max_length=1000)

class IncidentReportOut(BaseModel):
    id: str
    reporter_name: str
    category: str
    location_name: str
    latitude: float
    longitude: float
    report_time: datetime
    description: str
    verification_status: str
    reviewer_id: Optional[str] = None
    reviewed_at: Optional[datetime] = None
    photo_reference: Optional[str] = Field(default=None, max_length=500)
    model_config = ConfigDict(from_attributes=True)

# --- Rescue Requests (citizen assistance; responder-confirmed only) ---
class RescueRequestCreate(BaseModel):
    location_name: str = Field(min_length=2, max_length=150)
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    requester_contact: str = Field(min_length=5, max_length=60)
    people_count: int = Field(default=1, ge=1, le=200)
    needs_summary: str = Field(min_length=5, max_length=2000)
    photo_reference: Optional[str] = None
    consent_shared_location: bool = True

class RescueRequestStatusUpdate(BaseModel):
    responder_id: Optional[str] = None  # Ignored; responder comes from signed login token.
    new_status: Literal["RECEIVED", "ASSIGNED", "EN_ROUTE", "SERVED", "CLOSED", "UNREACHABLE"]
    responder_role: Optional[str] = None  # Ignored; role comes from signed login token.
    notes: Optional[str] = Field(default=None, max_length=1000)

class RescueRequestOut(BaseModel):
    id: str
    public_reference: str
    location_name: str
    latitude: float
    longitude: float
    people_count: int
    needs_summary: str
    consent_shared_location: bool
    status: str
    assigned_responder_id: Optional[str] = None
    status_notes: Optional[str] = None
    submitted_at: datetime
    last_updated_at: datetime
    model_config = ConfigDict(from_attributes=True)

# --- Analytics (chart datasets) ---
class AnalyticsOverview(BaseModel):
    generated_at: datetime
    units_note: str = "rainfall: mm; river level: m; counts: records"
    rainfall_trend_hourly: List[Dict[str, Any]]
    rainfall_trend_daily: List[Dict[str, Any]]
    river_trend: List[Dict[str, Any]]
    risk_by_area: List[Dict[str, Any]]
    alerts_by_severity: List[Dict[str, Any]]
    incidents_by_category: List[Dict[str, Any]]
    rescue_by_status: List[Dict[str, Any]]
    historical_rainfall_comparison: List[Dict[str, Any]]
    source_freshness: List[Dict[str, Any]]

# --- Audit Logs ---
class AuditLogOut(BaseModel):
    id: str
    actor_id: str
    action: str
    resource_type: str
    resource_id: str
    timestamp: datetime
    reason: Optional[str] = None
    model_config = ConfigDict(from_attributes=True)

# --- Model Versions & Evaluation ---
class ModelVersionOut(BaseModel):
    id: str
    hazard_type: str
    version: str
    training_data_version: str
    evaluation_metrics: Optional[Dict[str, Any]] = None
    approval_status: str
    released_at: datetime
    known_limitations: Optional[str] = None
    model_config = ConfigDict(from_attributes=True)

# --- TinyFish Web Agent & Data Extraction ---
class TinyFishStatusOut(BaseModel):
    configured: bool
    status: str  # "READY", "UNAVAILABLE", "RATE_LIMITED", "ERROR"
    endpoint: str
    key_present: bool
    key_preview: Optional[str] = None
    timeout_seconds: int
    rate_limit_per_minute: int
    rate_limit_remaining: int
    approved_domains: List[str]
    last_retrieval_at: Optional[datetime] = None
    total_retrievals_count: int = 0
    simulation_mode: bool = False

class TinyFishRetrievalRequest(BaseModel):
    url: str
    format: str = "markdown"  # "markdown", "html", "json"
    purpose: Optional[str] = "Extract official published disaster warnings and hydro-meteorological observations"
    simulate_if_unavailable: bool = True

class TinyFishRetrievalResultOut(BaseModel):
    id: str
    source_url: str
    target_domain: str
    source_agency: str  # IMD, CWC, GSI, NRSC_BHUVAN, OTHER
    retrieval_timestamp: datetime
    publication_timestamp: Optional[datetime] = None
    title: Optional[str] = None
    extracted_text: Optional[str] = None
    content_format: str
    data_quality_status: str  # "VALID", "STALE", "SUSPECT", "FAILED"
    simulation_flag: bool
    data_classification: str  # "OFFICIAL_PUBLISHED_WARNING", "EXTRACTED_WEB_INFORMATION", "EXPERIMENTAL_AI_ESTIMATE", "SYNTHETIC_DEMO_DATA"
    http_status: Optional[int] = 200
    error_message: Optional[str] = None
    model_config = ConfigDict(from_attributes=True)

# --- District alert subscriptions (email, with explicit consent) ---
class AlertSubscribeRequest(BaseModel):
    email: str
    district: str
    consent: bool

class SubscriberOut(BaseModel):
    id: str
    email: str
    district: str
    state: str
    role: str
    consent: bool
    active: bool
    email_verified: bool
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)

class AlertDistrictOut(BaseModel):
    district: str
    state: str
    monitored_location_count: int

class AlertDispatchStatusOut(BaseModel):
    alert_id: str
    status: str  # ACCEPTED_BY_PROVIDER, PARTIALLY_ACCEPTED, FAILED, NO_ELIGIBLE_RECIPIENTS, or BLOCKED_*
    reason: Optional[str] = None
    recipients_total: int = 0
    accepted_by_provider: int = 0
    failed: int = 0
    deliveries: List[NotificationDeliveryOut] = []

