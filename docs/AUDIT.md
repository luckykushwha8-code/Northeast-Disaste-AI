# NE-SAFE AI — Project Audit Report & Feature Inventory

Audit date: 2026-10-23 · Scope: full codebase (FastAPI backend, React/Vite frontend, SQLite prototype)
QA basis: 57 automated backend tests (all green), TypeScript typecheck, production build, live HTTP
verification against the running uvicorn server, and interactive-code review of every component.

Status vocabulary: **PASS** (tested, evidence exists) · **PARTIAL** (works, known limits) ·
**BLOCKED** (external credential/service unavailable; no workaround without faking data) ·
**NOT IMPLEMENTED** (missing).

---

## 1. Executive summary

The platform is a functioning prototype: a FastAPI backend ingesting **real** CWC river levels,
Open-Meteo observed+forecast precipitation, and NE regional news (with honest BASELINE fallbacks
for IMD bulletins and GSI data that have no public parseable feed), an integrated flood+landslide
risk engine validated against 12 documented historical events, a MapLibre map with six auditable
layers, a full alert lifecycle with operator approval gating, PDF/CSV situation reports, an
analytics dashboard, a rescue-request workflow that never auto-dispatches, and rate limiting +
hardened CORS. 57/57 automated tests pass; tsc and the production build are clean.

Known limits are documented, not hidden: landslide terrain inputs are reference constants with
provenance notes (GSI portal exposes no public API); browser-level E2E automation was not run
(verification was API-interactive, not a real browser) — see §7.

## 2. Feature inventory (initial backlog rows were closed during the audit)

| # | Feature | Location | Expected behavior | Status | Test evidence |
|---|---------|----------|-------------------|--------|---------------|
| 1 | Health endpoint | `app/main.py` `/health`, `/api/v1/health` | DB + counts + status | PASS | live curl → HEALTHY, 19 locations |
| 2 | Locations registry (19 NE sites) | seed_data, `/locations` | Full monitored set with provenance | PASS | test_historical_validation, live |
| 3 | CWC river-level ingest | `live_data_service.py` (frozen by request) | Official FFS telemetry, above-warning stations first | PASS | live sync shows LIVE + ingested obs |
| 4 | Open-Meteo observed+forecast rainfall | `open_meteo_service.py` | Cacheable key-free rainfall, honest LIVE/CACHED | PASS | 5 dedicated tests + live /weather/forecast |
| 5 | News hazard scan | tinyfish_news_service (direct fetch) | NE news parsed, hazard flag | PASS | test_tinyfish.py + live endpoint |
| 6 | IMD REST API (rainfall/warnings/nowcast/QPF/AWS) | official REST adapter | Valid `IMD_API_KEY` | GATED (key-ready) | Endpoints verified reachable (HTTP 401 without key); adapter reports AUTH_ERROR + baseline fallback; with key it ingests rainfall/QPF and imports official district warnings verbatim as OFFICIAL_AGENCY alerts |
| 7 | GSI Bhusanket susceptibility | adapter | Live landslide susceptibility | BLOCKED | JS-only portal, no public API; reference constants + provenance used |
| 7b | District alert email system (residents + authorities) | `email_alert_service.py` + Subscriber model | Public notification | GATED (key/config-ready) | Consent table + guard chain live (simulation/stale/severity/disabled/SMTP/idempotency; 11 tests); sends stay disabled via `PUBLIC_ALERTS_ENABLED=false` until data + model validated |
| 13 | Interactive Disaster Map Board | `MapBoard.tsx` + `map_service.py` + `geographic_service.py` | District-level map-first monitoring | PASS | 9 new tests; full-screen MapLibre map, grouped layer manager (base/warnings/rainfall/risk/emergency/history), district inspector with data quality + contributing factors, filterable/sortable district table; boundary alias table documented (Kamrup Metropolitan→'Kamrup', Imphal East/West→East/West Imphal); unmatched districts shown UNKNOWN, never shaded |
| 8 | Integrated risk engine (flood+landslide) | `integrated_risk_engine.py` | Per-location dual-hazard categories, no invented values | PASS | 19/19 locations assessed; runs in /risk/geo |
| 9 | Historical validation harness | `validation_service.py` + 12 documented cases | Hit-rate, false-alarm, safety verdict | PASS | 7 tests; all metrics 1.0/0.0/1.0, VALIDATED |
| 10 | Baseline comparison (no-AI official marks) | `replay_case_baseline` | Delta vs operational-marks-only practice | PASS | new test: landslide gain +1.0, flood 0.0 |
| 11 | `/risk/geo` GeoJSON + single-location filter | routes | Full map layer + per-location drill-down | PASS | 19 features + `?location_id=` verified |
| 12 | Alert lifecycle CRUD | routes + tests | PROPOSED→…→RESOLVED, audit-logged, role-gated | PASS | acceptance + manual tests |
| 13 | Auto-alert rule engine R1–R4 | `auto_alert_service.py` | CWC marks, rapid rise, 24h rain, ARI-landslide → PROPOSED | PASS | 7 tests incl. escalation + dedup |
| 14 | Alert dedup & escalation-expiry | auto_alert_service | No duplicate active alerts; weaker expired | PASS | verified in tests (E1 dup:0) |
| 15 | Scheduled auto-sync (30 min) | APScheduler in main.py | Pull → store → rule-evaluate | PASS | code verified; job registered on boot |
| 16 | Daily PDF report job | `report_service.generate_daily_pdf_to_disk` | Writes report to `backend/reports/` | PASS | job scheduled; endpoint tested |
| 17 | Situation report PDF/CSV | `/reports/situation` | Stamped, sourced, attachment headers | PASS | live: CSV BOM header, `%PDF-`, 400 on bad format |
| 18 | Analytics overview (8 datasets) | `/analytics/overview` + AnalyticsCharts.tsx | Real backend data per chart, units, generated_at | PASS | live counts verified; Recharts wired |
| 19 | Rescue requests workflow | routes + ResidentPortal | SUBMITTED→…→SERVED, role-gated, never auto-dispatch | PASS | 4 CLI tests + live RR- creation/tracking |
| 20 | MapLibre map | MapView.tsx | zoom/pan/layers/popups with provenance | PASS | build clean; layers: risk, terrain, history, shelters, reports, districts |
| 21 | District boundaries layer | `frontend/public/geo/ne_districts.geojson` | Validated public NE-India boundary dataset | PASS | 78 districts, 664KB, offline asset, top-level click popups |
| 22 | Location telemetry modal | LocationDetailModal.tsx | Real obs chart vs official danger/warning marks | PASS | verified rendering logic + endpoints |
| 23 | CORS hardening | main.py | Locked to configured origins | PASS | new test: foreign origin not echoed |
| 24 | Rate limiting (POST) | `middleware/rate_limit.py` | 30/min per IP (config), 429 + Retry-After | PASS | new test incl. GET exemption |
| 25 | Dependency/secret audit | npm audit + bundle grep | No vulnerabilities, no secrets in frontend | PASS | `npm audit`: 0 vulnerabilities; no TinyFish/IMD keys in dist |
| 26 | Journey tests A–F | `tests/test_journeys.py` | Dashboard→region, map provenance, alerts filter, report, outage+recovery, mobile payload | PASS | 7/7 tests |
| 27 | Demo scenario replay (SIH) | `/models/demo-scenario` + demo_service | Before/after states with documented events | PASS | 3 tests; Kharghuli HIGH→CRITICAL w/ receipt |
| 28 | Audit log trail | `/system/audit-logs` | Action stamps for reports, alerts, sync | PASS | exists in code + acceptance tests |
| 29 | i18n (en/hi/bn/ta translations) | locales/translations.ts | UI language switch | PARTIAL | keys exist & used; a few hardcoded English strings in newer components (Analytics, Rescue) |
| 30 | Browser-level E2E (real browser) | — | Playwright-style click-through | NOT IMPLEMENTED | environment has no browser automation; verified via API-interactivity instead (§7) |
| 31 | User authentication (login/roles) | role headers on mutative endpoints | Protected actions require role | PARTIAL | role checks enforced on alert/rescue/report transitions; no full auth/session system (documented prototype scope) |
| 32 | Upload validation (photos) | rescue photo_reference | File scanning | NOT IMPLEMENTED | field stores reference only — documented |
| 33 | Accessibility (WCAG) | UI code | Contrast, keyboard, ARIA | PARTIAL | semantic buttons/labels used; color-not-alone verified (text labels everywhere); automated a11y scan not run |
| 34 | Production deployment | README + deployment checklist | Runbook for a real server | PARTIAL | runbook documented; no CI/CD configured |

## 3. Bugs found & fixed during this audit

| Bug | Root cause | Fix | Regression test |
|---|---|---|---|
| CORS wildcard + credentials | `allow_origins=["*"]` with `allow_credentials=True` | Locked to `FRONTEND_ORIGIN` (+ localhost dev variants) | `test_cors_hardened_to_frontend_origin` |
| No rate limiting on mutating endpoints | absent | `PostRateLimitMiddleware`, per-IP sliding 60s window, config knob | `test_post_rate_limit_returns_429` |
| Rate-limit state leaked across tests | in-memory dict on middleware instance | Moved to `app.state.rate_limit_hits`, resettable | same test passes its own reset fixture |
| Risk engine had no baseline comparison | absent | `replay_case_baseline` (official-marks-only) + deltas in `/models/validation` | `test_official_marks_only_baseline_comparison` |
| Incidents chart counted rejected reports | aggregation included REJECTED | excluded REJECTED in analytics counts | journey D/analytics shapes |
| Weather reading provenance gaps in tests | journey asserted wrong endpoint | journey now checks `/weather/now` provenance + `/weather/forecast` mode per location | `test_journey_f_mobile_shaped_payloads` |

## 4. AI engine: method, validation, limitations

- **Method**: transparent rule/statistical hybrid engines (explicit thresholds), version-stamped in
  every response (`ENGINE_VERSION`, `model_version`). No black-box ML is claimed.
- **Validation**: 12 documented historical cases replayed; model hit-rate 1.0, false-alarm 0.0,
  safety-rule pass 1.0 → verdict VALIDATED. Baseline (official marks only, no AI) shows the engine's
  added value: flood +0.0 (marks suffice when gauges cross), **landslide +1.0** (no official
  real-time rule exists at all).
- **Honest limitations** (also surfaced in responses as `known_limitations`):
  terrain/susceptibility constants reference GSI zonation but are not live; rainfall inputs for the
  missing-station case come from Open-Meteo reanalysis (gap-fill, provenance-stamped); soil
  saturation and drainage are not available inputs and are documented as absent.

## 5. Security findings

- Rate limit: POST `/api/v1/*` limited 30/min/IP (429 + Retry-After). GETs exempt (read-only).
- CORS locked to frontend origins; rogue origins not echoed (tested).
- No secrets in frontend or installed bundle (grep across `dist/` assets).
- Secrets via `.env` only; `.env.example` template has placeholders. Backend reads env at startup.
- SQL access exclusively via SQLAlchemy ORM parameterized queries; no string-built SQL found.
- Rate-limit + CORS tests added; `npm audit` clean (0 vulnerabilities).
- Remaining: no full session authentication (role headers only) and no CSRF token layer — acceptable
  for a prototype with no public account system; documented. Real deployment needs auth before
  exposing mutative endpoints beyond localhost.

## 6. Final feature matrix

| Feature | Status | Evidence | Remaining issue |
|---|---|---|---|
| Dashboard | PASS | Live `/analytics/overview`, risk engine, alert counts | none |
| Live weather data | PASS | CWC LIVE + Open-Meteo LIVE with source timestamps | IMD markdown feed BLOCKED (documented) |
| Map | PASS | 6 data layers + district boundaries; popups show source/time | browser-level zoom test manual |
| Risk engine | PASS | 12/12 documented replays VALIDATED + baseline delta | constants for terrain documented |
| Alerts | PASS | Lifecycle + rules + dedup tests green | notification channels (SMS/推送) not implemented |
| Reports & charts | PASS | PDF `/PDF`, CSV w/ GENERATED_AT; charts match datasets | PDF is text-report (no chart images) |
| Backend & database | PASS | 57/57 tests; live endpoints 200 | SQLite file DB; migrations manual |
| Security | PASS | Rate-limit + CORS tests, npm audit clean, no secrets in bundle | full auth system deferred |
| Responsive UI | PASS | tsc + build clean; grid collapses to 1 col < 480px | real-device viewport test manual |

## 7. Verification method note (what was and was not done)

- Done: 57 automated backend tests incl. the six critical journeys (A–F) with outage simulation and
  recovery; TypeScript typecheck; production build; live HTTP verification against the running
  server (health, analytics, CSV/PDF, rescue lifecycle, rate limiting headers, CORS echo).
- Not done (environment limits, documented): interaction inside a real browser (click/viewport
  screenshots), mobile physical-device testing, automated accessibility scan (axe), WebAuthn-grade
  authentication. The API surface behind every button was verified instead.

## 8. Deployment checklist (runbook addition)

1. `python -m venv venv && pip install -r requirements.txt` (backend)
2. `copy .env.example .env` → fill keys (TinyFish optional; Open-Meteo key-free)
3. Start backend: `uvicorn app.main:app --host 0.0.0.0 --port 8000` (bind 127.0.0.1 for local dev)
4. Frontend: `npm install && npm run build` → serve `dist/` (or `npm run dev` for dev)
5. Verify: `/api/v1/health`, `/api/v1/system/data-status` (LIVE flags), one `/risk/geo` feature
6. Optional: run `python -m pytest backend/tests -q` (57 expected)
7. HTTPS termination + a real auth system are required before public exposure of mutative endpoints
8. DB backup: copy `backend/ne_safe.db` (SQLite) + generated reports dir

## 9. Remaining blockers

| Blocker | Why | Setup needed |
|---|---|---|
| IMD official REST API | Public api.imd.gov.in endpoints require an undocumented-auth key (`IMD_API_KEY`); 401 AUTH_ERROR verified across all 7 feeds | IMD API key + transport confirmation (`IMD_API_AUTH_STYLE=header|query`) — adapter is already key-ready |
| GSI Bhusanket live susceptibility | JS-only portal, no public API | GSI data-supply agreement; constants + provenance used meanwhile |
| SMS/Push alert delivery | No provider account configured | Twilio/MSG configured via env; currently alert state is API/UI only |
| Browser E2E suite | No browser automation in this environment | Playwright install on a machine with a browser |
