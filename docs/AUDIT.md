# NE-SAFE project audit

Audit date: 2026-10-26

## Scope and status

Reviewed the React/Vite frontend, FastAPI backend, data-provenance paths, Docker configuration, setup instructions, and existing QA notes. This remains a prototype; it is not validated or configured for emergency operations.

The frontend builds. The lint command now exits successfully but still reports warnings. Backend source compiles, but the backend test suite could not run because `pytest` and the application's Python dependencies are not installed in this environment. No API process is listening on `127.0.0.1:8000`, so live endpoint and feed behavior could not be rechecked during this audit.

## Changes made

- Moved the Compose SQLite volume from `/app` to `/data`. The previous mount could hide updated application code behind persisted volume contents and keep old code running after rebuilds.
- Added the missing APScheduler runtime dependency required by `backend/app/main.py`.
- Added Docker ignore rules for local credentials, databases, virtual environments, tests, and build artifacts.
- Excluded simulated and non-valid observations from analytics and situation-report measurements; excluded simulated alerts from those aggregates.
- Changed missing risk values to `UNAVAILABLE` and stopped presenting severity rank as a model probability.
- Fixed the conditional React hook in `RainfallBars` that made lint fail.
- Removed the report page's fabricated source states, coverage counts, and client-generated “live” preview. It now explains the limits of backend-generated exports.
- Removed unsupported `LIVE` badges from analytics and clarified that its aggregates use stored records whose freshness varies.
- Corrected the GitHub clone link and removed the misleading `git init` / placeholder upload steps from the README.

## Current limitations

- The current data-source statuses were not re-fetched because the local API is stopped. Previous statuses in [DATA_SOURCES.md](DATA_SOURCES.md) are historical observations only.
- Feed connectivity does not prove that individual measurements are fresh, correctly located, or authoritative. Keep missing or stale evidence distinct from low risk.
- IMD credentials, email delivery, authority contacts, and production identity/authorization remain unconfigured. Role headers are not authentication.
- Do not use the prototype to issue public warnings or make emergency-response decisions.
- The production bundle still has a large map-related JavaScript chunk (about 1.08 MB minified); the map route is lazy-loaded, but further splitting may reduce its download size.

## Verification

See [TEST_REPORT.md](TEST_REPORT.md) for commands and current results. Backend tests, Docker Compose validation, deployed-browser checks, and live feed verification remain unverified in this environment.
