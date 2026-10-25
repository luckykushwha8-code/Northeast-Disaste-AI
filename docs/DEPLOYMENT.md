# Local deployment and safe verification

This is a development/prototype runbook. It does not authorize operational use or public warning dispatch.

## Start from the current checkout (PowerShell)

1. Stop the existing API process from the terminal that launched it. The API answering on port 8000 during the audit is older than the checked-out backend code.
2. From the repository root, activate the project's supported Python environment and install backend requirements if needed:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r backend/requirements.txt
```

3. Copy `.env.example` to `.env` and configure only credentials that have been authorized. Keep `PUBLIC_ALERTS_ENABLED=false`; leave SMTP and authority contacts empty unless delivery is intentionally configured and tested.
4. Start the API from the root:

```powershell
python -m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000 --reload
```

5. In another terminal, run `cd frontend`, install dependencies with `npm ci`, then `npm run dev`.
6. Confirm `/api/v1/health`, `/api/v1/system/data-status`, `/api/v1/weather/now`, and `/api/v1/map/districts`. Check record-level provenance and freshness; an HTTP 200 response alone does not mean data is current or complete.
7. Run frontend build/lint and backend pytest as documented in [TEST_REPORT.md](TEST_REPORT.md).

## Database refresh

Do not delete the current database to address stale synthetic records. First take a backup, inspect the affected observation rows and provenance, and use the project's seed/migration behavior to correct only known legacy fixture records. Recheck map output and risk inputs after startup. A fresh test database is preferable for automated tests.

## Compose

`docker-compose.yml` now sets `ALLOW_SIMULATION=false`. For a deployed environment, also provide secrets through a secret manager, disable debug/reload, configure a persistent database and backups, restrict network access, add real authentication/authorization, and validate all feeds. Do not enable public alert delivery until the email provider and verified authority contacts are configured and controlled receipt testing is complete.
