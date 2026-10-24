# NE-SAFE AI — Source-of-Truth API Contract

> Generated from live backend runtime and snapshot (`openapi.snapshot.json`) on 2026-10-24.

---

## 1. Authentication & Role Transmission

- **Transport**: HTTP Header `x-user-role`
- **Supported Roles**:
  - `RESIDENT`: Public citizen persona (view dashboard, report incidents, request rescue, subscribe to email alerts)
  - `RESPONDER`: Field responder (SDRF, NDRF, local quick response teams; acknowledge alerts, verify citizen reports, update rescue statuses)
  - `OPERATOR`: Operations room controller (review & approve proposed alerts, resolve alerts, manually override, manage data feeds)
  - `ADMIN` / `DISASTER_MANAGER`: Full executive management & audit privileges
  - `ANALYST`: Scientific / model evaluation persona
- **Role Gating Behavior**:
  - When unauthorized role attempts action (e.g. `RESIDENT` approving an alert), backend raises `HTTP 403 Forbidden` (`{"detail": "Permission denied: role RESIDENT cannot approve alerts"}`).
  - Frontend role switcher is available under `VITE_DEMO_ROLES=true` for demonstration and testing.

---

## 2. Critical Workflow Endpoints

### 2.1 Rescue Assistance Requests

#### Create Rescue Request
- **Method & Path**: `POST /api/v1/rescue-requests`
- **Request Body** (`RescueRequestCreate`):
  ```json
  {
    "location_id": "loc_pandu_ghat",
    "district": "Kamrup Metropolitan",
    "state": "Assam",
    "citizen_name": "Rahim Ali",
    "contact_phone": "+91 98765 43210",
    "people_count": 4,
    "has_elderly_or_infants": true,
    "medical_emergency": false,
    "situation_description": "Floodwaters reached ground floor verandah.",
    "latitude": 26.185,
    "longitude": 91.688,
    "consent_shared_location": true
  }
  ```
- **Response**: `RescueRequestOut` with public tracking reference `public_reference` (e.g. `RR-482910`).
- **Safety Policy**: Wording in UI must state: *"This form does not dispatch help automatically. In an emergency call 112."*

#### Rescue Status Transition
- **Method & Path**: `POST /api/v1/rescue-requests/{request_id}/status`
- **Allowed Roles**: `RESPONDER`, `OPERATOR`, `ADMIN`, `DISASTER_MANAGER` (or system internal).
- **Request Body** (`RescueRequestStatusUpdate`):
  ```json
  {
    "responder_id": "sdrf_team_04",
    "new_status": "ASSIGNED",
    "responder_role": "RESPONDER",
    "notes": "Boat unit dispatched from Pandu depot."
  }
  ```
- **Allowed Finite State Transitions (`RESCUE_VALID_TRANSITIONS`)**:
  - `SUBMITTED` -> `["RECEIVED", "UNREACHABLE"]`
  - `RECEIVED` -> `["ASSIGNED", "UNREACHABLE", "CLOSED"]`
  - `ASSIGNED` -> `["EN_ROUTE", "UNREACHABLE", "CLOSED"]`
  - `EN_ROUTE` -> `["SERVED", "UNREACHABLE", "CLOSED"]`
  - `SERVED` -> `["CLOSED"]`
  - `UNREACHABLE` -> `[]`
  - `CLOSED` -> `[]`
- **Error Response**: `HTTP 400` on invalid state jump; `HTTP 403` on unauthorized role.

#### List / Lookup Rescue Requests
- **Method & Path**: `GET /api/v1/rescue-requests`
- **Query Parameters**:
  - `status?: string` (e.g. `SUBMITTED`, `ASSIGNED`, `EN_ROUTE`)
  - `public_reference?: string` (e.g. `RR-482910` for citizen tracking)

---

### 2.2 Alert Queue & Operator Governance

#### List Alerts
- **Method & Path**: `GET /api/v1/alerts`
- **Query Parameters**:
  - `lifecycle_status?: string` (`PROPOSED`, `APPROVED`, `ACKNOWLEDGED`, `RESOLVED`, `REJECTED`, `EXPIRED`)
  - `hazard_type?: string` (`FLOOD`, `LANDSLIDE`)
- **Returned Schema (`AlertOut`)**:
  - `id`: string
  - `location_id`: string
  - `hazard_type`: `FLOOD` | `LANDSLIDE`
  - `source_type`: `AI_PREDICTION` | `OFFICIAL_AGENCY`
  - `severity`: `LOW` | `MODERATE` | `HIGH` | `CRITICAL`
  - `lifecycle_status`: Lifecycle status enum
  - `official_source_reference`: string (e.g., verbatim IMD bulletin reference or CWC station alert)
  - `simulation_flag`: boolean
  - `events`: Array of audit events (`actor_id`, `actor_role`, `transition`, `reason`, `timestamp`)
  - `deliveries`: Array of delivery audit records (`channel`, `recipient_reference`, `provider_status`, `requested_at`)

#### Alert Approval (Operator Gated)
- **Method & Path**: `POST /api/v1/alerts/{alert_id}/approve`
- **Headers**: `x-user-role: OPERATOR` (or `ADMIN`)
- **Body** (`AlertAction`):
  ```json
  {
    "actor_id": "operator_kamrup_ctrl",
    "reason": "Verified against Brahmaputra gauge rise and IMD red warning."
  }
  ```

#### Alert Acknowledgment (Responder Gated)
- **Method & Path**: `POST /api/v1/alerts/{alert_id}/acknowledge`
- **Headers**: `x-user-role: RESPONDER`
- **Body** (`AlertAction`):
  ```json
  {
    "actor_id": "sdrf_guwahati_unit",
    "reason": "Field team briefed and deployed to low-lying sectors."
  }
  ```

#### Alert Resolution
- **Method & Path**: `POST /api/v1/alerts/{alert_id}/resolve`
- **Headers**: `x-user-role: OPERATOR`
- **Body** (`AlertAction`):
  ```json
  {
    "actor_id": "operator_kamrup_ctrl",
    "reason": "River levels receded below warning line."
  }
  ```

---

### 2.3 Email Notification Dispatch Status & Guard Chain

Emails are dispatched asynchronously during alert approval via `EmailAlertService`.
Every delivery is logged into `deliveries` on the alert with `provider_status`:
- `ACCEPTED_BY_PROVIDER`: SMTP server accepted the message for delivery (Rule D6: never claimed as "delivered to inbox")
- `BLOCKED_SIMULATED`: Sandboxed due to `simulation_flag=true`
- `BLOCKED_DISABLED`: `PUBLIC_ALERTS_ENABLED=false` in environment
- `BLOCKED_STALE`: Observations older than `ALERT_MAX_STALE_HOURS` (default 3h)
- `BLOCKED_LOW_SEVERITY`: Severity is `LOW` or `MODERATE` (only `HIGH` & `CRITICAL` trigger public alerts)
- `FAILED`: Upstream SMTP handshake failed (with honest `failure_reason`)

---

### 2.4 Reports: Situation Report Export

- **Method & Path**: `GET /api/v1/reports/situation`
- **Query Parameters**:
  - `format: "pdf" | "csv"` (default `"pdf"`)
- **Responses**:
  - `pdf`: Content-Type `application/pdf`, filename `ne_safe_situation_YYYYMMDD_HHMM.pdf`
  - `csv`: Content-Type `text/csv; charset=utf-8`, filename `ne_safe_situation_YYYYMMDD_HHMM.csv`

---

### 2.5 Data Sources & Health Endpoint Resolution

- **Method & Path**: `GET /api/v1/system/data-status`
- **Resolution of "Six" vs Real Sources**:
  - The database stores **5 registered DataSource rows**:
    1. `src_imd_api` (IMD API Catalogue)
    2. `src_cwc_brahmaputra` (CWC Flood Telemetry)
    3. `src_gsi_landslide` (GSI Bhusanket)
    4. `src_isro_bhuvan` (ISRO / NRSC Bhuvan WMS)
    5. `src_smart_city_iot` (Guwahati Urban Hydrology)
  - Supplementary sources are exposed via dedicated service endpoints:
    - `open_meteo_service` (`/weather/now`, `/weather/forecast`)
    - `tinyfish_service` (`/sources/tinyfish/status`, `/sources/tinyfish/retrieve`, `/sources/tinyfish/history`)
    - `live_news_service` (`/data/live-news`)
  - **Contract Requirement**: System Health UI computes total count dynamically (`dataSources.length`), never displaying a hardcoded "6".

---

### 2.6 Data Mode, Freshness & Provenance Standard

| Field | Possible Values | UI Representation |
|---|---|---|
| `data_mode` / `data_quality_status` | `LIVE`, `CACHED`, `BASELINE`, `SIMULATED`, `UNAVAILABLE` | Badge with distinct icon + text (never color alone) |
| `freshness` | `FRESH` (within SLA), `STALE` (exceeds SLA), `MISSING` | Chip with "updated X min ago" + exact IST timestamp on hover |
| `simulation_flag` | `true`, `false` | When true: Striped purple ribbon; excluded from public views & KPIs unless operator toggle active |
| `rule_ids` | `R1_CWC_DANGER_EXCEEDED`, `R2_RAPID_RISE`, `R3_HEAVY_RAINFALL`, `R4_HIGH_ARI_LANDSLIDE` | Monospace chip in explanation drawer |
| `confidence` | Float `0.0` - `1.0` | Percentage badge; AI cannot override official agency thresholds |
| `boundary_status` | `EXACT`, `APPROXIMATED`, `UNKNOWN` | Pill on district inspector |
