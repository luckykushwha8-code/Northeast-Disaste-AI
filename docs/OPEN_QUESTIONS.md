# NE-SAFE AI — Open Questions & Fallback Registrations

This document tracks unresolved upstream dependencies, external credentials, or domain limitations, paired with their explicit, honest UI fallbacks.

| # | Topic / Service | Upstream Status | Documented Fallback in UI |
|---|---|---|---|
| 1 | **Official IMD REST API Key (`IMD_API_KEY`)** | Requires formal institutional authorization from IMD/MoES. When key is empty, endpoints return HTTP 401/403. | Card shows `"Key not configured, using baseline fallback"` for operators with configuration instructions; citizen views display `"Official IMD district data unavailable"` without inventing rainfall. |
| 2 | **GSI Bhusanket Landslide Susceptibility API** | Portal is JavaScript client-rendered without a public REST data API. | Reference susceptibility values from published Geological Survey of India reports with explicit provenance metadata (`BASELINE_REFERENCE`). |
| 3 | **Automatic Public Alert Emails (`PUBLIC_ALERTS_ENABLED`)** | Kept disabled (`false`) during prototyping and evaluation to avoid accidental dispatches. | UI displays persistent banner: `"Public alert emails are OFF while data and model are being validated."` Deliveries logged honestly as `BLOCKED_DISABLED`. |
| 4 | **Offline Connectivity in Remote Flood Zones** | Remote areas frequently lose cellular network connectivity during monsoons. | PWA Service Worker caching app shell, last-good telemetry (badged `CACHED`), emergency numbers, and queueing offline rescue requests in IndexedDB/localStorage with `"Not sent yet, will retry"` status. |
