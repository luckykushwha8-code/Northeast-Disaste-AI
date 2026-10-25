# Test and verification report

Run date: 2026-10-26

| Check | Result | Notes |
|---|---|---|
| Frontend production build | PASS | `npm run build` completed. Vite still reports a ~1.08 MB minified map-related chunk. |
| Frontend lint | PASS WITH WARNINGS | `npm run lint` exits 0 after fixing the conditional `useId` hook. Existing hook/effect and unused-code warnings remain. |
| Backend source syntax | PASS | Python 3.12 compiled all 32 backend application modules. |
| Backend unit/integration suite | NOT RUN | `pytest`, FastAPI, SQLAlchemy, APScheduler, and Pydantic Settings are absent from the available Python environment. |
| Local API health and provenance | NOT AVAILABLE | `127.0.0.1:8000` refused the connection; there is no running API process to verify. |
| Docker Compose config | NOT RUN | Docker is not installed in this environment. |
| Browser and external feeds | NOT RUN | No live server or external-feed verification was performed in this pass. |

## Reproduction

From the repository root:

```powershell
npm run build
npm run lint
python -m pip install -r backend/requirements.txt
python -m pytest backend/tests/ -v
docker compose config --quiet
```

Run the backend tests and Compose check in an environment with the listed dependencies installed. Do not treat syntax checks or an HTTP health response alone as proof that measurements are fresh or emergency-ready.
