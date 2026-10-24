"""
Map service: district-level aggregation for the interactive disaster map.

Combines verified observations, prototype risk-engine estimates, verbatim
official warnings, verified incidents and shelters per platform district
with documented boundary resolution status. Nothing fabricated: every block
carries its own data_mode (FRESH / STALE / MISSING / PROTOTYPE / OFFICIAL).
"""
import datetime
from app.time_utils import utcnow
import logging
from typing import Dict, Any, List, Optional

from sqlalchemy.orm import Session

from app.config import settings
from app.models.entities import (
    Location, Observation, Alert, IncidentReport, Shelter, DisasterEvent
)
from app.services.integrated_risk_engine import IntegratedRiskEngine
from app.services.geographic_service import geographic_service, PLATFORM_DISTRICT_ALIAS

logger = logging.getLogger("map_service")

SEVERITY_RANK = {"UNKNOWN": 0, "LOW": 1, "MODERATE": 2, "HIGH": 3, "CRITICAL": 4}
ACTIVE_LIFECYCLES = ["PROPOSED", "REVIEWED", "APPROVED", "ISSUED", "ACKNOWLEDGED"]

ENGINE_NAME = "nesafe-map-districts-v1.0"

GEODATA_META = {
    "source": "geohacker/india district boundaries (public India mapping data), NE subset",
    "feature_count": len(geographic_service.features()),
    "crs": "EPSG:4326 (GeoJSON lon/lat as delivered)",
    "license": "open India mapping datasets — attribution displayed on the map",
    "coverage_note": (
        "district snapshot dataset; does not guarantee post-reorganisation splits. "
        "Platform districts resolve to polygons via an explicit documented alias table "
        "(application services geographic_service.PLATFORM_DISTRICT_ALIAS); unmatched "
        "districts are shown UNKNOWN (gray), never silently shaded."
    ),
    "last_verified": "2026-10-23"
}


def _freshness(age_hours: Optional[float], limit: float) -> str:
    if age_hours is None:
        return "MISSING"
    return "FRESH" if age_hours <= limit else "STALE"


class MapService:
    @staticmethod
    def _latest_obs_by_var(db: Session, location_ids: List[str]) -> Dict[str, Dict[str, Any]]:
        """Newest observation of each monitored variable per location."""
        now = utcnow()
        out: Dict[str, Dict[str, Any]] = {}
        obs = db.query(Observation).filter(
            Observation.location_id.in_(location_ids),
            Observation.variable.in_(["rainfall_24h_mm", "river_level_m", "river_rate_m_hr"])
        ).order_by(Observation.observed_at.desc()).all()
        for o in obs:
            slot = out.setdefault(o.location_id, {})
            if o.variable in slot:
                continue
            age = (now - o.observed_at).total_seconds() / 3600.0
            slot[o.variable] = {
                "value": o.value,
                "unit": o.unit,
                "observed_at": o.observed_at.isoformat(),
                "age_hours": round(age, 2),
                "quality_status": o.quality_status,
                "provenance": o.provenance,
                "source_id": o.source_id
            }
        return out

    @classmethod
    def district_summaries(cls, db: Session) -> Dict[str, Any]:
        now = utcnow()
        generated_at = now.isoformat()

        locs = db.query(Location).filter(Location.active == True).all()

        # ---- verified incidents + shelters by containment (no invented mapping) ----
        # containment returns the BOUNDARY dataset name; map it back to the
        # platform district via the reverse alias table (documented, explicit).
        def platform_from_boundary(bname: str, mon: set) -> Optional[str]:
            if bname in mon:
                return bname
            for plat, aliases in PLATFORM_DISTRICT_ALIAS.items():
                if bname in aliases:
                    return plat
            # case-insensitive scan of monitored names
            for plat in mon:
                if plat.lower() == bname.lower():
                    return plat
            # case-insensitive scan of monitored names
            for plat in mon:
                if plat.lower() == bname.lower():
                    return plat
            return bname  # not monitored — rows surface as UNKNOWN below

        reports = db.query(IncidentReport).order_by(IncidentReport.report_time.desc()).limit(500).all()
        incidents_by_district: Dict[str, List[IncidentReport]] = {}
        uncontained = []
        locs_pre = db.query(Location).filter(Location.active == True).all()
        pre_mon = {l.district for l in locs_pre}
        for r in reports:
            dist = geographic_service.district_for_point(r.longitude, r.latitude)
            if not dist:
                uncontained.append({"id": r.id, "location_name": r.location_name})
                continue
            dist = platform_from_boundary(dist, pre_mon)
            incidents_by_district.setdefault(dist, []).append(r)

        shelters = db.query(Shelter).all()
        shelters_by_district: Dict[str, int] = {}
        for s in shelters:
            dist = geographic_service.district_for_point(s.longitude, s.latitude)
            if dist:
                dist = platform_from_boundary(dist, pre_mon)
                shelters_by_district[dist] = shelters_by_district.get(dist, 0) + 1

        # ---- official warnings (verbatim OFFICIAL_AGENCY alerts) by district ----
        official: Dict[str, List[Alert]] = {}
        alerts_query = db.query(Alert).filter(
            Alert.source_type == "OFFICIAL_AGENCY",
            Alert.lifecycle_status.in_(ACTIVE_LIFECYCLES)
        ).order_by(Alert.issued_at.desc().nullslast()).all()
        for a in alerts_query:
            if a.location and a.location.district:
                official.setdefault(a.location.district, []).append(a)

        districts: List[Dict[str, Any]] = []
        grouped: Dict[str, List[Location]] = {}
        for loc in locs:
            grouped.setdefault(loc.district, []).append(loc)
        # include districts that only exist in boundary data + incidents, but are
        # not monitored — they contribute UNKNOWN/honest rows.
        monitored = set(grouped.keys())
        additional = set(incidents_by_district.keys()) | set(shelters_by_district.keys())
        additional -= monitored

        for district in sorted(monitored | additional):
            dlocs = grouped.get(district, [])
            loc_ids = [l.id for l in dlocs]
            state = dlocs[0].state if dlocs else None

            obs_map = cls._latest_obs_by_var(db, loc_ids) if loc_ids else {}
            rain_entries = []
            level_entries = []
            for l in dlocs:
                o = obs_map.get(l.id, {})
                if o.get("rainfall_24h_mm"):
                    rain_entries.append({**o["rainfall_24h_mm"], "location": l.name, "location_id": l.id})
                if o.get("river_level_m"):
                    level_entries.append({**o["river_level_m"], "location": l.name, "location_id": l.id})
            newest_rain = min(rain_entries, key=lambda x: x["age_hours"]) if rain_entries else None
            rainfall_status = _freshness(newest_rain["age_hours"] if newest_rain else None, settings.FRESHNESS_WEATHER_HOURS)

            # ---- prototype risk aggregation across the district's locations ----
            flood_best, slide_best = None, None
            flood_notes: List[str] = []
            slide_notes: List[str] = []
            for l in dlocs:
                try:
                    res = IntegratedRiskEngine.evaluate_location(db, l)
                except Exception as e:
                    logger.warning("risk eval failed %s: %s", l.id, e)
                    continue
                f_rank = SEVERITY_RANK.get(res["flood"]["risk_category"], 0)
                if flood_best is None or f_rank > SEVERITY_RANK.get(flood_best["risk_category"], 0):
                    flood_best = res["flood"]
                    flood_notes = res["explanation_notes"][:3]
                s_rank = SEVERITY_RANK.get(res["landslide"]["risk_category"], 0)
                if slide_best is None or s_rank > SEVERITY_RANK.get(slide_best["risk_category"], 0):
                    slide_best = res["landslide"]
                    slide_notes = res["explanation_notes"][:3]

            warnings = [
                {
                    "alert_id": a.id,
                    "source": "IMD / official agency (verbatim import)",
                    "title": a.title,
                    "description": a.description,
                    "severity": a.severity,
                    "lifecycle_status": a.lifecycle_status,
                    "issued_at": a.issued_at.isoformat() if a.issued_at else None,
                    "expires_at": a.expires_at.isoformat() if a.expires_at else None,
                    "official_source_reference": a.official_source_reference,
                    "action_instructions": a.action_instructions
                }
                for a in (official.get(district) or [])[:5]
            ]

            inc = incidents_by_district.get(district, [])
            verified_inc = [r for r in inc if r.verification_status == "VERIFIED"]
            newest_inc = inc[0] if inc else None

            districts.append({
                "district": district,
                "state": state,
                "monitored_locations": [
                    {"id": l.id, "name": l.name, "type": l.location_type,
                     "latitude": l.latitude, "longitude": l.longitude} for l in dlocs
                ],
                "observed_rainfall_24h": newest_rain,
                "rainfall_24h_all_locations": rain_entries,
                "rainfall_status": rainfall_status,
                "river_level_all_locations": level_entries,
                "flood_risk": {
                    **(flood_best or {"risk_category": "UNKNOWN", "probability": None,
                                       "confidence": None, "uncertainty": "UNKNOWN"}),
                    "model": "prototype",
                    "engine": IntegratedRiskEngine.ENGINE_VERSION,
                } if dlocs else {"risk_category": "UNKNOWN", "model": "none",
                                  "reason": "no monitored location in this district"},
                "flood_explanations": flood_notes if flood_best else [],
                "landslide_risk": {
                    **(slide_best or {"risk_category": "UNKNOWN", "probability": None,
                                       "confidence": None, "uncertainty": "UNKNOWN"}),
                    "model": "prototype",
                    "engine": IntegratedRiskEngine.ENGINE_VERSION,
                } if dlocs else {"risk_category": "UNKNOWN", "model": "none",
                                  "reason": "no monitored location in this district"},
                "landslide_explanations": slide_notes if slide_best else [],
                "official_warnings": warnings,
                "official_warning_count": len(warnings),
                "incidents_total": len(inc),
                "incidents_verified": len(verified_inc),
                "latest_incident": {
                    "location_name": newest_inc.location_name,
                    "category": newest_inc.category,
                    "verification_status": newest_inc.verification_status,
                    "report_time": newest_inc.report_time.isoformat(),
                    "description": newest_inc.description[:220]
                } if newest_inc else None,
                "shelters_count": shelters_by_district.get(district, 0),
                "district_risk_combined": max(
                    SEVERITY_RANK.get((flood_best or {}).get("risk_category", "UNKNOWN"), 0),
                    SEVERITY_RANK.get((slide_best or {}).get("risk_category", "UNKNOWN"), 0),
                ) if dlocs else 0,
                "boundary": geographic_service.boundary_status_for(district),
                "data_quality": {
                    "rainfall": rainfall_status,
                    "river": _freshness(
                        min([e["age_hours"] for e in level_entries], default=None),
                        settings.FRESHNESS_RIVER_HOURS),
                    "risk": "PROTOTYPE_MODEL",
                    "official_warnings": "OFFICIAL" if warnings else "NONE",
                    "missing_inputs": [
                        *([] if rain_entries else ["no rainfall observation"]),
                        *([] if level_entries else ["no river gauge reading"]),
                        *(["no monitored location"] if not dlocs else []),
                    ]
                }
            })

        return {
            "engine": ENGINE_NAME,
            "generated_at": generated_at,
            "freshness_policy": {
                "weather_hours": settings.FRESHNESS_WEATHER_HOURS,
                "river_hours": settings.FRESHNESS_RIVER_HOURS
            },
            "geodata": GEODATA_META,
            "terminology": {
                "flood_risk": "prototype risk estimate (IntegratedRiskEngine) — never an official warning",
                "landslide_risk": "prototype risk estimate (IntegratedRiskEngine) — never an official warning",
                "official_warnings": "verbatim storage of IMD/agency warnings; platform never converts them into model estimates",
                "UNKNOWN": "no fresh data, no warning, no monitored location, or unresolved boundary — never 'safe'"
            },
            "districts": districts
        }


map_service = MapService()
