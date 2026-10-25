# NE-SAFE project audit

Audit date: 2026-10-25

Scope: React/Vite frontend, FastAPI backend, data provenance, map experience, deployment configuration, and the running local app.

## Summary

The project is a useful prototype with a district map, flood and landslide layers, rainfall markers, location detail, alerts, rescue request workflow, reports, analytics, and health views. The frontend build and map browser smoke checks passed during this audit. The backend test suite was not executed because `pytest` is unavailable in the current Python runtimes. The API process currently answering on `127.0.0.1:8000` is older than the backend source in this checkout; it exposes stale rainfall records without provenance flags. Therefore the local running instance cannot yet be considered data-correct after the code fixes until it is restarted and the database is refreshed/reseeded.

This project is a prototype. It is not validated or configured for emergency operations. Real observations, forecasts, reference terrain data, and demo fixtures must remain distinguishable in every map, chart, alert, and export.

## Verified feature inventory

| Area | Evidence in code / runtime | Audit result |
|---|---|---|
| FastAPI API and SQLite persistence | `/api/v1/health` returned HTTP 200 and 19 locations from the running server | Runtime reachable; running server version is stale |
| District map | MapLibre map board with district boundaries, rainfall stations, hazard overlays, filters, inspector and district table | Frontend renders; map markers and overlays verified in browser |
| Rainfall and risk provenance | Backend changes now propagate simulation flags and exclude demo/invalid observations from risk calculations | Source fixed; running backend still needs restart |
| Unknown/stale risk state | Risk engine avoids converting missing or stale evidence into an apparently safe low-risk result | Source reviewed and Python syntax compiled |
| Rescue workflow | UI and API provide request/tracking workflow; emergency phone links use `tel:` | Feature exists; no evidence of emergency-team dispatch integration |
| Email notifications | Subscription is stored; public email delivery requires SMTP, verified contacts, and the disabled master switch | Not configured; UI copy corrected to avoid claiming an email was sent |
| External feeds | Running status endpoint reported IMD failed, CWC operational, GSI operational, Bhuvan delayed, synthetic IoT stale | External status is mixed; credentials and feed semantics limit operational use |
| Authentication | UI role selection/role-gated screens and request headers exist | Not a production identity or authorization system |
| Responsive map screen | Desktop and mobile browser viewports checked; the map workspace fits the viewport and controls remain usable | Pass for checked widths; manual accessibility audit remains |

## Fixes made in this checkout

- Prevented the prediction endpoint from substituting another location's CWC observation or a hardcoded rainfall amount.
- Made map output carry simulation provenance and use observed rainfall records rather than a fabricated fallback.
- Excluded simulated or invalid observations from risk computation; missing/stale inputs stay unknown.
- Corrected seeded sample observations so legacy copies are identified as synthetic demo records.
- Removed the global advisory banner and its unused translated copy, tightened the one-screen map layout, improved rainfall markers and animated overlays, and added a reduced-motion path.
- Corrected subscription feedback so saved subscriptions are not described as delivered emails; added direct emergency call links.
- Removed the reports advisory banner at the user's request; replaced invented dashboard freshness/sync values with actual feed-health counts and a manual refresh action.
- Removed the rescue form's default Guwahati coordinates; requests now require a captured GPS position, with an explicit emergency-call path when location access is unavailable.
- Changed the Docker Compose simulation setting to `false` by default.

## Outstanding defects and risks

1. **Running backend is stale.** The live map API did not include simulation flags. It returned rainfall records timestamped 2026-10-23 from an old process even though the source fixes are present locally. Restart the backend and reseed/clean legacy synthetic rows before trusting live status.
2. **Official data is not fully available.** IMD reported failed; IMD key is empty. Current local data-status also reports Bhuvan delayed and a stale synthetic IoT source. CWC/GSI being operational does not establish that every displayed layer is live, fresh, or suitable for warnings.
3. **Email and authority dispatch are disabled/unconfigured.** SMTP settings and verified authority contact configuration are absent. Current success is limited to storing subscription intent; no email is claimed as sent.
4. **Backend tests are unverified.** `pytest` was not found in PATH or the bundled Python runtime; the existing workspace interpreter could not be executed. Do not use prior documentation claiming a passing test count.
5. **Production security is incomplete.** Role headers and a front-end role selector are not authentication. Do not expose mutating endpoints publicly without real identity, authorization, audit review, and deployment controls.
6. **Map basemap credentials and external tiles.** Map rendering depends on network availability and configured tile access; boundary data works as a local asset, but basemap styling can be unavailable offline.
7. **Performance.** Vite reports a large map-related chunk (~1.08 MB). The build succeeds, but route-level map dependency splitting or asset review could improve first load.

## Test evidence

- `frontend`: `npm run build` passed after the interface/map work.
- `frontend`: `npm run lint` exited successfully but reports warnings; it is not warning-free.
- Backend: changed Python files passed `py_compile`; this checks syntax only.
- Browser smoke: map, rescue, and subscription routes rendered; map animation controls worked; no console errors after a clean reload; checked 1440×900, 1366×585, and 390×844 viewports.
- Backend pytest suite: not run (`pytest` unavailable). See [TEST_REPORT.md](TEST_REPORT.md).

## Recommended next steps

1. Restart API process using the checked-out backend source; confirm `/api/v1/health` and `/api/v1/map/districts` expose provenance fields.
2. Refresh/reseed database; confirm all historical hardcoded demo measurements are tagged synthetic and excluded from risk calculations.
3. Run backend tests from an accessible Python environment with `backend/requirements.txt` installed.
4. Validate each source's station/location, timestamp, units, quality, freshness and attribution before enabling user-facing warnings.
5. Keep email dispatch disabled until SMTP and authority contacts are configured and a controlled end-to-end receipt test is completed.
6. Replace role headers with a real identity provider before public deployment.
