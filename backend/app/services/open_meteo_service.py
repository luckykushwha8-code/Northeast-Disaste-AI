import datetime
import json
import logging
from typing import Dict, Any, Optional

import httpx
from sqlalchemy.orm import Session

from app.models.entities import LiveDataCache
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
    TTL_MINUTES = 30

    def _get_cache(self, db, key):
        return db.query(LiveDataCache).filter(LiveDataCache.cache_key == key).first()

    def _save_cache(self, db: Session, key: str, payload: Dict[str, Any], source_url: str):
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
        db.commit()

    def _cached_fallback(self, db: Session, key: str, live_error: str) -> Dict[str, Any]:
        cached = self._get_cache(db, key)
        if cached:
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

    def fetch_forecast(self, db: Session, location_id: str,
                       latitude: float, longitude: float) -> Dict[str, Any]:
        """
        Fetch observed + forecast precipitation for one point from Open-Meteo.
        Computes real ARI inputs (24h/72h observed sums, 24h/72h forecast sums).
        """
        key = self.CACHE_KEY_FMT.format(loc_id=location_id)

        cached = self._get_cache(db, key)
        if cached and cached.fetched_at:
            age_min = max(0.0, (_now() - cached.fetched_at).total_seconds() / 60.0)
            if age_min < self.TTL_MINUTES and cached.data_mode == "LIVE":
                payload = json.loads(cached.payload_json)
                payload["data_mode"] = "LIVE"
                payload["cache_hit"] = True
                return payload

        request_url = (
            f"{settings.OPEN_METEO_API_URL}"
            f"?latitude={latitude:.4f}&longitude={longitude:.4f}"
            f"&hourly=precipitation&past_days=3&forecast_days=4&timezone=UTC"
        )
        now = _now()
        try:
            with httpx.Client(timeout=settings.OPEN_METEO_TIMEOUT_SECONDS) as client:
                resp = client.get(request_url, headers={"User-Agent": "NESAFE-AI/1.0"})
                resp.raise_for_status()
                data = resp.json()
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
            last_observed_age = (now - last_observed).total_seconds() / 3600.0 if last_observed else None

            payload = {
                "location_id": location_id,
                "latitude": latitude,
                "longitude": longitude,
                "source": "Open-Meteo (station-assimilated reanalysis + numerical weather forecast)",
                "api_request_url": request_url,
                "model_note": data.get("generationstatus", ""),
                "elevation_m": data.get("elevation"),
                "retrieved_at": now.isoformat(),
                "last_observed_at": last_observed.isoformat() if last_observed else None,
                "last_observed_age_hours": round(last_observed_age, 2) if last_observed_age is not None else None,
                "observed_precipitation_24h_mm": round(obs24, 2),
                "observed_precipitation_72h_mm": round(obs72, 2),
                "forecast_precipitation_24h_mm": round(fc24, 2),
                "forecast_precipitation_72h_mm": round(fc72, 2),
                "data_mode": "LIVE",
                "cache_hit": False,
                "provenance_policy": "Observed precipitation is station-assimilated reanalysis; "
                                     "forecast precipitation is model output. Never labeled as "
                                     "IMD or CWC data."
            }
            self._save_cache(db, key, payload, request_url)
            return payload

        except Exception as e:
            logger.warning("Open-Meteo fetch failed for %s: %s", location_id, e)
            return self._cached_fallback(db, key, str(e))


open_meteo_service = OpenMeteoService()

