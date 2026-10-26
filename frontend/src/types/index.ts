export type HazardType = 'FLOOD' | 'LANDSLIDE';
export type SeverityLevel = 'LOW' | 'MODERATE' | 'HIGH' | 'CRITICAL' | 'UNAVAILABLE';
export type QualityStatus = 'VALID' | 'FRESH' | 'DELAYED' | 'STALE' | 'MISSING' | 'MISSING_CRITICAL' | 'SIMULATED';
export type LifecycleStatus = 'PROPOSED' | 'REVIEWED' | 'APPROVED' | 'ISSUED' | 'ACKNOWLEDGED' | 'RESOLVED' | 'REJECTED' | 'EXPIRED' | 'CANCELLED';
export type UserRole = 'RESIDENT' | 'RESPONDER' | 'OPERATOR' | 'ANALYST' | 'ADMIN';
export type Language = 'en' | 'as' | 'bn' | 'hi';
export interface AuthenticatedUser { username: string; role: UserRole; }

export interface LocationItem {
  id: string;
  name: string;
  state: string;
  district: string;
  location_type: 'RIVER_STATION' | 'SLOPE_ZONE' | 'URBAN_CATCHMENT' | 'SHELTER_HUB';
  latitude: float;
  longitude: float;
  elevation_m?: number;
  geometry_geojson?: string;
  active: boolean;
  terrain?: {
    slope_deg: number;
    elevation_m: number;
    geology: string;
    land_cover: string;
    drainage_density: number;
    susceptibility_score: number;
  };
}

export type float = number;

export interface DataSourceItem {
  id: string;
  name: string;
  source_type: string;
  configuration_reference?: string;
  expected_update_interval_hours: number;
  enabled: boolean;
  last_success_at?: string;
  last_error_at?: string;
  status: string;
  last_fetch_attempt_at?: string | null;
  latest_observation_at?: string | null;
  latest_observation_ingested_at?: string | null;
  latest_variable?: string | null;
  latest_value?: number | null;
  latest_unit?: string | null;
  latest_observation_status?: string | null;
  latest_observation_simulated?: boolean | null;
  latest_forecast_24h_mm?: number | null;
  latest_forecast_period_start_at?: string | null;
  latest_forecast_period_end_at?: string | null;
  latest_forecast_fetched_at?: string | null;
  latest_forecast_status?: string | null;
}

export interface ObservationItem {
  id: string;
  source_id: string;
  location_id: string;
  observed_at: string;
  ingested_at: string;
  variable: string;
  value: number;
  unit: string;
  quality_status: QualityStatus;
  provenance?: string;
  simulation_flag: boolean;
}

export interface PredictionItem {
  id: string;
  location_id: string;
  location_name?: string;
  hazard_type: HazardType;
  model_version: string;
  generated_at: string;
  horizon_start: string;
  horizon_end: string;
  probability?: number | null;
  risk_category: SeverityLevel;
  data_quality_status: QualityStatus;
  input_snapshot?: Record<string, any>;
  explanation?: {
    primary_reason?: string;
    contributing_factors?: string[];
    official_cwc_danger_level_m?: number;
    official_cwc_warning_level_m?: number;
    disclaimer?: string;
  };
  simulation_flag: boolean;
}

export interface NotificationDeliveryItem {
  id: string;
  channel: string;
  recipient_reference: string;
  provider_message_id?: string;
  requested_at: string;
  provider_status: 'QUEUED' | 'ACCEPTED_BY_PROVIDER' | 'SIMULATED' | 'FAILED' | 'BLOCKED_DISABLED';
  delivered_at?: string;
  failure_reason?: string;
  retry_count: number;
}

export interface AlertEventItem {
  id: string;
  previous_status?: string;
  new_status: string;
  actor_id: string;
  event_time: string;
  reason?: string;
}

export interface AlertItem {
  id: string;
  location_id: string;
  location_name?: string;
  hazard_type: HazardType;
  source_type: string;
  severity: SeverityLevel;
  lifecycle_status: LifecycleStatus;
  issued_at?: string;
  expires_at?: string;
  official_source_reference?: string;
  created_by?: string;
  title: string;
  description: string;
  action_instructions: string;
  simulation_flag: boolean;
  events?: AlertEventItem[];
  deliveries?: NotificationDeliveryItem[];
}

export interface ShelterItem {
  id: string;
  name: string;
  location_name: string;
  latitude: number;
  longitude: number;
  capacity: number;
  current_occupancy: number;
  accessibility_info: string;
  operational_status: 'OPEN' | 'FULL' | 'PREPARING' | 'CLOSED';
  verified_at: string;
  verified_by: string;
  contact_phone: string;
}

export interface IncidentReportItem {
  id: string;
  reporter_name?: string;
  category: string;
  location_name: string;
  latitude: number;
  longitude: number;
  report_time: string;
  description?: string;
  verification_status: 'UNVERIFIED' | 'VERIFIED' | 'REJECTED';
  reviewer_id?: string;
  reviewed_at?: string;
}

export interface AuditLogItem {
  id: string;
  actor_id: string;
  action: string;
  resource_type: string;
  resource_id: string;
  timestamp: string;
  reason?: string;
}

export interface ModelVersionItem {
  id: string;
  hazard_type: HazardType;
  version: string;
  training_data_version: string;
  evaluation_metrics?: Record<string, any>;
  approval_status: string;
  released_at: string;
  known_limitations?: string;
}

export interface LiveNewsArticleItem {
  title: string;
  source_domain: string;
  source_url: string;
  article_link: string;
  disaster_related: boolean;
  retrieved_at: string;
}

export interface LiveNewsFeedItem {
  retrieved_at: string;
  data_mode: 'LIVE' | 'CACHED' | 'UNAVAILABLE';
  total_articles: number;
  disaster_related_count: number;
  attribution: string;
  articles: LiveNewsArticleItem[];
}

export interface LiveDataSyncItem {
  sync_started_at: string;
  sync_completed_at: string;
  sources: Record<string, string | number>;
  disaster_related_headlines?: number;
}

export interface GeoJSONPointFeature {
  type: 'Feature';
  geometry: { type: 'Point'; coordinates: [number, number] };
  properties: Record<string, any>;
}

export interface GeoJSONFeatureCollection {
  type: 'FeatureCollection';
  engine_version: string;
  generated_at: string;
  threshold_provenance: Record<string, string>;
  features: GeoJSONPointFeature[];
}

export interface HistoricalEventItem {
  id: number;
  hazard_type: HazardType;
  location_id: string;
  location_name: string;
  state: string | null;
  district: string | null;
  latitude: number | null;
  longitude: number | null;
  event_start: string;
  severity: SeverityLevel;
  verification_status: string;
  source_reference: string;
  description: string;
}

export interface WeatherReadingItem {
  location_id: string;
  location_name: string;
  variable: string;
  value: number;
  unit: string;
  source_id: string;
  source_name: string;
  source_type: string;
  source_configuration_reference: string | null;
  observed_at: string;
  last_updated_at: string;
  quality_status: QualityStatus;
  provenance: string | null;
  simulation_flag: boolean;
}

export interface WeatherNowResponse {
  retrieved_at: string;
  provenance_policy: string;
  readings: WeatherReadingItem[];
}

export interface HistoricalValidationCaseResult {
  case_id: string;
  hazard_type: HazardType;
  case_type: 'POSITIVE_EVENT' | 'NEGATIVE_EVENT' | 'SAFETY_CASE';
  event_date: string;
  event_name: string;
  model_version: string;
  predicted_category: SeverityLevel;
  predicted_probability: number | null;
  predicted_quality: QualityStatus;
  expected_categories: SeverityLevel[];
  passed: boolean;
  documented_outcome: string;
  source_reference: string;
  engine_explanation: Record<string, any>;
}

export interface ModelValidationReport {
  validated_at: string;
  total_cases: number;
  positive_events: number;
  negative_events: number;
  safety_cases: number;
  historical_hit_rate: number | null;
  false_alarm_rate: number | null;
  safety_rule_pass_rate: number | null;
  overall_pass_count: number;
  verdict: 'VALIDATED' | 'NEEDS_REVIEW';
  by_hazard: Record<string, { cases: number; hits: number; hit_rate: number | null }>;
  cases: HistoricalValidationCaseResult[];
  method_note: string;
  threshold_provenance: Record<string, string>;
}

// ---- Official IMD REST API (api.imd.gov.in) ----
export interface ImdEndpointStatus {
  endpoint: string;
  path: string;
  last_mode: string;
  fetched_at: string | null;
  row_count: number;
}

export interface ImdApiStatus {
  api_key_configured: boolean;
  auth_style: string | null;
  endpoints: ImdEndpointStatus[];
  role_note: string;
}

// ---- District alert subscriptions ----
export interface AlertDistrictItem {
  district: string;
  state: string;
  monitored_location_count: number;
}

export interface SubscriptionResult {
  status: string;
  email?: string;
  district?: string;
  updated?: boolean;
  note?: string;
}

// ---- Rescue requests (citizen assistance) ----
export type RescueStatus = 'SUBMITTED' | 'RECEIVED' | 'ASSIGNED' | 'EN_ROUTE' | 'SERVED' | 'CLOSED' | 'UNREACHABLE';

export interface RescueRequestItem {
  id: string;
  public_reference: string;
  location_name: string;
  latitude: number;
  longitude: number;
  people_count: number;
  needs_summary: string;
  consent_shared_location: boolean;
  status: RescueStatus;
  assigned_responder_id: string | null;
  status_notes: string | null;
  submitted_at: string;
  last_updated_at: string;
}

export interface RescueTrackingItem {
  public_reference: string;
  status: RescueStatus;
  submitted_at: string;
  last_updated_at: string;
}

export interface RescueRequestCreate {
  location_name: string;
  latitude: number;
  longitude: number;
  requester_contact: string;
  people_count: number;
  needs_summary: string;
  photo_reference?: string | null;
  consent_shared_location?: boolean;
}

export interface UpdateRescueStatusPayload {
  responder_id?: string;
  new_status: RescueStatus;
  responder_role?: string;
  notes?: string;
}

// ---- Analytics dashboards ----
export interface RainTrendPoint { time: string; avg_mm: number; max_mm: number; samples: number; }
export interface RiverTrendPoint {
  location: string; river: string; time: string; level_m: number; unit: string;
  warning_level_m: number | null; danger_level_m: number | null;
}
export interface RiskByAreaPoint {
  location: string; state: string; district: string;
  flood_category: SeverityLevel; landslide_category: SeverityLevel;
  risk_category: SeverityLevel; score: number | null;
}
export interface AlertsSeverityPoint { severity: string; official: number; ai_generated: number; }
export interface IncidentCategoryPoint { category: string; count: number; }
export interface RescueStatusPoint { status: string; count: number; }
export interface HistoricalRainPoint { event: string; location: string; documented_ari_mm: number; year: number | null; }
export interface SourceFreshnessPoint {
  source: string; type: string; status: string; age_hours_success: number | null; last_success: string | null;
}

export interface AnalyticsOverview {
  generated_at: string;
  rainfall_trend_hourly: RainTrendPoint[];
  rainfall_trend_daily: RainTrendPoint[];
  river_trend: RiverTrendPoint[];
  risk_by_area: RiskByAreaPoint[];
  alerts_by_severity: AlertsSeverityPoint[];
  incidents_by_category: IncidentCategoryPoint[];
  rescue_by_status: RescueStatusPoint[];
  historical_rainfall_comparison: HistoricalRainPoint[];
  source_freshness: SourceFreshnessPoint[];
}

// ---- TinyFish Web Agent & Data Extraction ----
export interface TinyFishStatus {
  configured: boolean;
  status: 'READY' | 'UNAVAILABLE' | 'RATE_LIMITED' | 'ERROR';
  endpoint: string;
  key_present: boolean;
  key_preview?: string | null;
  timeout_seconds: number;
  rate_limit_per_minute: number;
  rate_limit_remaining: number;
  approved_domains: string[];
  last_retrieval_at?: string | null;
  total_retrievals_count: number;
  simulation_mode: boolean;
  scheduled_sync_enabled: boolean;
  scheduled_sync_interval_minutes: number;
}

export interface TinyFishRetrievalRequest {
  url: string;
  format?: 'markdown' | 'html' | 'json';
  purpose?: string;
  simulate_if_unavailable?: boolean;
}

export interface TinyFishRetrievalResult {
  id: string;
  source_url: string;
  target_domain: string;
  source_agency: 'IMD' | 'CWC' | 'GSI' | 'NRSC_BHUVAN' | 'OTHER' | string;
  retrieval_timestamp: string;
  publication_timestamp?: string | null;
  title?: string | null;
  extracted_text?: string | null;
  content_format: string;
  data_quality_status: 'VALID' | 'STALE' | 'SUSPECT' | 'FAILED' | string;
  simulation_flag: boolean;
  data_classification: 'OFFICIAL_PUBLISHED_WARNING' | 'EXTRACTED_WEB_INFORMATION' | 'EXPERIMENTAL_AI_ESTIMATE' | 'SYNTHETIC_DEMO_DATA' | string;
  http_status?: number | null;
  error_message?: string | null;
}

