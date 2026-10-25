# BACKEND CHANGES LOG

This file logs all backend modifications made during development, with justifications and compliance notes as required by the Master Prompt.

## Policy & Boundaries
- Frontend strictly reflects backend safety logic (PROPOSED alerts, simulation sandboxes, email gates, role checks).
- No modifications were made to core safety rules (R1, R2, R3, R4, R5), model prediction weights, or role security barriers.

---

## 1. Environment & Live Provider Configuration
- **File**: `backend/.env`
- **Key added/updated**: `TINYFISH_API_KEY=<configure in backend/.env>`
- **Justification**: Connected real TinyFish AI Web Extraction engine (`https://api.fetch.tinyfish.ai`) to ingest live CWC hydrological bulletins, real-time Assam and Northeast regional news feeds (EastMojo, Sentinel Assam), and live meteorology.
- **Verification**: Verified via `GET /api/v1/sources/tinyfish/status` (`status: READY`, `simulation_mode: False`, `key_present: True`) and `POST /api/v1/data/sync` (pulled 42 regional news records and live CWC stream).

---

## 2. CORS & Proxy Configuration
- **Status**: Backend already configures CORS for `http://localhost:5173`, `http://127.0.0.1:5173`, and `http://localhost:3000`.
- **Vite Dev Proxy**: Configured in `frontend/vite.config.ts` (`/api` -> `http://127.0.0.1:8000`), ensuring seamless single-origin network requests during local testing without browser origin blocks.

---

## 3. Endpoints Added or Modified
- **None required**: All required endpoints were already fully implemented in FastAPI:
  - `GET /api/v1/alerts` and `POST /api/v1/alerts/{id}/approve` (role-gated with `x-user-role`)
  - `POST /api/v1/rescue-requests` and `POST /api/v1/rescue-requests/{id}/status`
  - `GET /api/v1/analytics/overview` (8 analytical datasets)
  - `GET /api/v1/models/validation` and `POST /api/v1/models/demo-scenario`
  - `GET /api/v1/reports/situation?format=pdf|csv`
  - `POST /api/v1/alerts/subscribe` and `/alerts/unsubscribe`
  - `GET /api/v1/system/data-status` and `GET /api/v1/system/audit-logs`
