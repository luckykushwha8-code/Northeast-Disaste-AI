# NE-SAFE AI — Northeast India Disaster Risk Monitoring & Early-Warning Platform

[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue.svg)](https://www.typescriptlang.org)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.115-009688.svg)](https://fastapi.tiangolo.com)
[![React](https://img.shields.io/badge/React-19.2-61dafb.svg)](https://react.dev)
[![MapTiler](https://img.shields.io/badge/MapTiler-Vector%20Basemap-blueviolet.svg)](https://cloud.maptiler.com)
[![TinyFish](https://img.shields.io/badge/TinyFish-Web%20Extraction-teal.svg)](https://tinyfish.ai)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

An explainable prototype for exploring **flood and rainfall-triggered landslide information** across the 8 states of Northeast India: **Assam, Meghalaya, Arunachal Pradesh, Sikkim, Nagaland, Manipur, Mizoram, and Tripura**. Feed coverage and freshness vary; see [the audit](docs/AUDIT.md) and [data-source policy](docs/DATA_SOURCES.md). This project is not validated for emergency operations.

---

## 1. System Architecture

```mermaid
flowchart TD
    subgraph Sources["Configured Data Sources · status varies"]
        CWC["CWC Telemetry (ffs.india-water.gov.in)"]
        IMD["IMD Warnings & Rainfall (api.imd.gov.in)"]
        GSI["GSI Bhusanket Landslide Baseline"]
        OM["Open-Meteo Precipitation (Key-free)"]
        TF["TinyFish Web Agent (Official Bulletins)"]
    end

    subgraph Backend["FastAPI Backend (Port 8000)"]
        Ingest["Ingestion & Data Freshness Engine"]
        FloodEng["Flood Prediction Engine (CWC Marks & Telemetry)"]
        SlideEng["Landslide Engine (ARI Rainfall & Terrain)"]
        RiskEng["Integrated Geo-Risk Engine"]
        Rules["Auto-Alert Rule Engine (R1–R4)"]
        EmailGuard["Email Guard Chain (Sim/Stale/Role Gate)"]
        Audit["Cryptographic Compliance Audit Trail"]
    end

    subgraph Frontend["React 19 + TypeScript + Vite (Port 5173)"]
        MapBoard["District Map Board (MapLibre + MapTiler)"]
        Dashboard["Situational Dashboard & Truth Bar"]
        Telemetry["Location Telemetry Modal"]
        AlertQueue["Operator Alert Approval Queue"]
        RescueUI["Citizen Rescue & Tracking Portal"]
        TinyFishUI["TinyFish Bulletin Extraction Console"]
        SysHealth["System Health & Data Freshness"]
    end

    Sources --> Ingest
    Ingest --> FloodEng & SlideEng
    FloodEng & SlideEng --> RiskEng
    RiskEng --> Rules
    Rules --> AlertQueue
    AlertQueue --> EmailGuard
    EmailGuard --> Audit
    Backend <--> Frontend
```

---

## 2. Product Principles & Safety-First Governance

1. **Safety before automation**: AI-generated alerts are created in `PROPOSED` status and require human operator review before approval and dissemination.
2. **Evidence before prediction**: Every score cites telemetry readings, official CWC danger/warning marks, or documented GSI baseline susceptibility. AI never overrides official government thresholds.
3. **No fabricated data**: Missing, delayed, or unconfigured feeds are displayed honestly as `UNAVAILABLE`, `STALE`, or `MISSING`.
4. **Official warnings remain authoritative**: When retrieved and validated, official IMD and CWC bulletins retain source attribution and distinct `OFFICIAL_AGENCY` status.
5. **Rescue honesty**: Citizen rescue forms explicitly display: *"This form does not dispatch help automatically. In an emergency call 112."*
6. **Public notification guardrail**: `PUBLIC_ALERTS_ENABLED=false` by default until models and telemetry are officially validated by local disaster authorities.

---

## 3. Data Source Status Matrix

| Data Source | Status | Protocol | Provenance & Policy |
|---|---|---|---|
| **CWC station data** | **Variable; verify record status** | Configured feed adapters | Do not treat source health as proof that each measurement is fresh |
| **Open-Meteo weather** | **Variable; verify record status** | Key-free REST API | Keep observation, forecast and gap-filled values distinct |
| **Map basemap** | **External dependency** | Configured tiles / fallback | Visual context only; not hazard evidence |
| **TinyFish extraction** | **Credential and provider dependent** | Agent API (`TINYFISH_API_KEY`) | Retrieved content requires source and timestamp review |
| **IMD district warnings** | **Key-gated** | REST (`IMD_API_KEY`) | No verified feed is guaranteed without authorized credentials and current status |
| **GSI susceptibility** | **Reference / integration dependent** | Source adapter and baseline | Identify the precise data layer and its provenance before calling it live |

---

## 4. Quickstart Guide

### Prerequisites
- **Python 3.11+**
- **Node.js 18+** and **npm**
- **Git**

### A. Clone and Setup
```bash
git clone https://github.com/YOUR_USERNAME/ne-safe-ai.git
cd ne-safe-ai
```

### B. Backend Setup
```bash
# 1. Create and activate virtual environment
python -m venv venv
.\venv\Scripts\activate       # Windows PowerShell
# source venv/bin/activate    # Linux / macOS

# 2. Install dependencies
pip install -r backend/requirements.txt

# 3. Configure environment
copy .env.example .env        # Windows
# cp .env.example .env        # Linux / macOS

# 4. Start FastAPI backend server
uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000 --reload
```
The backend API is accessible at `http://127.0.0.1:8000` with interactive docs at `http://127.0.0.1:8000/docs`.

### C. Frontend Setup
```bash
# In a new terminal:
cd frontend
npm install

# Configure frontend environment
copy .env.example .env        # Windows
# cp .env.example .env        # Linux / macOS

# Start Vite dev server
npm run dev
```
The application dashboard is available at `http://localhost:5173`.

---

## 5. Docker Deployment

Deploy the entire stack with Docker Compose:
```bash
docker-compose up --build
```
- Frontend: `http://localhost:5173`
- Backend API: `http://localhost:8000`

---

## 6. Environment Configuration

### Backend (`.env` or `backend/.env`)
| Variable | Default | Purpose |
|---|---|---|
| `APP_ENV` | `development` | Runtime environment (`development` / `production`) |
| `DATABASE_URL` | `sqlite:///./ne_safe.db` | SQLAlchemy database URL |
| `FRONTEND_ORIGIN` | `http://localhost:5173` | CORS allowed origin |
| `TINYFISH_API_KEY` | *(optional)* | TinyFish Web Agent API key for bulletin extraction |
| `TINYFISH_API_URL` | `https://api.fetch.tinyfish.ai` | TinyFish endpoint |
| `IMD_API_KEY` | *(optional)* | Official IMD REST API key |
| `PUBLIC_ALERTS_ENABLED` | `false` | Master toggle for email dispatch (safety gate) |
| `AUTO_SYNC_ENABLED` | `true` | Scheduled 30-minute background telemetry sync |

### Frontend (`frontend/.env`)
| Variable | Default | Purpose |
|---|---|---|
| `VITE_API_BASE_URL` | `http://127.0.0.1:8000/api/v1` | Backend API URL |
| `VITE_MAPTILER_API_KEY` | *(optional)* | MapTiler key for high-resolution vector basemaps |

---

## 7. Testing & Quality Verification

### Run Backend Test Suite
```bash
pytest backend/tests/ -v
```
Run only in an environment with `backend/requirements.txt` installed. Current verification status is recorded in [docs/TEST_REPORT.md](docs/TEST_REPORT.md).

### Run Frontend Typecheck & Build
```bash
cd frontend
npx tsc -p tsconfig.app.json --noEmit   # Strict TypeScript check (0 errors)
npm run build                          # Production Vite bundle (0 errors)
npm run lint                           # Oxlint scan (review warnings as well as exit code)
```

---

## 8. API Reference Overview

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/v1/health` | Service health, database status, and monitored location counts |
| `GET` | `/api/v1/map/districts` | District-level flood/landslide risk, rainfall, and official warnings |
| `GET` | `/api/v1/risk/geo` | Monitored location GeoJSON with dual-hazard probabilities |
| `GET` | `/api/v1/alerts` | Active and proposed disaster alert queue |
| `POST` | `/api/v1/alerts/{alert_id}/approve` | Operator approval of proposed alerts (`x-user-role: OPERATOR`) |
| `POST` | `/api/v1/rescue-requests` | Citizen assistance submission (returns `RR-XXXXXX`) |
| `POST` | `/api/v1/rescue-requests/{id}/status` | Responder status transition (`SUBMITTED` $\rightarrow$ `RECEIVED` $\rightarrow$ `ASSIGNED` $\rightarrow$ `EN_ROUTE` $\rightarrow$ `SERVED`) |
| `GET` | `/api/v1/reports/situation?format=pdf` | Cryptographically stamped situation report export (PDF / CSV) |
| `GET` | `/api/v1/analytics/overview` | Telemetry analytics datasets for charts |
| `GET` | `/api/v1/sources/tinyfish/status` | TinyFish integration health and rate limit status |
| `POST` | `/api/v1/sources/tinyfish/retrieve` | Authorized government bulletin extraction |

---

## 9. GitHub Repository Upload Instructions

```bash
git init
git add .
git status                   # Confirm .env, *.db, and credentials are NOT staged
git commit -m "Complete NE-SAFE AI early warning system with MapTiler and TinyFish integrations"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/ne-safe-ai.git
git push -u origin main
```

---

## 10. License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.
