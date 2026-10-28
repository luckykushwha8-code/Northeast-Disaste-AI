import datetime
import json
import re
import logging
from typing import Dict, Any, List, Optional
import httpx
from sqlalchemy.orm import Session

from app.config import settings
from app.models.entities import Observation, DataSource, LiveDataCache
from app.services.ingestion import IngestionService
from app.services.flood_engine import DANGER_LEVEL_M, WARNING_LEVEL_M
from app.services.tinyfish_service import tinyfish_service

logger = logging.getLogger("live_data")

HAZARD_KEYWORDS = [
    "flood", "landslide", "flash flood", "monsoon", "cloudburst", "rain",
    "embankment", "dam release", "river", "erosion", "erode", "waterlog",
    "waterlogging", "cyclone", "depression warning", "storm"
]

MONITORED_STATION_CODES = {
    "loc_pandu_ghat": "022-MBAPU",
    "loc_cachar_silchar": "014-BRSIL",
    "loc_pasighat_siang": "031-SNGPAS",
    "loc_teesta_mangan": "008-TSTMAN",
    "loc_imphal_river": "019-IMPSAN",
    "loc_dimapur_dhansiri": "025-DHSDIM",
    "loc_agartala_howrah": "047-TRSHWR"
}

STATION_RIVER_NAMES = {
    "loc_pandu_ghat": "Brahmaputra",
    "loc_cachar_silchar": "Barak",
    "loc_pasighat_siang": "Siang (Brahmaputra)",
    "loc_teesta_mangan": "Teesta",
    "loc_imphal_river": "Imphal",
    "loc_dimapur_dhansiri": "Dhansiri",
    "loc_agartala_howrah": "Howrah"
}

STATION_STATES = {
    "loc_pandu_ghat": "Assam",
    "loc_cachar_silchar": "Assam",
    "loc_pasighat_siang": "Arunachal Pradesh",
    "loc_teesta_mangan": "Sikkim",
    "loc_imphal_river": "Manipur",
    "loc_dimapur_dhansiri": "Nagaland",
    "loc_agartala_howrah": "Tripura"
}

BASELINE_REFERENCES = {
    "loc_pandu_ghat": {"warning_level_m": 48.68, "danger_level_m": 49.68, "hfl_m": 51.46},
    "loc_cachar_silchar": {"warning_level_m": 18.87, "danger_level_m": 19.83, "hfl_m": 21.66},
    "loc_pasighat_siang": {"warning_level_m": 152.00, "danger_level_m": 153.96, "hfl_m": 157.54},
    "loc_teesta_mangan": {"warning_level_m": 860.00, "danger_level_m": 865.00, "hfl_m": 872.20},
    "loc_imphal_river": {"warning_level_m": 788.00, "danger_level_m": 790.30, "hfl_m": 792.80},
    "loc_dimapur_dhansiri": {"warning_level_m": 146.50, "danger_level_m": 148.00, "hfl_m": 150.20},
    "loc_agartala_howrah": {"warning_level_m": 6.00, "danger_level_m": 6.30, "hfl_m": 7.60}
}

CACHE_TTL_MINUTES = 30


class LiveDataService:
    """Fetches, parses, caches and ingests real live data from the official CWC
    Flood Forecasting System API (FFS), IMD bulletins via TinyFish, and verified
    Northeast regional news outlets."""

    def _get_cache(self, db: Session, key: str) -> Optional[LiveDataCache]:
        return db.query(LiveDataCache).filter(LiveDataCache.cache_key == key).first()

    def _save_cache(self, db: Session, key: str, payload: Dict[str, Any],
                    source_url: str, mode: str = "LIVE"):
        entry = self._get_cache(db, key)
        fetched_at = datetime.datetime.utcnow()
        if entry:
            entry.payload_json = json.dumps(payload, default=str)
            entry.source_url = source_url
            entry.data_mode = mode
            entry.fetched_at = fetched_at
        else:
            entry = LiveDataCache(
                cache_key=key,
                payload_json=json.dumps(payload, default=str),
                source_url=source_url,
                data_mode=mode,
                fetched_at=fetched_at
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
        return {"data_mode": "UNAVAILABLE", "live_error": live_error[:300]}

    def _mark_source_health(self, db: Session, source_id: str, operational: bool):
        src = db.query(DataSource).filter(DataSource.id == source_id).first()
        if src:
            src.enabled = True
            if operational:
                src.last_success_at = datetime.datetime.utcnow()
                src.status = "OPERATIONAL"
            else:
                src.last_error_at = datetime.datetime.utcnow()
                src.status = "FAILED"
            db.commit()

    def _tinyfish_extract(self, db: Session, url: str, purpose: str) -> Optional[str]:
        try:
            record = tinyfish_service.execute_retrieval(
                db=db, url=url, content_format="markdown",
                purpose=purpose, simulate_if_unavailable=False
            )
            return record.extracted_text
        except Exception as e:
            logger.warning("TinyFish extraction failed for %s: %s", url, e)
            return None

    # ----------------- CWC LIVE TELEMETRY -----------------
    def fetch_cwc_stations(self, db: Session) -> Dict[str, Any]:
        """Live station telemetry from the CWC Flood Forecasting System SPA backend API."""
        now = datetime.datetime.utcnow()
        url = settings.CWC_FFS_ABOVE_WARNING_API
        try:
            with httpx.Client(timeout=settings.REQUEST_TIMEOUT_SECONDS) as client:
                resp = client.get(url, headers={"User-Agent": "Mozilla/5.0 NESAFE/1.0"})
                resp.raise_for_status()
                live_rows = resp.json()
            if not isinstance(live_rows, list):
                raise ValueError("Unexpected FFS payload structure")

            live_stations = []
            for row in live_rows:
                code = str(row.get("stationCode", "")).strip()
                if not code:
                    continue
                value = row.get("value")
                source_time = next((row.get(key) for key in (
                    "observedAt", "observationTime", "observation_time", "lastUpdatedAt", "timestamp", "dateTime"
                ) if row.get(key)), None)
                observed_at = None
                if source_time:
                    try:
                        observed_at = datetime.datetime.fromisoformat(str(source_time).replace("Z", "+00:00"))
                        if observed_at.tzinfo is not None:
                            observed_at = observed_at.astimezone(datetime.timezone.utc).replace(tzinfo=None)
                    except (TypeError, ValueError):
                        observed_at = None
                live_stations.append({
                    "station_code": code,
                    "status": str(row.get("status", "UNKNOWN")).upper(),
                    "trend": str(row.get("trend", "UNKNOWN")).upper(),
                    "current_level_m": float(value) if value is not None else None,
                    "observed_at": observed_at.isoformat() if observed_at else None,
                    "retrieved_at": now.isoformat(),
                    "reading_status": "DATED_READING" if observed_at else "UNVERIFIED_TIME",
                    "data_mode": "LIVE"
                })

            ingested = []
            loc_by_code = {v.upper(): k for k, v in MONITORED_STATION_CODES.items()}
            for st in live_stations:
                loc_id = loc_by_code.get(st["station_code"].upper())
                level = st["current_level_m"]
                if not loc_id or level is None or level <= 0 or not st.get("observed_at"):
                    continue
                obs = IngestionService.normalize_and_ingest(
                    db=db,
                    source_id="src_cwc_brahmaputra",
                    location_id=loc_id,
                    observed_at=datetime.datetime.fromisoformat(st["observed_at"]),
                    variable="river_level_m",
                    raw_value=level,
                    raw_unit="m",
                    provenance=f"CWC FFS Live telemetry ({st['station_code']})",
                    simulation_flag=False
                )
                ingested.append({
                    "location_id": loc_id,
                    "river_level_m": level,
                    "trend": st["trend"],
                    "observed_at": st["observed_at"],
                    "retrieved_at": st["retrieved_at"],
                })

            monitored = []
            for loc_id, ref_code in MONITORED_STATION_CODES.items():
                ref = BASELINE_REFERENCES.get(loc_id, {})
                match = next(
                    (s for s in live_stations if s["station_code"].upper() == ref_code),
                    None
                )
                monitored.append({
                    "location_id": loc_id,
                    "station_code": ref_code,
                    "station_name": ref_code,
                    "river": STATION_RIVER_NAMES.get(loc_id, "River"),
                    "state": STATION_STATES.get(loc_id, ""),
                    "warning_level_m": ref.get("warning_level_m"),
                    "danger_level_m": ref.get("danger_level_m"),
                    "hfl_m": ref.get("hfl_m"),
                    "current_level_m": match["current_level_m"] if match and match.get("observed_at") else None,
                    "observed_at": match["observed_at"] if match else None,
                    "retrieved_at": now.isoformat(),
                    "reading_status": match["reading_status"] if match else "NO_CURRENT_LEVEL",
                    "trend": match["trend"] if match else "NOT_ISSUED",
                    "status": "ABOVE_WARNING_RECORD" if match else "NO_ABOVE_WARNING_RECORD",
                    "data_mode": "LIVE" if match else "NO_CURRENT_LEVEL"
                })

            payload = {
                "source": "Central Water Commission (CWC) Flood Forecasting Network",
                "portal_url": "https://ffs.india-water.gov.in/",
                "api_endpoint": url,
                "attribution": "Government of India - Ministry of Jal Shakti / CWC",
                "retrieved_at": now.isoformat(),
                "data_mode": "LIVE",
                "note": "The endpoint lists stations returned by its above-warning query. "
                        "A station omitted from the response has no level in this feed; "
                        "absence is not treated as a current reading or an all-clear.",
                "stations_above_warning": live_stations,
                "monitored_brahmaputra_region_stations": monitored,
                "ingested_observations": ingested,
                "official_danger_level_pandu_m": DANGER_LEVEL_M,
                "official_warning_level_pandu_m": WARNING_LEVEL_M
            }
            self._save_cache(db, "cwc_stations", payload, url, "LIVE")
            self._mark_source_health(db, "src_cwc_brahmaputra", True)
            return payload

        except Exception as e:
            logger.warning("CWC live fetch failed: %s", e)
            self._mark_source_health(db, "src_cwc_brahmaputra", False)
            return self._cached_fallback(db, "cwc_stations", str(e))

    # ----------------- IMD LIVE BULLETINS -----------------
    def fetch_imd_warnings(self, db: Session) -> Dict[str, Any]:
        """Retrieve the official public all-India forecast bulletin via TinyFish.

        The extracted bulletin is preserved verbatim. Unstructured text is never
        converted into district alerts or made to look like a structured feed.
        """
        now = datetime.datetime.utcnow()
        url = "https://mausam.imd.gov.in/responsive/districtWiseWarningGIS.php?day=1"
        text = self._tinyfish_extract(
            db, url,
            "Read the official IMD district-wise warning page for day 1. Return the page heading, displayed forecast dates, and text explicitly present. Do not infer district warning levels from map colors or images, and do not invent rainfall amounts or validity periods."
        )
        publication_date = self._official_publication_date(text or "")
        is_warning_page = bool(text and re.search(r"district\s*wise\s+warnings", text, re.IGNORECASE))
        is_northeast_bulletin = bool(text and re.search(
            r"northeast|north\s*-?\s*eastern|assam|arunachal|manipur|meghalaya|mizoram|nagaland|sikkim|tripura",
            text,
            re.IGNORECASE,
        ))
        is_recent = bool(publication_date and abs((now.date() - publication_date).days) <= 1)
        if text and len(text.strip()) > 100 and is_warning_page and is_recent:
            payload = {
                "source": "India Meteorological Department (IMD) public website",
                "source_url": url,
                "retrieved_at": now.isoformat(),
                "source_issue_date": publication_date.isoformat(),
                "attribution": "Government of India - Ministry of Earth Sciences / IMD",
                "data_mode": "LIVE",
                "bulletin_text": text[:12000],
                "warnings": [],
                "note": "Current official district-warning map page retrieved. Warning colors and map symbols are not converted into district alerts; use the linked IMD page for the official map."
            }
            self._save_cache(db, "imd_warnings", payload, url, "LIVE")
            self._mark_source_health(db, "src_imd_api", True)
            return payload
        reason = "IMD district-warning page did not expose a current dated warning map; extracted text is withheld from live feeds"
        self._mark_source_health(db, "src_imd_api", False)
        return {"data_mode": "UNAVAILABLE", "live_error": reason, "source": "India Meteorological Department (IMD) public website", "source_url": url, "warnings": [], "bulletin_text": None, "note": reason}

    @staticmethod
    def _official_publication_date(text: str) -> Optional[datetime.date]:
        """Read a publication date from source text; never substitute retrieval time."""
        if not text:
            return None
        match = re.search(r"(\d{4}-\d{2}-\d{2}|\d{2}[-/]\d{2}[-/]\d{4}|(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},?\s+\d{4})", text, re.IGNORECASE)
        if not match:
            return None
        raw = match.group(1)
        for fmt in ("%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y"):
            try:
                return datetime.datetime.strptime(raw, fmt).date()
            except ValueError:
                continue
        for fmt in ("%B %d, %Y", "%b %d, %Y", "%d %B %Y", "%d %b %Y"):
            try:
                return datetime.datetime.strptime(raw, fmt).date()
            except ValueError:
                continue
        return None

    # ----------------- NE REGIONAL NEWS -----------------
    def fetch_news(self, db: Session, hazard_only: bool = False) -> Dict[str, Any]:
        """Live Northeast India news headlines from verified regional outlets."""
        now = datetime.datetime.utcnow()
        articles: List[Dict[str, Any]] = []

        for source_url in settings.NEWS_SOURCES:
            domain = re.sub(r"^https?://", "", source_url).split("/")[0]
            try:
                with httpx.Client(timeout=settings.REQUEST_TIMEOUT_SECONDS) as client:
                    resp = client.get(
                        source_url,
                        headers={"User-Agent": "Mozilla/5.0 NESAFE/1.0"},
                        follow_redirects=True
                    )
                    resp.raise_for_status()
                    html = resp.text
            except Exception as e:
                logger.warning("News fetch failed for %s: %s", source_url, e)
                continue

            headings = re.findall(r"<h[1-4][^>]*>(.*?)</h[1-4]>", html, re.S)
            all_links = re.findall(r"href=\"(https?://[^\"]+)\"", html)
            article_links = [l for l in all_links if domain in l]

            seen = set()
            for idx, raw in enumerate(headings[:250]):
                title = re.sub(r"<[^>]+>", " ", raw)
                title = title.replace("&#8217;", "'").replace("&#8216;", "'")
                title = title.replace("&quot;", '"').replace("&#038;", "&")
                title = title.replace("&amp;", "&").replace("&nbsp;", " ")
                title = re.sub(r"&#\d+;", "", title)
                title = re.sub(r"\s+", " ", title).strip()
                if len(title) < 25 or len(title) > 220 or title.lower() in seen:
                    continue
                seen.add(title.lower())
                is_hazard = any(k in title.lower() for k in HAZARD_KEYWORDS)
                if hazard_only and not is_hazard:
                    continue
                articles.append({
                    "title": title,
                    "source_domain": domain,
                    "source_url": source_url,
                    "article_link": article_links[idx] if idx < len(article_links) else source_url,
                    "disaster_related": is_hazard,
                    "retrieved_at": now.isoformat()
                })

        articles.sort(key=lambda a: (not a["disaster_related"], a["source_domain"]))
        payload = {
            "retrieved_at": now.isoformat(),
            "data_mode": "LIVE",
            "total_articles": len(articles),
            "disaster_related_count": sum(1 for a in articles if a["disaster_related"]),
            "attribution": "EastMojo & The Sentinel Assam - verified Northeast regional news outlets",
            "articles": articles[:60]
        }
        self._save_cache(db, "ne_news", payload, ",".join(settings.NEWS_SOURCES), "LIVE")
        return payload

    # ----------------- GSI OFFICIAL PAGE -----------------
    def fetch_gsi_susceptibility(self, db: Session) -> Dict[str, Any]:
        """Fetch the official GSI page without treating static text as a live advisory."""
        url = "https://bhusanket.gsi.gov.in/"
        self._tinyfish_extract(
            db, url,
            "Identify whether this page contains a dated current operational landslide bulletin. Return its publication time, affected districts and original bulletin text only if present. Do not classify static portal information as a live advisory."
        )
        reason = "No dated current GSI landslide bulletin was verified; portal content is not treated as current risk data"
        self._mark_source_health(db, "src_gsi_landslide", False)
        return {"data_mode": "UNAVAILABLE", "live_error": reason, "source": "Geological Survey of India (GSI)", "portal_url": url, "susceptibility_zones": [], "note": reason}

    # ----------------- FULL SYNC -----------------
    def sync_all(self, db: Session) -> Dict[str, Any]:
        summary: Dict[str, Any] = {
            "sync_started_at": datetime.datetime.utcnow().isoformat(),
            "sources": {}
        }
        try:
            s = self.fetch_cwc_stations(db)
            summary["sources"]["cwc_ffs"] = s.get("data_mode", "UNAVAILABLE")
        except Exception as e:
            summary["sources"]["cwc_ffs"] = f"ERROR: {str(e)[:180]}"
        try:
            s = self.fetch_imd_warnings(db)
            summary["sources"]["imd_live_bulletins"] = s.get("data_mode", "UNAVAILABLE")
        except Exception as e:
            summary["sources"]["imd_live_bulletins"] = f"ERROR: {str(e)[:180]}"
        try:
            s = self.fetch_gsi_susceptibility(db)
            summary["sources"]["gsi_bhusanket"] = s.get("data_mode", "UNAVAILABLE")
        except Exception as e:
            summary["sources"]["gsi_bhusanket"] = f"ERROR: {str(e)[:180]}"
        try:
            s = self.fetch_news(db)
            summary["sources"]["regional_news"] = s.get("total_articles", 0)
            summary["disaster_related_headlines"] = s.get("disaster_related_count", 0)
        except Exception as e:
            summary["sources"]["regional_news"] = f"ERROR: {str(e)[:180]}"
        summary["sync_completed_at"] = datetime.datetime.utcnow().isoformat()
        db.commit()
        return summary


live_data_service = LiveDataService()
