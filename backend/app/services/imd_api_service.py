import datetime
import json
import logging
import time
from typing import Any, Dict, List, Optional

import httpx
from sqlalchemy.orm import Session

from app.models.entities import LiveDataCache, DataSource
from app.config import settings

logger = logging.getLogger("imd_api_service")


def _now() -> datetime.datetime:
    """Injectable clock (UTC, naive) — mirrors open_meteo_service convention."""
    return datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)


class ImdApiService:
    """Server-side adapter for the India Meteorological Department REST API
    (https://api.imd.gov.in, endpoints + schemas per the official provider
    documentation). Official district feeds for flood/landslide-relevant NE data.

    Design rules:
    - One method per documented endpoint; query params passed through verbatim.
    - Responds NEVER raise: total failure -> data_mode UNAVAILABLE (+ live_error),
      stale cache -> data_mode CACHED with cached_at, auth failure -> AUTH_ERROR.
    - API key transport configurable (IMD_API_AUTH_STYLE / IMD_API_HEADER_NAME)
      because the official docs do not pin down the auth mechanism.
    - Raw upstream payload is preserved in LiveDataCache for debugging but never
      re-synthesized: rows are returned as parsed records only.
    - Honors official cadence via per-endpoint TTLs from settings.
    """

    # endpoint slug -> (url path, ttl setting name, response normalization)
    ENDPOINTS: Dict[str, Dict[str, Any]] = {
        "rainfall":   {"path": "/api/v1/districtrainfall",   "ttl": "IMD_RAINFALL_TTL_MINUTES"},
        "warnings":   {"path": "/api/v1/districtwarning",    "ttl": "IMD_WARNING_TTL_MINUTES"},
        "nowcast":    {"path": "/api/v1/districtnowcast",    "ttl": "IMD_NOWCAST_TTL_MINUTES"},
        "qpf":        {"path": "/api/v1/basinqpf",           "ttl": "IMD_QPF_TTL_MINUTES"},
        "aws":        {"path": "/api/v1/aws_data",           "ttl": "IMD_AWS_TTL_MINUTES"},
        "aws_map":    {"path": "/api/v1/aws_data_mapping",   "ttl": "IMD_AWS_TTL_MINUTES"},
        "state_district_rf_forecast":
                      {"path": "/api/v1/state_district_rainfall_forecast",
                       "ttl": "IMD_WARNING_TTL_MINUTES"},
    }

    ROLE: Dict[str, str] = {
        "rainfall":   "Official IMD district rainfall dataset (Daily/Weekly/Cumulative Actual vs Normal).",
        "warnings":   "Official IMD district warnings, Day1-5 with color codes (1=Green...4=Red).",
        "nowcast":    "Official IMD <=3h district nowcast categories Cat1-19.",
        "qpf":        "Official IMD flood-met-office river-basin quantitative precipitation forecast (AAP, Day1-5).",
        "aws":        "Official IMD AWS/ARG automatic-station current readings (temp/RH/wind, lat/lon).",
        "aws_map":    "Official IMD AWS station mapping (station id/coordinates).",
        "state_district_rf_forecast":
                      "Official IMD 5-day district rainfall distribution forecast.",
    }

    def _endpoint_base(self, slug: str) -> str:
        ep = self.ENDPOINTS.get(slug)
        if not ep:
            raise ValueError(f"Unknown IMD endpoint slug: {slug}")
        return getattr(settings, "IMD_BASE_URL", "https://api.imd.gov.in").rstrip("/") + ep["path"]

    def _auth_request(self, path: str, id_param: Optional[str]) -> str:
        url = f"{getattr(settings, 'IMD_BASE_URL', 'https://api.imd.gov.in').rstrip('/')}{path}"
        params: List[str] = []
        if id_param:
            params.append(f"id={id_param}")
        api_key = getattr(settings, "IMD_API_KEY", None)
        auth_style = getattr(settings, "IMD_API_AUTH_STYLE", "")
        if api_key and auth_style == "query":
            params.append(f"api-key={api_key}")
        if params:
            url += "?" + "&".join(params)
        return url

    def _headers(self) -> Dict[str, str]:
        headers = {"User-Agent": "NESAFE-AI/1.0 (assessment prototype)"}
        api_key = getattr(settings, "IMD_API_KEY", None)
        if api_key and getattr(settings, "IMD_API_AUTH_STYLE", "") == "header":
            headers[getattr(settings, "IMD_API_HEADER_NAME", "X-API-Key")] = api_key
        return headers

    def _get_cache(self, db, key):
        return db.query(LiveDataCache).filter(LiveDataCache.cache_key == key).first()

    def _save_cache(self, db: Session, key: str, payload: Dict[str, Any], source_url: str):
        db.query(LiveDataCache).filter(LiveDataCache.cache_key == key).delete()
        db.add(LiveDataCache(
            cache_key=key,
            payload_json=json.dumps(payload, default=str),
            source_url=source_url,
            data_mode=payload.get("data_mode", "LIVE"),
            fetched_at=_now()
        ))
        db.commit()

    def _cached_fallback(self, db: Session, slug: str, live_error: str,
                         status: str = "UNAVAILABLE") -> Dict[str, Any]:
        key = f"imd_{slug}"
        cached = self._get_cache(db, key)
        if cached:
            payload = json.loads(cached.payload_json)
            payload["data_mode"] = "CACHED"
            payload["cached_at"] = cached.fetched_at.isoformat() if cached.fetched_at else None
            payload["live_error"] = live_error[:300]
            payload["source_status"] = status
            return payload
        return {
            "data_mode": "UNAVAILABLE",
            "source_status": status,
            "live_error": live_error[:300],
            "endpoint": self._endpoint_base(slug),
            "retrieved_at": _now().isoformat(),
            "rows": []
        }

    def fetch_endpoint(self, db: Session, slug: str,
                       id_param: Optional[str] = None) -> Dict[str, Any]:
        """Call one IMD endpoint honoring its TTL cache; classify and normalize."""
        ep_def = self.ENDPOINTS[slug]
        key = f"imd_{slug}"

        ttl_min = int(getattr(settings, ep_def["ttl"], 60))
        now = _now()
        cached = self._get_cache(db, key)
        if cached and cached.fetched_at and cached.data_mode == "LIVE":
            age_min = max(0.0, (now - cached.fetched_at).total_seconds() / 60.0)
            if age_min < ttl_min:
                payload = json.loads(cached.payload_json)
                payload["data_mode"] = "LIVE"
                payload["cache_hit"] = True
                return payload

        if not getattr(settings, "IMD_API_KEY", None):
            self._mark_health(db, False, status="AUTH_REQUIRED")
            return self._cached_fallback(db, slug, "IMD_API_KEY is not configured", status="AUTH_REQUIRED")

        request_url = self._auth_request(ep_def["path"], id_param)
        headerless_url = self._endpoint_base(slug) + (f"?id={id_param}" if id_param else "")

        last_error = None
        for attempt in range(max(1, getattr(settings, "IMD_RETRY_COUNT", 0) + 1)):
            try:
                with httpx.Client(timeout=getattr(settings, "IMD_TIMEOUT_SECONDS", 8)) as client:
                    resp = client.get(request_url, headers=self._headers())
                status_code = resp.status_code
                if status_code in (401, 403):
                    detail = f"HTTP {status_code}: IMD API key missing/invalid or not provisioned"
                    self._mark_health(db, False, status="AUTH_ERROR")
                    payload = self._cached_fallback(db, slug, detail, status="AUTH_ERROR")
                    if payload.get("data_mode") == "UNAVAILABLE":
                        payload["auth_note"] = (
                            "Official docs list these endpoints but do not describe the auth "
                            "transport; adapter is key-ready (header/query configurable) and must "
                            "not be presented as live without credentials."
                        )
                    return payload
                resp.raise_for_status()
                raw = resp.json()
                rows = self._normalize_rows(raw)
                payload = {
                    "data_mode": "LIVE",
                    "source_status": "FRESH",
                    "endpoint": ep_def["path"],
                    "endpoint_base": getattr(settings, "IMD_BASE_URL", "https://api.imd.gov.in").rstrip("/") + ep_def["path"],
                    "role": self.ROLE[slug],
                    "api_key_configured": bool(getattr(settings, "IMD_API_KEY", None)),
                    "auth_style": getattr(settings, "IMD_API_AUTH_STYLE", None) if getattr(settings, "IMD_API_KEY", None) else None,
                    "retrieved_at": now.isoformat(),
                    "row_count": len(rows),
                    "rows": rows,
                    "provenance_policy": "Rows mirror official IMD field names verbatim; "
                                         "observation time is the IMD Date field where present, "
                                         "never the fetch time.",
                    "cache_hit": False
                }
                self._save_cache(db, key, payload, headerless_url)
                self._mark_health(db, True)
                return payload

            except (httpx.TimeoutException, httpx.TransportError) as e:
                last_error = f"network error: {type(e).__name__}"
                time.sleep(0.5)
            except ValueError as e:
                last_error = f"invalid response: {e}"
                break
            except Exception as e:
                last_error = str(e)
                break

        self._mark_health(db, False, status="FAILED")
        return self._cached_fallback(db, slug, last_error or "unknown error")

    def _normalize_rows(self, raw: Any) -> List[Dict[str, Any]]:
        """IMD payloads vary: {status,message,data:[...]} wrappers, bare lists, or
        single objects. Extract records without rewriting field names."""
        if isinstance(raw, dict):
            for k in ("data", "results", "records"):
                inner = raw.get(k)
                if isinstance(inner, list):
                    return inner
                if isinstance(inner, dict):
                    # e.g. aws mapping dicts keyed by call sign
                    return [{"key": k2, **(v if isinstance(v, dict) else {"value": v})}
                            for k2, v in inner.items()]
            # some endpoints return a single object record
            if raw.get("District") or raw.get("Station") or raw.get("Basin"):
                return [raw]
            return []
        if isinstance(raw, list):
            return raw
        raise ValueError("unsupported payload shape")

    def _mark_health(self, db: Session, ok: bool, status: str = "FAILED"):
        try:
            src = db.query(DataSource).filter(DataSource.id == "src_imd_api").first()
            if src:
                src.status = "OPERATIONAL" if ok else status
                if ok:
                    src.last_success_at = _now()
                else:
                    src.last_error_at = _now()
                db.commit()
        except Exception as e:  # health marking must never break the fetch flow
            logger.warning("IMD source health mark failed: %s", e)
            db.rollback()


imd_api_service = ImdApiService()
