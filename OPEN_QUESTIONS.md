# NE-SAFE AI — Open Questions & Design Decisions

This document tracks unresolved external questions, design decisions, and the fallback behaviors implemented in compliance with Part A and Part E of the Master Prompt.

---

### 1. IMD REST API Key Provisioning (api.imd.gov.in)
- **Question**: When will the production API key for official IMD REST feeds be provisioned?
- **Current State**: `IMD_API_KEY` is unconfigured (`AUTH_ERROR`).
- **Implemented Fallback**:
  - Operators see a transparent explanation: *"IMD API key not configured — using baseline fallback"* with actionable configuration instructions in System Health.
  - Citizens see a calm, honest message: *"Official IMD district data temporarily unavailable — displaying observed radar/AWS baseline"*.
  - No synthetic data is fabricated; fallback status is clearly marked as `BASELINE` or `UNAVAILABLE`.

### 2. Public Alert Email Master Switch (`PUBLIC_ALERTS_ENABLED`)
- **Question**: When should automated resident email dispatch be enabled for public disaster warnings?
- **Policy**: In accordance with Rule R-06, public emails remain OFF while the model and data feeds undergo validation.
- **Implemented Fallback**:
  - Subscriptions page and alerts interface clearly render the state-aware banner:
    > *"Public alert emails are currently OFF while data and model are being validated. Your subscription is saved and will activate once verified by district authorities."*
  - In alert queues, email delivery is recorded only as `ACCEPTED_BY_PROVIDER`, never falsely claimed as "Delivered".

### 3. CWC Real-Time Gauge Ingestion
- **Question**: CWC FFS telemetry refreshes at irregular intervals (hourly during flood season, 3-hourly in lean season).
- **Implemented Fallback**:
  - Freshness chips calculate delta against current IST time. If no reading within 3 hours, status moves to `STALE` with dimmed gauges and uncertainty indicators.
  - Rule R-03 prevents extrapolating river levels beyond observed points.

### 4. Rescue Request Dispatch Workflow
- **Question**: How does citizen rescue request tie into SDRF/NDRF dispatch channels?
- **Policy**: The web portal provides request intake and field responder tracking, not autonomous dispatch.
- **Implemented UI Rule**:
  - Rendered permanently on all rescue screens in bold high-contrast text:
    > *"This form does not dispatch help automatically. In an emergency call 112."*
  - Status progression only updates when an authorized responder or operator executes a state transition.
