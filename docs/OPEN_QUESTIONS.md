# Remaining questions and integration blockers

These are verified project limitations, not product promises. Recheck provider and configuration status whenever deploying.

| Topic | Current evidence | Required to complete |
|---|---|---|
| IMD observations and official warnings | Local IMD API key is absent; running source status reported IMD failed | Authorized credentials, documented request/auth verification, and successful source-level validation |
| CWC station telemetry | Source reported operational, but the running API process served older records without the current provenance contract | Restart from current code; verify station identity, timestamp, units, quality, freshness and source references per record |
| GSI susceptibility | GSI source status was operational, but a live status does not prove the map's susceptibility layer is official live data | Establish the precise dataset, license, spatial resolution, retrieval date, and attribution; keep reference baseline visibly distinct |
| Rainfall and forecasts | App supports external weather services; no claim of verified coverage for every district is made | Validate observation vs forecast, location matching, update cadence and source attribution; show unknown where coverage is absent |
| Email notifications | SMTP settings are blank and `PUBLIC_ALERTS_ENABLED` defaults false | Configure a provider, verify sender/domain and official recipient list, then conduct an authorized end-to-end receipt test |
| Authority contacts | No verified district contacts configured | Obtain and periodically verify official contact details through the responsible authority |
| Emergency dispatch | Rescue request tracking does not connect to a government dispatch system | Formal integration and service agreement; until then display call links and accurately state that requests are not dispatched automatically |
| Authentication | Role headers/UI role selection are not identity verification | Add production authentication, server-side permissions, session protection, and operator provisioning |
| Backend tests | `pytest` unavailable in the current runtimes | Install `backend/requirements.txt` in a supported Python environment, then run the documented suite |
| Offline support | An offline banner exists; no verified service-worker cache or durable offline request queue was found in this audit | Implement and test only if offline submission is required; clearly mark queued items as unsent |
