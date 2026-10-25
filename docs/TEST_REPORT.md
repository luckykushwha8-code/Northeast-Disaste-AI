# Test and verification report

Run date: 2026-10-25. Results below describe commands and checks executed in the current workspace; previous test counts in older project documents are not treated as current evidence.

| Check | Result | Notes |
|---|---|---|
| Frontend production build | PASS | `npm run build` completed successfully. Vite reports a large map-related chunk (~1.08 MB); this is a performance warning, not a build failure. |
| Frontend lint | PASS WITH WARNINGS | `npm run lint` exited 0. It reports warnings including render-time `Date.now`, `Math.random`, unused values and effect dependency concerns. |
| Backend syntax | PASS | `py_compile` succeeded for the modified backend modules. This does not execute application behavior or tests. |
| Backend unit/integration suite | NOT RUN | `npm run test:backend` failed because `pytest` was not found. The bundled Python lacks pytest; the existing workspace Python executable was denied by the environment. |
| API process health | PASS, STALE PROCESS | `GET /api/v1/health` returned HTTP 200, HEALTHY, database connected, 19 locations. The process predates current backend source changes. |
| API source status | MIXED | Last check: IMD FAILED, CWC OPERATIONAL, GSI OPERATIONAL, Bhuvan DELAYED, synthetic IoT STALE. |
| Map API provenance | FAIL ON RUNNING PROCESS | `/api/v1/map/districts` returned 15 districts but did not expose `simulation_flag`. Current checked-out code includes provenance changes; restart required to verify them. |
| Browser route smoke | PASS | Map, rescue, reports and subscriptions rendered; map scene controls and GPS button rendered; the removed advisory notice is absent; no console errors after clean reload. |
| Viewport checks | PASS FOR SAMPLED SIZES | 1440×900, 1366×585 and 390×844 checked. Does not replace full device/browser/accessibility coverage. |

## Reproduction

From the repository root:

```powershell
npm run build
npm run lint
npm run test:backend
```

For backend tests, first activate an environment with `backend/requirements.txt` installed. The current environment did not support that test run, so do not treat this report as a green backend suite.
