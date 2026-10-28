# OpenWeather integration

## Existing deployment shape

- FastAPI backend: `backend/`, versioned under `/api/v1`, deployed as a Docker web service on Render.
- React/Vite frontend: `frontend/`, deployed on Vercel. `frontend/vercel.json` rewrites `/api/*` to the Render service.
- The OpenWeather credential is read only by backend settings. Do not create a `VITE_OPENWEATHER_API_KEY` or add a real key to `.env.example`.

## Local setup

From PowerShell:

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
Copy-Item .env.example .env
```

Edit `backend/.env` and set `OPENWEATHER_API_KEY` to the account key. The file is gitignored. Start the backend:

```powershell
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

In a second terminal:

```powershell
cd frontend
npm install
npm run dev
```

Vite proxies `/api` to `http://127.0.0.1:8000`; no OpenWeather key belongs in the frontend. For a production frontend build, run `npm run build` from `frontend/`.

## Backend routes

- `GET /api/v1/health` — backend/database status plus OpenWeather configured and connectivity-verified states. Configured does not mean verified; an actual successful provider request is required.
- `GET /api/v1/weather/locations` — 13 curated point locations covering Assam, Arunachal Pradesh, Meghalaya, Manipur, Mizoram, Nagaland, Sikkim, and Tripura. Each includes coordinates and a coordinate reference.
- `GET /api/v1/weather/current?location_id=wx_guwahati` — current provider point reading. Supported IDs are returned by the locations endpoint. The result carries provider, location, coordinates, units, observation/retrieval timestamps, freshness, and only rainfall periods that the provider returned.
- `GET /api/v1/weather/forecast?provider=openweather&location_id=wx_guwahati` — OpenWeather 5-day / 3-hour forecast, marked `PROVIDER_FORECAST_NOT_OBSERVATION`.
- `GET /api/v1/weather/forecast?provider=open_meteo` — existing Open-Meteo precipitation aggregation remains available for analytics.

The current API calls OpenWeather Current Weather (`/data/2.5/weather`). The forecast API uses 5-day / 3-hour (`/data/2.5/forecast`), which OpenWeather lists for free and paid subscriptions. One Call is not required. Account activation, quotas, or key authorization can still make requests unavailable; the UI reports that state instead of fabricating values. [Current weather API](https://openweathermap.org/api/current), [5-day forecast API](https://openweathermap.org/api/forecast5), [OpenWeather product availability](https://openweathermap.org/price).

Weather point readings and forecasts are not IMD warnings, CWC gauge readings, official rainfall measurements, statewide summaries, or flood/landslide risk scores. Missing provider fields remain unavailable; they are not converted to zero. OpenWeather failures may show clearly attributed Open-Meteo current model data when that separate source is reachable.

## Tests

Backend tests use mocked provider payloads and never write fixture weather into production. Run from `backend/` with a disposable SQLite database:

```powershell
$env:DATABASE_URL = 'sqlite:///./qa_weather_isolated.db'
.\.venv\Scripts\python.exe -m pytest -q
```

Frontend production build:

```powershell
cd frontend
npm run build
```

## Render and Vercel configuration

1. In the Render dashboard, open `ne-safe-preview-api` → Environment and add `OPENWEATHER_API_KEY` as a secret value. Do not put it in a Blueprint, GitHub, a Vercel variable, or frontend build arguments.
2. Keep the Docker service's platform `PORT`; the container command reads `${PORT:-8000}`. Render exposes the service on its configured port.
3. Deploy the backend source change. Check `/api/v1/health`; `configured` should be true, while `connectivity_verified` remains false until the first successful current or forecast request.
4. Request a selected point, for example `/api/v1/weather/current?location_id=wx_guwahati`, and confirm `data_mode: LIVE`, an observation timestamp, and a retrieval timestamp. If not, inspect only the sanitized `availability_status` and `error_code`.
5. Confirm the Vercel rewrite still targets the Render API and open the dashboard map. Select a weather point and confirm that its panel identifies the town, provider, time, and point scope.

Vercel needs no OpenWeather secret. Its existing rewrite forwards same-origin `/api/v1/...` requests to Render. The app can run without an OpenWeather key; in that case health reports `AUTH_REQUIRED` and the weather panel reports unavailable or uses its separately named Open-Meteo fallback.
