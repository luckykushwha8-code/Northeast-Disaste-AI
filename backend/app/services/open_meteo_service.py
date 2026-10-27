import datetime
import json
import logging
import threading
from typing import Any, Dict, Iterable, Optional

import httpx
from sqlalchemy.orm import Session

from app.models.entities import LiveDataCache, DataSource
from app.config import settings

logger = logging.getLogger("open_meteo_service")


def _now() -> datetime.datetime:
    """Injectable clock (UTC, naive) so callers/tests can pin time without
    monkeypatching the global datetime object. Delegates to utcnow semantics."""
    return datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)


def _parse_iso(ts: str) -> Optional[datetime.datetime]:
    try:
        dt = datetime.datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
        if dt.tzinfo is not None:
            dt = dt.astimezone(datetime.timezone.utc).replace(tzinfo=None)
        return dt
    except (ValueError, TypeError):
        return None


class OpenMeteoService:
    """
    Key-free public weather adapter (Open-Meteo): real observed precipitation
    reanalysis plus hourly forecast precipitation for every monitored point.
    Self-contained caching (LiveDataCache, 30 min TTL). Never invents numbers:
    on total failure it returns data_mode UNAVAILABLE, on stale cache it returns
    data_mode CACHED with the cached_at timestamp.
    """

    CACHE_KEY_FMT = "open_meteo_{loc_id}"
    FAILURE_KEY_FMT = "open_meteo_failure_{loc_id}"
    TTL_MINUTES = 30
    FAILURE_COOLDOWN_MINUTES = 15
    CURRENT_CACHE_KEY_FMT = "open_meteo_current_{loc_id}"
    CURRENT_TTL_MINUTES = 10
    CURRENT_STALE_MAX_MINUTES = 180

    def __init__(self):
        # Concurrent map requests share one upstream batch request.
        self._fetch_lock = threading.Lock()

    def _get_cache(self, db, key):
        return db.query(LiveDataCache).filter(LiveDataCache.cache_key == key).first()

    def _save_cache(self, db: Session, key: str, payload: Dict[str, Any], source_url: str,
                    *, commit: bool = True):
        # Deterministic upsert: purge ALL rows with this key first so stale or
        # duplicate entries from previous runs can never shadow fresh data.
        db.query(LiveDataCache).filter(LiveDataCache.cache_key == key).delete()
        entry = LiveDataCache(
            cache_key=key,
            payload_json=json.dumps(payload, default=str),
            source_url=source_url,
            data_mode=payload.get("data_mode", "LIVE"),
            fetched_at=_now()
        )
        db.add(entry)
        if commit:
            db.commit()

    def _mark_health(self, db: Session, succeeded: bool, *, commit: bool = True):
        source = db.query(DataSource).filter(DataSource.id == "src_open_meteo").first()
        if not source:
            return
        if succeeded:
            source.last_success_at = _now()
            source.status = "OPERATIONAL"
        else:
            source.last_error_at = _now()
            source.status = "FAILED"
        if commit:
            db.commit()

    def _cached_fallback(self, db: Session, key: str, live_error: str) -> Dict[str, Any]:
        cached = self._get_cache(db, key)
        if cached and cached.data_mode == "LIVE":
            payload = json.loads(cached.payload_json)
            payload["data_mode"] = "CACHED"
            payload["cached_at"] = cached.fetched_at.isoformat() if cached.fetched_at else None
            payload["live_error"] = live_error[:300]
            return payload
        return {
            "data_mode": "UNAVAILABLE",
            "live_error": live_error[:300],
            "observed_precipitation_24h_mm": None,
            "observed_precipitation_72h_mm": None,
            "forecast_precipitation_24h_mm": None,
            "forecast_precipitation_72h_mm": None
        }

    @staticmethod
    def _age_minutes(entry) -> Optional[float]:
        if not entry or not entry.fetched_at:
            return None
        return max(0.0, (_now() - entry.fetched_at).total_seconds() / 60.0)

    def _build_payload(self, data: Dict[str, Any], location_id: str,
                       latitude: float, longitude: float, request_url: str,
                       now: datetime.datetime) -> Dict[str, Any]:
        hourly = data.get("hourly", {})
        times = hourly.get("time") or []
        precip = hourly.get("precipitation") or []
        if not times or len(times) != len(precip):
            raise ValueError("Open-Meteo payload has no usable hourly series")
        parsed = [(t, _parse_iso(t), v) for t, v in zip(times, precip)]
        parsed = [(t, dt, float(v) if v is not None else 0.0) for (t, dt, v) in parsed
                  if dt is not None]
        past = [(t, dt, v) for (t, dt, v) in parsed if dt <= now]
        future = [(t, dt, v) for (t, dt, v) in parsed if dt > now]
        obs24 = sum(v for (_, dt, v) in past if dt > now - datetime.timedelta(hours=24))
        obs72 = sum(v for (_, dt, v) in past if dt > now - datetime.timedelta(hours=72))
        fc24 = sum(v for (_, dt, v) in future if dt <= now + datetime.timedelta(hours=24))
        fc72 = sum(v for (_, dt, v) in future if dt <= now + datetime.timedelta(hours=72))
        last_observed = max((dt for (_, dt, _) in past), default=None)
        age = (now - last_observed).total_seconds() / 3600.0 if last_observed else None
        return {
            "location_id": location_id,
            "latitude": latitude,
            "longitude": longitude,
            "source": "Open-Meteo (station-assimilated reanalysis + numerical weather forecast)",
            "api_request_url": request_url,
            "model_note": data.get("generationstatus", ""),
            "elevation_m": data.get("elevation"),
            "retrieved_at": now.isoformat(),
            "last_observed_at": last_observed.isoformat() if last_observed else None,
            "last_observed_age_hours": round(age, 2) if age is not None else None,
            "observed_precipitation_24h_mm": round(obs24, 2),
            "observed_precipitation_72h_mm": round(obs72, 2),
            "forecast_precipitation_24h_mm": round(fc24, 2),
            "forecast_precipitation_72h_mm": round(fc72, 2),
            "forecast_period_start_at": now.isoformat(),
            "forecast_period_end_at": (now + datetime.timedelta(hours=24)).isoformat(),
            "data_mode": "LIVE",
            "cache_hit": False,
            "provenance_policy": "Observed precipitation is station-assimilated reanalysis; "
                                 "forecast precipitation is model output. Never labeled as "
                                 "IMD or CWC data."
        }

    def fetch_forecast(self, db: Session, location_id: str,
                       latitude: float, longitude: float) -> Dict[str, Any]:
        """Fetch one point; high-volume callers should use fetch_forecasts."""
        from types import SimpleNamespace
        return self.fetch_forecasts(db, [SimpleNamespace(
            id=location_id, latitude=latitude, longitude=longitude
        )])[location_id]

    def fetch_current_weather(self, db: Session, location: Any) -> Dict[str, Any]:
        """Fetch current model conditions for one monitored location with a short cache."""
        key = self.CURRENT_CACHE_KEY_FMT.format(loc_id=location.id)
        cached = self._get_cache(db, key)
        age = self._age_minutes(cached)
        if cached and cached.data_mode == "LIVE" and age is not None and age < self.CURRENT_TTL_MINUTES:
            payload = json.loads(cached.payload_json)
            payload["cache_hit"] = True
            return payload

        request_url = (
            f"{settings.OPEN_METEO_API_URL}?latitude={location.latitude:.4f}"
            f"&longitude={location.longitude:.4f}"
            "&current=temperature_2m,precipitation,wind_speed_10m"
            "&timezone=UTC"
        )
        now = _now()
        try:
            with httpx.Client(timeout=settings.OPEN_METEO_TIMEOUT_SECONDS) as client:
                response = client.get(request_url, headers={"User-Agent": "NESAFE-AI/1.0"})
                response.raise_for_status()
                data = response.json()
            current = data.get("current") or {}
            if not current.get("time"):
                raise ValueError("Open-Meteo returned no current observation time")
            observed_at = _parse_iso(current["time"])
            payload = {
                "location_id": location.id,
                "location_name": location.name,
                "source": "Open-Meteo public weather model",
                "current": {
                    "time": observed_at.isoformat() + "Z" if observed_at else current["time"],
                    "temperature_2m": current.get("temperature_2m"),
                    "precipitation": current.get("precipitation"),
                    "wind_speed_10m": current.get("wind_speed_10m"),
                },
                "current_units": data.get("current_units") or {},
                "retrieved_at": now.isoformat() + "Z",
                "data_mode": "LIVE",
                "cache_hit": False,
                "live_error": None,
                "provenance_policy": (
                    "Current conditions are Open-Meteo model data, not an official IMD forecast "
                    "or a local rain-gauge observation."
                ),
            }
            self._save_cache(db, key, payload, request_url)
            self._mark_health(db, True)
            return payload
        except Exception as e:
            logger.warning("Open-Meteo current fetch failed for %s: %s", location.id, e)
            if cached and age is not None and age <= self.CURRENT_STALE_MAX_MINUTES:
                payload = json.loads(cached.payload_json)
                payload.update({"data_mode": "CACHED", "cache_hit": True, "live_error": str(e)[:300]})
                return payload
            self._mark_health(db, False)
            return {
                "location_id": location.id,
                "location_name": location.name,
                "source": "Open-Meteo public weather model",
                "current": None,
                "current_units": {},
                "retrieved_at": now.isoformat() + "Z",
                "data_mode": "UNAVAILABLE",
                "cache_hit": False,
                "live_error": str(e)[:300],
                "provenance_policy": (
                    "Current conditions are Open-Meteo model data, not an official IMD forecast "
                    "or a local rain-gauge observation."
                ),
            }

    def fetch_forecasts(self, db: Session, locations: Iterable[Any]) -> Dict[str, Dict[str, Any]]:
        """Fetch multiple points in one request and cache both success and failures."""
        with self._fetch_lock:
            locations = list({loc.id: loc for loc in locations}.values())
            results: Dict[str, Dict[str, Any]] = {}
            pending = []
            for loc in locations:
                key = self.CACHE_KEY_FMT.format(loc_id=loc.id)
                cached = self._get_cache(db, key)
                age = self._age_minutes(cached)
                if cached and cached.data_mode == "LIVE" and age is not None and age < self.TTL_MINUTES:
                    payload = json.loads(cached.payload_json)
                    payload["data_mode"] = "LIVE"
                    payload["cache_hit"] = True
                    results[loc.id] = payload
                    continue
                failure_key = self.FAILURE_KEY_FMT.format(loc_id=loc.id)
                failure = self._get_cache(db, failure_key)
                failure_age = self._age_minutes(failure)
                if failure and failure_age is not None and failure_age < self.FAILURE_COOLDOWN_MINUTES:
                    failure_payload = json.loads(failure.payload_json)
                    results[loc.id] = self._cached_fallback(
                        db, key, failure_payload.get("live_error", "Retry cooldown")
                    )
                    continue
                pending.append(loc)

            if not pending:
                return results

            latitudes = ",".join(f"{loc.latitude:.4f}" for loc in pending)
            longitudes = ",".join(f"{loc.longitude:.4f}" for loc in pending)
            request_url = (
                f"{settings.OPEN_METEO_API_URL}?latitude={latitudes}&longitude={longitudes}"
                "&hourly=precipitation&past_days=3&forecast_days=4&timezone=UTC"
            )
            now = _now()
            try:
                with httpx.Client(timeout=settings.OPEN_METEO_TIMEOUT_SECONDS) as client:
                    response = client.get(request_url, headers={"User-Agent": "NESAFE-AI/1.0"})
                    response.raise_for_status()
                    data = response.json()
                series = data if isinstance(data, list) else [data]
                if len(series) != len(pending):
                    raise ValueError("Open-Meteo returned an unexpected number of locations")
                for loc, point_data in zip(pending, series):
                    payload = self._build_payload(
                        point_data, loc.id, loc.latitude, loc.longitude, request_url, now
                    )
                    key = self.CACHE_KEY_FMT.format(loc_id=loc.id)
                    failure_key = self.FAILURE_KEY_FMT.format(loc_id=loc.id)
                    db.query(LiveDataCache).filter(LiveDataCache.cache_key == failure_key).delete()
                    self._save_cache(db, key, payload, request_url, commit=False)
                    results[loc.id] = payload
                self._mark_health(db, True, commit=False)
                db.commit()
            except Exception as e:
                logger.warning("Open-Meteo batch fetch failed for %s location(s): %s", len(pending), e)
                error = str(e)[:300]
                for loc in pending:
                    failure_key = self.FAILURE_KEY_FMT.format(loc_id=loc.id)
                    self._save_cache(
                        db, failure_key,
                        {"data_mode": "UNAVAILABLE", "live_error": error},
                        request_url, commit=False
                    )
                    key = self.CACHE_KEY_FMT.format(loc_id=loc.id)
                    results[loc.id] = self._cached_fallback(db, key, error)
                self._mark_health(db, False, commit=False)
                db.commit()
            return results


open_meteo_service = OpenMeteoService()

