import datetime
from app.time_utils import utcnow
import logging
import re
from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session

from app.services.ingestion import IngestionService

logger = logging.getLogger("imd_ingest")


def _norm(text: str) -> str:
    # IMD DISTRICT values are UPPERCASE, often with _ between words (e.g.
    # KAMRUP_METROPOLITAN, NEW_DELHI). Compare on a normalized key.
    t = str(text or "").strip().upper()
    t = re.sub(r"[\s\-_]+", " ", t)
    return t


# Monitored locations -> IMD district naming. NOTE: IMD nomenclature differs from
# official district spellings in known documented cases; every non-obvious spelling
# variant is listed explicitly here (with the IMD-distinct form first) rather than
# guessed. Unmatched districts are reported, never fabricated.
LOCATION_IMD_DISTRICTS: Dict[str, List[str]] = {
    "loc_pandu_ghat":        ["KAMRUP METROPOLITAN"],
    "loc_bharalu_basin":     ["KAMRUP METROPOLITAN"],
    "loc_kharghuli_hills":   ["KAMRUP METROPOLITAN"],
    "loc_kamakhya_nilachal": ["KAMRUP METROPOLITAN"],
    "loc_narakasur_hills":   ["KAMRUP METROPOLITAN"],
    "loc_cachar_silchar":    ["CACHAR"],
    "loc_dhemaji_jiadhal":   ["DEMAGI", "DHEMAJI"],           # IMD spells "DEMAGI"
    "loc_itanagar_hills":    ["PAPUM PARE", "PAPUMPARE"],
    "loc_pasighat_siang":    ["EAST SIANG"],
    "loc_cherrapunji_sohra": ["EAST KHASI HILLS"],
    "loc_shillong_hills":    ["EAST KHASI HILLS"],
    "loc_imphal_river":      ["IMPHAL WEST"],
    "loc_tupul_slope":       ["NONEY"],
    "loc_aizawl_slopes":     ["AIZAWL"],
    "loc_kohima_slopes":     ["KOHIMA", "PHEK"],             # Kohima slopes zone; Phek fallback
    "loc_dimapur_dhansiri":  ["DIMAPUR", "KOHIMA"],          # Dimapur listed under Nagaland
    "loc_agartala_howrah":   ["WEST TRIPURA"],
    "loc_gangtok_slopes":    ["EAST DISTRICT", "EAST SIKKIM"],  # IMD Sikkim: EAST DISTRICT
    "loc_teesta_mangan":     ["NORTH DISTRICT", "NORTH SIKKIM"],
}

STATE_IMD_IDS: Dict[str, int] = {
    # Official aws_data state-wise ids from the provider documentation
    "MEGHALAYA": 6,
    "MIZORAM": 14,
    "TRIPURA": 16,
    "SIKKIM": 20,
    "ASSAM": 24,
    "ARUNACHAL_PRADESH": 28,
    "MANIPUR": 30,
    "NAGALAND": 32,
}


class ImdIngestService:
    """Normalizes official IMD API rows into the platform's observation store.

    Only documented numeric values are ingested:
    - districtrainfall: `Daily Actual` (0830-0830 IST day rainfall, mm) as
      rainfall_24h_mm with observed_at = IMD `Date` at the documented daily
      cut-off (0830 IST = 0300 UTC; the dataset has no intra-day timestamp).
    - basinqpf: `AAP` and `Day1` areal QPF (mm) as document-backed engine inputs
      for locations whose basins match official FMO nomenclature.

    Unmatched districts/basins are counted and reported - never invented.
    IMD rainfall Category codes (NR/D/LE...) are preserved in provenance text.
    """

    DAILY_CUTOFF_UTC_HMS = (3, 0, 0)

    def _observed_at_from_date(self, date_str: str) -> Optional[datetime.datetime]:
        try:
            d = datetime.datetime.strptime(str(date_str).strip()[:10], "%Y-%m-%d")
        except (ValueError, TypeError):
            return None
        h, m, s = self.DAILY_CUTOFF_UTC_HMS
        return d.replace(hour=h, minute=m, second=s)

    def match_locations(self, imd_district: str) -> List[str]:
        wanted = _norm(imd_district)
        matches: List[str] = []
        for loc_id, variants in LOCATION_IMD_DISTRICTS.items():
            if wanted in {_norm(v) for v in variants}:
                matches.append(loc_id)
        return matches

    def ingest_district_rainfall(self, db: Session, payload: Dict[str, Any]) -> Dict[str, Any]:
        if payload.get("data_mode") != "LIVE":
            return {"ingested": 0, "skipped": "source not LIVE: " + str(payload.get("data_mode"))}

        rows = payload.get("rows") or []
        ingested, matched, unmatched = 0, [], set()
        now = utcnow()
        yesterday = (now - datetime.timedelta(days=1)).date().isoformat()

        for row in rows:
            district = row.get("District")
            if not district:
                continue
            actual = row.get("Daily Actual")
            if actual in (None, ""):
                continue
            try:
                actual_mm = float(actual)
            except (TypeError, ValueError):
                continue
            # Sanity bounds: >999 mm/day would approach record extremes and more
            # likely indicates an upstream unit/schema defect - invalid, not risk.
            if actual_mm < 0 or actual_mm > 999.0:
                logger.warning("IMD district rainfall out of range for %s: %s", district, actual)
                continue
            obs_day = str(row.get("Date") or "")[:10]
            if obs_day and obs_day < yesterday:
                # Documented rule: never reinterpret old rainfall as current
                matched.append({"district": district, "skipped": f"stale rainfall date {obs_day}"})
                continue
            matches = self.match_locations(district)
            if not matches:
                unmatched.add(district)
                continue
            obs_at = self._observed_at_from_date(obs_day) if obs_day else None
            if obs_at is None:
                continue
            category = row.get("Daily Category") or ""
            normal = row.get("Daily Normal")
            provenance = (
                f"IMD API districtrainfall {district} (daily actual {actual_mm} mm, "
                f"normal {normal}, category {category})"
            )
            for loc_id in matches:
                created = IngestionService.normalize_and_ingest(
                    db=db,
                    source_id="src_imd_api",
                    location_id=loc_id,
                    observed_at=obs_at,
                    variable="rainfall_24h_mm",
                    raw_value=actual_mm,
                    raw_unit="mm",
                    provenance=provenance,
                    simulation_flag=False
                )
                if created:
                    ingested += 1
                    matched.append({"district": district, "location_id": loc_id, "ingested": True})

        return {"ingested": ingested, "matched": matched, "unmatched_districts": sorted(unmatched)}

    def ingest_basin_qpf(self, db: Session, payload: Dict[str, Any]) -> Dict[str, Any]:
        if payload.get("data_mode") != "LIVE":
            return {"ingested": 0, "skipped": "source not LIVE: " + str(payload.get("data_mode"))}

        BASIN_HINTS: Dict[str, List[str]] = {
            "loc_pandu_ghat": ["BRAHMAPUTRA", "KAMRUP", "GUWAHATI"],
            "loc_bharalu_basin": ["BRAHMAPUTRA", "GUWAHATI"],
            "loc_kharghuli_hills": ["BRAHMAPUTRA", "GUWAHATI"],
            "loc_cachar_silchar": ["BARAK", "SILCHAR", "CACHAR"],
            "loc_pasighat_siang": ["SIANG", "PASIGHAT", "UPPER ASSAM"],
            "loc_teesta_mangan": ["TEESTA"],
            "loc_dhemaji_jiadhal": ["SUBANSIRI", "JADHAL", "JIADHAL", "DEMAJI", "ARUNACHAL"],
        }
        rows = payload.get("rows") or []
        ingested, unmatched = [], []
        for row in rows:
            basin = str(row.get("Basin") or "")
            sub = str(row.get("SubBasin") or "")
            row_text = _norm(f"{basin} {sub}")
            matched = [loc_id for loc_id, hints in BASIN_HINTS.items()
                       if any(_norm(h) in row_text for h in hints)]
            if not matched:
                if basin or sub:
                    unmatched.append(f"{basin} / {sub}")
                continue
            date_str = str(row.get("Date") or "")[:10]
            obs_at = self._observed_at_from_date(date_str) if date_str else None
            for value, variable in ((row.get("AAP"), "imd_qpf_aap_mm"),
                                    (row.get("Day1"), "imd_qpf_day1_mm")):
                if value in (None, ""):
                    continue
                try:
                    val = float(value)
                except (TypeError, ValueError):
                    continue
                if val < 0 or val > 999.0:
                    continue
                for loc_id in matched:
                    created = IngestionService.normalize_and_ingest(
                        db=db,
                        source_id="src_imd_api",
                        location_id=loc_id,
                        observed_at=obs_at or utcnow(),
                        variable=variable,
                        raw_value=val,
                        raw_unit="mm",
                        provenance=f"IMD API basinqpf {basin}/{sub} ({variable}, QPF, document-backed)",
                        simulation_flag=False
                    )
                    if created:
                        ingested.append({"location_id": loc_id, "variable": variable, "mm": val})
        return {"ingested_records": ingested, "unmatched_basins": sorted(set(unmatched))}

    def apply_official_district_warnings(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """Map official IMD districtwarning rows (Day1-5 codes + colors) into
        proposed OFFICIAL alerts (source_type OFFICIAL_AGENCY). Returns the alert
        specs for the caller (request layer) to persist through the standard alert
        creation path so dedupe/lifecycle/audit logic stays in one place.
        Official text warnings are pass-through: the platform never rewrites an
        official warning into a model estimate.
        """
        if payload.get("data_mode") != "LIVE":
            return {"created": 0, "skipped": "source not LIVE: " + str(payload.get("data_mode"))}

        rows = payload.get("rows") or []
        specs: List[Dict[str, Any]] = []
        unmatched: List[str] = []
        for row in rows:
            district = row.get("District")
            if not district:
                continue
            matches = self.match_locations(district)
            if not matches:
                unmatched.append(district)
                continue

            for day_idx in range(1, 6):
                code_raw = row.get(f"Day_{day_idx}")
                color = row.get(f"Day{day_idx}_Color")
                if code_raw in (None, "") or color in (None, ""):
                    continue
                codes: List[int] = []
                for token in str(code_raw).split(","):
                    token = token.strip()
                    if token.isdigit():
                        codes.append(int(token))
                relevant = [c for c in codes if c in FLOOD_RELEVANT_CODES or c in RAIN_RELEVANT_LANDSLIDE_CODES]
                if not relevant:
                    continue

                label = ", ".join(WARNING_CODE_TEXT.get(c, f"Code {c}") for c in relevant)
                sev_from_color = {"1": "LOW", "2": "MODERATE", "3": "HIGH", "4": "CRITICAL"}
                severity = sev_from_color.get(str(int(float(color))), "MODERATE")
                valid_at = row.get("Date")
                for loc_id in matches:
                    specs.append({
                        "location_id": loc_id,
                        "hazard_type": "FLOOD" if any(c in FLOOD_RELEVANT_CODES for c in relevant) else "LANDSLIDE",
                        "severity": severity,
                        "title": f"IMD District Warning: {label} ({district}, Day-{day_idx})",
                        "description": (
                            f"Official IMD district warning for {district}: Day-{day_idx} "
                            f"warning code(s) {relevant} - {label}; color code {color}. "
                            f"Issued date {valid_at}. Excerpt of the official feed, verbatim."
                        ),
                        "action_instructions": (
                            "Official IMD warning: follow district administration guidance. "
                            "Monitor river levels and avoid flooded areas / steep slopes during heavy rain."
                        ),
                        "official_source_reference": (
                            f"IMD districtwarning Obj_id={row.get('Obj_id') or row.get('obj_id')}, "
                            f"district={district}, Day-{day_idx}, date={valid_at}"
                        ),
                        "expires_in_days": 1 if day_idx == 1 else day_idx,
                    })
        return {
            "alert_specs": specs,
            "unmatched_districts": sorted(set(unmatched)),
            "total_official_relevant_days": len(specs)
        }


imd_ingest_service = ImdIngestService()


# ---- Official IMD district warnings -> platform alerts (OFFICIAL source) ----

# Official warning-code → alert presentation (docs table of the provider)
WARNING_CODE_TEXT: Dict[int, str] = {
    2: "Heavy Rain", 3: "Heavy Snow", 4: "Thunderstorm & Lightning, Squall etc",
    5: "Hailstorm", 6: "Dust Storm", 7: "Dust Raising Winds", 8: "Strong Surface Winds",
    9: "Heat Wave", 10: "Hot Day", 11: "Warm Night", 12: "Cold Wave", 13: "Cold Day",
    14: "Ground Frost", 15: "Fog", 16: "Very Heavy Rain", 17: "Extremely Heavy Rain",
}
# Only codes relevant to flood/landslide hazards create alerts; 15 (Fog) etc. don't.
FLOOD_RELEVANT_CODES = {2, 16, 17}
RAIN_RELEVANT_LANDSLIDE_CODES = {16, 17}  # Very/Extremely heavy rain drives slope failure.
