"""OpenWeather current conditions and 5-day forecast with explicit provenance."""

import copy
import datetime as dt
import logging
import threading
from typing import Any, Dict, Optional, Tuple

import httpx

from app.config import settings

logger = logging.getLogger("openweather_service")
UTC = dt.timezone.utc


def _now() -> dt.datetime:
    return dt.datetime.now(UTC)


def _iso_timestamp(epoch: Any) -> Optional[str]:
    try:
        return dt.datetime.fromtimestamp(float(epoch), tz=UTC).isoformat().replace("+00:00", "Z")
    except (TypeError, ValueError, OSError, OverflowError):
        return None


class OpenWeatherService:
    """Fetches provider data without writing credentials or observations to the DB."""

    CURRENT_MAX_AGE_SECONDS = 3 * 60 * 60
    CURRENT_STALE_CACHE_SECONDS = 3 * 60 * 60
    FORECAST_STALE_CACHE_SECONDS = 6 * 60 * 60

    def __init__(self):
        self._lock = threading.RLock()
        self._current_cache: Dict[str, Tuple[dt.datetime, Dict[str, Any]]] = {}
        self._forecast_cache: Dict[str, Tuple[dt.datetime, Dict[str, Any]]] = {}
        self.last_success_at: Optional[str] = None
        self.last_error_at: Optional[str] = None
        self.last_status = "NOT_CHECKED"
        self.last_error_code: Optional[str] = None

    @property
    def configured(self) -> bool:
        return bool(settings.OPENWEATHER_API_KEY and settings.OPENWEATHER_API_KEY.strip())

    def validate_configuration(self) -> Dict[str, Any]:
        """Startup-only configuration check; connectivity is verified on request."""
        if not self.configured:
            self.last_status = "AUTH_REQUIRED"
            self.last_error_code = "MISSING_API_KEY"
        elif self.last_status == "AUTH_REQUIRED":
            self.last_status = "NOT_CHECKED"
            self.last_error_code = None
        return self.status()

    def status(self) -> Dict[str, Any]:
        if not self.configured:
            status = "AUTH_REQUIRED"
        else:
            status = self.last_status
        return {
            "configured": self.configured,
            "status": status,
            "connectivity_verified": status in {"OPERATIONAL", "STALE"},
            "last_success_at": self.last_success_at,
            "last_error_at": self.last_error_at,
            "last_error_code": self.last_error_code,
        }

    @staticmethod
    def _location_metadata(location: Any) -> Dict[str, Any]:
        return {
            "location_id": location.id,
            "location_name": getattr(location, "name", getattr(location, "city", "Monitored point")),
            "city": getattr(location, "city", None),
            "state": getattr(location, "state", None),
            "district": getattr(location, "district", None),
            "latitude": float(location.latitude),
            "longitude": float(location.longitude),
            "spatial_scope": "point_observation_not_state_summary",
        }

    def _unavailable(self, location: Any, message: str, error_code: Optional[str] = None) -> Dict[str, Any]:
        return {
            **self._location_metadata(location),
            "source": "OpenWeather Current Weather API",
            "current": None,
            "current_units": {},
            "retrieved_at": _now().isoformat().replace("+00:00", "Z"),
            "observed_at": None,
            "data_mode": "UNAVAILABLE",
            "availability_status": self.status()["status"],
            "cache_hit": False,
            "cache_age_seconds": None,
            "live_error": message,
            "error_code": error_code,
            "provenance_policy": "Provider point data; not an IMD warning, CWC gauge reading, or state-wide summary.",
        }

    def _cached(self, cache, key: str, limit_seconds: int, mode: str) -> Optional[Dict[str, Any]]:
        entry = cache.get(key)
        if not entry:
            return None
        saved_at, payload = entry
        age = max(0, int((_now() - saved_at).total_seconds()))
        if age > limit_seconds:
            return None
        result = copy.deepcopy(payload)
        result["data_mode"] = mode
        result["availability_status"] = "CACHED" if mode == "CACHED" else payload.get("availability_status", "OPERATIONAL")
        result["cache_hit"] = True
        result["cache_age_seconds"] = age
        return result

    def _request(self, endpoint: str, location: Any) -> Tuple[Dict[str, Any], dt.datetime]:
        # httpx params encodes appid and coordinates; do not log the URL or exception text.
        response = httpx.get(
            endpoint,
            params={
                "lat": float(location.latitude),
                "lon": float(location.longitude),
                "appid": settings.OPENWEATHER_API_KEY,
                "units": "metric",
            },
            timeout=settings.OPENWEATHER_TIMEOUT_SECONDS,
            headers={"User-Agent": "GeoShield/1.0 weather-client"},
        )
        response.raise_for_status()
        body = response.json()
        if not isinstance(body, dict):
            raise ValueError("Invalid provider response")
        return body, _now()

    def _handle_error(self, location: Any, error_code: str, message: str, cache, cache_key: str, max_cache: int):
        self.last_error_at = _now().isoformat().replace("+00:00", "Z")
        self.last_error_code = error_code
        self.last_status = "AUTH_ERROR" if error_code in {"HTTP_401", "HTTP_403"} else "FAILED"
        logger.warning("OpenWeather request unavailable for %s (%s)", location.id, error_code)
        stale = self._cached(cache, cache_key, max_cache, "CACHED")
        if stale:
            stale["availability_status"] = "CACHED"
            stale["live_error"] = message
            return stale
        result = self._unavailable(location, message, error_code)
        result["availability_status"] = self.last_status
        return result

    def _record_error(self, location: Any, exc: Exception, *, cache, cache_key: str, max_cache: int):
        if isinstance(exc, httpx.HTTPStatusError):
            status_code = exc.response.status_code
            code = f"HTTP_{status_code}"
            if status_code in (401, 403):
                message = "OpenWeather denied access. Check the backend key and the account's product access."
            elif status_code == 429:
                message = "OpenWeather rate limit reached. Retry after the provider limit resets."
            else:
                message = f"OpenWeather returned HTTP {status_code}."
        elif isinstance(exc, httpx.TimeoutException):
            code, message = "TIMEOUT", "OpenWeather did not respond before the request timeout."
        elif isinstance(exc, ValueError):
            code, message = "INVALID_RESPONSE", "OpenWeather returned incomplete or invalid weather data."
        elif isinstance(exc, httpx.RequestError):
            code, message = "CONNECTION_ERROR", "OpenWeather could not be reached."
        else:
            code, message = "PROVIDER_ERROR", "OpenWeather data is temporarily unavailable."
        return self._handle_error(location, code, message, cache, cache_key, max_cache)

    @staticmethod
    def _parse_current(body: Dict[str, Any], location: Any, retrieved: dt.datetime) -> Dict[str, Any]:
        main = body.get("main") or {}
        wind = body.get("wind") or {}
        clouds = body.get("clouds") or {}
        weather_list = body.get("weather") or []
        weather = weather_list[0] if weather_list and isinstance(weather_list[0], dict) else {}
        if not isinstance(main.get("temp"), (int, float)) or not body.get("dt"):
            raise ValueError("OpenWeather current response missing temperature/time")

        observed_at = _iso_timestamp(body.get("dt"))
        if observed_at is None:
            raise ValueError("OpenWeather current response timestamp invalid")
        observed_time = dt.datetime.fromtimestamp(float(body["dt"]), tz=UTC)
        age_seconds = max(0, int((retrieved - observed_time).total_seconds()))
        rain = body.get("rain") if isinstance(body.get("rain"), dict) else {}
        snow = body.get("snow") if isinstance(body.get("snow"), dict) else {}
        rainfall = {period: rain.get(period) for period in ("1h", "3h") if isinstance(rain.get(period), (int, float))}
        snowfall = {period: snow.get(period) for period in ("1h", "3h") if isinstance(snow.get(period), (int, float))}
        current = {
            "time": observed_at,
            "temperature_2m": main.get("temp"),
            "feels_like": main.get("feels_like"),
            "relative_humidity_2m": main.get("humidity"),
            "surface_pressure": main.get("pressure"),
            "wind_speed_10m": wind.get("speed"),
            "wind_direction_deg": wind.get("deg"),
            "wind_gust_10m": wind.get("gust"),
            "cloud_cover_percent": clouds.get("all"),
            "weather_condition": weather.get("main"),
            "weather_description": weather.get("description"),
            "weather_icon": weather.get("icon"),
            "rainfall": rainfall,
            "snowfall": snowfall,
        }
        return {
            **OpenWeatherService._location_metadata(location),
            "source": "OpenWeather Current Weather API",
            "current": current,
            "current_units": {
                "temperature_2m": "°C", "feels_like": "°C", "relative_humidity_2m": "%",
                "surface_pressure": "hPa", "wind_speed_10m": "m/s", "wind_gust_10m": "m/s",
                "wind_direction_deg": "°", "cloud_cover_percent": "%", "rainfall": "mm",
                "snowfall": "mm",
            },
            "retrieved_at": retrieved.isoformat().replace("+00:00", "Z"),
            "observed_at": observed_at,
            "observation_age_seconds": age_seconds,
            "data_mode": "STALE" if age_seconds > OpenWeatherService.CURRENT_MAX_AGE_SECONDS else "LIVE",
            "availability_status": "STALE" if age_seconds > OpenWeatherService.CURRENT_MAX_AGE_SECONDS else "OPERATIONAL",
            "cache_hit": False,
            "cache_age_seconds": None,
            "live_error": None,
            "provenance_policy": "OpenWeather point conditions. Not an IMD warning or a local rain-gauge reading; rainfall periods are provider-reported only.",
        }

    def fetch_current_weather(self, location: Any) -> Dict[str, Any]:
        if not self.configured:
            self.last_status = "AUTH_REQUIRED"
            return self._unavailable(location, "OpenWeather is not configured in the backend environment.", "MISSING_API_KEY")
        with self._lock:
            cached = self._cached(self._current_cache, location.id, settings.OPENWEATHER_CACHE_TTL_SECONDS, "LIVE")
            if cached:
                return cached
            try:
                body, retrieved = self._request(settings.OPENWEATHER_API_URL, location)
                payload = self._parse_current(body, location, retrieved)
                self._current_cache[location.id] = (retrieved, copy.deepcopy(payload))
                self.last_success_at = retrieved.isoformat().replace("+00:00", "Z")
                self.last_status = payload["availability_status"]
                self.last_error_code = None
                return payload
            except (httpx.HTTPStatusError, httpx.TimeoutException, httpx.RequestError, ValueError, TypeError, KeyError) as exc:
                return self._record_error(
                    location, exc, cache=self._current_cache, cache_key=location.id,
                    max_cache=self.CURRENT_STALE_CACHE_SECONDS,
                )

    def fetch_forecast(self, location: Any) -> Dict[str, Any]:
        if not self.configured:
            return {
                **self._location_metadata(location), "source": "OpenWeather 5 day / 3 hour Forecast API",
                "forecast": [], "retrieved_at": _now().isoformat().replace("+00:00", "Z"),
                "data_mode": "UNAVAILABLE", "availability_status": "AUTH_REQUIRED",
                "cache_hit": False, "live_error": "OpenWeather is not configured in the backend environment.",
            }
        with self._lock:
            cached = self._cached(
                self._forecast_cache, location.id,
                settings.OPENWEATHER_FORECAST_CACHE_TTL_SECONDS, "LIVE",
            )
            if cached:
                return cached
            try:
                body, retrieved = self._request(settings.OPENWEATHER_FORECAST_API_URL, location)
                items = body.get("list")
                if not isinstance(items, list):
                    raise ValueError("OpenWeather forecast response missing list")
                forecast = []
                for item in items:
                    main = item.get("main") or {}
                    if not item.get("dt"):
                        continue
                    rain = item.get("rain") if isinstance(item.get("rain"), dict) else {}
                    snow = item.get("snow") if isinstance(item.get("snow"), dict) else {}
                    weather_rows = item.get("weather") or []
                    weather = weather_rows[0] if weather_rows and isinstance(weather_rows[0], dict) else {}
                    forecast.append({
                        "forecast_at": _iso_timestamp(item["dt"]),
                        "temperature_c": main.get("temp"),
                        "feels_like_c": main.get("feels_like"),
                        "precipitation_probability": item.get("pop"),
                        "rainfall_3h_mm": rain.get("3h"),
                        "snowfall_3h_mm": snow.get("3h"),
                        "weather_condition": weather.get("main"),
                        "weather_description": weather.get("description"),
                        "cloud_cover_percent": (item.get("clouds") or {}).get("all"),
                    })
                if not forecast:
                    raise ValueError("OpenWeather forecast response contained no forecast timestamps")
                payload = {
                    **self._location_metadata(location),
                    "source": "OpenWeather 5 day / 3 hour Forecast API",
                    "forecast_kind": "PROVIDER_FORECAST_NOT_OBSERVATION",
                    "forecast": forecast,
                    "forecast_units": {
                        "temperature_c": "°C", "feels_like_c": "°C", "rainfall_3h_mm": "mm / 3h",
                        "snowfall_3h_mm": "mm / 3h", "cloud_cover_percent": "%",
                    },
                    "retrieved_at": retrieved.isoformat().replace("+00:00", "Z"),
                    "data_mode": "LIVE", "availability_status": "OPERATIONAL",
                    "cache_hit": False, "cache_age_seconds": None, "live_error": None,
                    "provenance_policy": "Forecast values are provider model forecasts, not observed rainfall or official warnings.",
                }
                self._forecast_cache[location.id] = (retrieved, copy.deepcopy(payload))
                self.last_success_at = retrieved.isoformat().replace("+00:00", "Z")
                self.last_status = "OPERATIONAL"
                self.last_error_code = None
                return payload
            except (httpx.HTTPStatusError, httpx.TimeoutException, httpx.RequestError, ValueError, TypeError, KeyError) as exc:
                result = self._record_error(
                    location, exc, cache=self._forecast_cache, cache_key=location.id,
                    max_cache=self.FORECAST_STALE_CACHE_SECONDS,
                )
                return {
                    **result,
                    "forecast": [],
                    "forecast_kind": "PROVIDER_FORECAST_NOT_OBSERVATION",
                    "source": "OpenWeather 5 day / 3 hour Forecast API",
                }


openweather_service = OpenWeatherService()
