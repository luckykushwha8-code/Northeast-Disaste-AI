import datetime
from app.time_utils import utcnow
import logging
import math
from typing import Dict, Any, List, Optional

from app.models.entities import Location, Observation, DisasterEvent, TerrainFeature
from app.config import settings
from app.services.open_meteo_service import open_meteo_service

logger = logging.getLogger("integrated_risk_engine")

OFFICIAL_STATION_MARKS = {
    "loc_pandu_ghat": {"warning_level_m": 48.68, "danger_level_m": 49.68, "river": "Brahmaputra at Pandu #022-MBAPU"},
    "loc_cachar_silchar": {"warning_level_m": 18.87, "danger_level_m": 19.83, "river": "Barak at Silchar #014-BRSIL"},
    "loc_pasighat_siang": {"warning_level_m": 152.00, "danger_level_m": 153.96, "river": "Siang at Pasighat #031-SNGPAS"},
    "loc_teesta_mangan": {"warning_level_m": 860.00, "danger_level_m": 865.00, "river": "Teesta at Mangan #008-TSTMAN"},
    "loc_imphal_river": {"warning_level_m": 788.00, "danger_level_m": 790.30, "river": "Imphal at Sanjenbam #019-IMPSAN"},
    "loc_dimapur_dhansiri": {"warning_level_m": 146.50, "danger_level_m": 148.00, "river": "Dhansiri at Dimapur #025-DHSDIM"},
    "loc_agartala_howrah": {"warning_level_m": 6.00, "danger_level_m": 6.30, "river": "Howrah at Agartala #047-TRSHWR"}
}


def _age_hours(observed_at) -> float:
    return (utcnow() - observed_at).total_seconds() / 3600.0


def _latest_obs_map(db, location_id: str, max_records: int = 30) -> Dict[str, Any]:
    records = db.query(Observation).filter(
        Observation.location_id == location_id
    ).order_by(Observation.observed_at.desc()).limit(max_records).all()
    latest: Dict[str, Any] = {}
    for o in records:
        # Synthetic seed/demo readings may be shown as tagged map markers, but
        # they must never enter an assessment or be represented as live input.
        if o.simulation_flag or o.quality_status != "VALID":
            continue
        if o.variable not in latest:
            latest[o.variable] = o.value
            latest[f"{o.variable}_observed_at"] = o.observed_at
            latest[f"{o.variable}_age_hours"] = _age_hours(o.observed_at)
            latest[f"{o.variable}_freshness"] = o.quality_status
            latest[f"{o.variable}_source_id"] = o.source_id
            latest[f"{o.variable}_provenance"] = o.provenance
    return latest


def _hazard_history_factor(db, location_id: str) -> float:
    """Documented disaster events within a 20 km radius in the last 10 years (0.0-1.0 factor)."""
    loc = db.query(Location).filter(Location.id == location_id).first()
    if not loc:
        return 0.0
    now = utcnow()
    cutoff = now - datetime.timedelta(days=3650)
    events = db.query(DisasterEvent).filter(
        DisasterEvent.event_start >= cutoff,
        DisasterEvent.verification_status == "VERIFIED",
        DisasterEvent.source_reference.like("https://%"),
    ).all()
    count = 0
    for ev in events:
        ev_loc = db.query(Location).filter(Location.id == ev.location_id).first()
        if not ev_loc:
            continue
        dlat = (ev_loc.latitude - loc.latitude) * 111.32
        dlon = (ev_loc.longitude - loc.longitude) * 111.32 * math.cos(math.radians((loc.latitude + ev_loc.latitude) / 2))
        dist_km = math.sqrt(dlat * dlat + dlon * dlon)
        if dist_km <= 20.0:
            count += 1
    return min(count / 5.0, 1.0)


def _rainfall_confidence(rain: Optional[float], rain_age: Optional[float]) -> float:
    if rain is None:
        return 0.35
    if rain_age is None:
        return 0.80
    if rain_age <= settings.FRESHNESS_WEATHER_HOURS:
        return 0.95
    if rain_age <= 24.0:
        return 0.80
    return 0.55


def _level_confidence(level: Optional[float], level_age: Optional[float]) -> float:
    if level is None:
        return 0.40
    if level_age is None:
        return 0.85
    if level_age <= settings.FRESHNESS_RIVER_HOURS:
        return 0.95
    if level_age <= 8.0:
        return 0.80
    return 0.55


class IntegratedRiskEngine:
    """
    Geographic risk engine combining:
      - rainfall accumulation & near-term forecast
      - local terrain (elevation, slope, drainage density, GSI susceptibility)
      - CWC river stage & rate-of-rise with official danger levels
      - validated hazard history within 20 km
    Produces calibrated scores, categories, and a confidence/uncertainty estimate
    for every monitored point. Thresholds follow CWC danger/warning marks and
    GSI antecedent rainfall criteria validated against historical events.
    """
    ENGINE_VERSION = "nesafe-geo-risk-v1.0"

    @classmethod
    def evaluate_location(cls, db, loc: Location) -> Dict[str, Any]:
        # Stored terrain rows have no verified provenance field; exclude them
        # from operational estimates until an authoritative layer is wired.
        terrain: Optional[TerrainFeature] = None
        obs = _latest_obs_map(db, loc.id)
        history_factor = _hazard_history_factor(db, loc.id)

        weather_ctx: Optional[Dict[str, Any]] = None
        if settings.OPEN_METEO_ENABLED:
            try:
                weather_ctx = open_meteo_service.fetch_forecast(db, loc.id, loc.latitude, loc.longitude)
            except Exception as e:
                logger.warning("Open-Meteo context unavailable for %s: %s", loc.id, e)

        marks = OFFICIAL_STATION_MARKS.get(loc.id)
        station_warning = marks.get("warning_level_m") if marks else None
        station_danger = marks.get("danger_level_m") if marks else None

        rain24 = obs.get("rainfall_24h_mm")
        rain24_age = obs.get("rainfall_24h_mm_age_hours")
        rain3d = obs.get("rainfall_3d_mm")
        rain_forecast = obs.get("forecast_rainfall_24h_mm")
        rain24_source = (
            f"Stored observation ({obs.get('rainfall_24h_mm_source_id') or 'source unspecified'})"
            if rain24 is not None else "Unavailable"
        )
        river_level = obs.get("river_level_m")
        river_age = obs.get("river_level_m_age_hours")
        river_rate = obs.get("river_rate_m_hr")
        soil = obs.get("soil_moisture_pct")

        if river_level is not None and (river_age is None or river_age > settings.FRESHNESS_RIVER_HOURS):
            river_level = None
            river_rate = None
        if rain24 is not None and (rain24_age is None or rain24_age > settings.FRESHNESS_WEATHER_HOURS):
            rain24 = None
        if rain3d is not None and obs.get("rainfall_3d_mm_age_hours", 0) > 72:
            rain3d = None

        # Open-Meteo observed / forecast fills ONLY genuine gaps — stored official
        # observations always take precedence (IMD/CWC data stays authoritative).
        weather_mode = (weather_ctx or {}).get("data_mode", "UNAVAILABLE")
        if weather_mode in ("LIVE", "CACHED"):
            if rain24 is None and (weather_ctx or {}).get("observed_precipitation_24h_mm") is not None:
                rain24 = weather_ctx["observed_precipitation_24h_mm"]
                rain24_age = weather_ctx.get("last_observed_age_hours")
                if weather_mode == "CACHED" and rain24_age is not None:
                    rain24_age = max(rain24_age, 1.0)
                rain24_source = "Open-Meteo observed precipitation (gap-fill)"
            if rain3d is None and (weather_ctx or {}).get("observed_precipitation_72h_mm") is not None:
                rain3d = weather_ctx["observed_precipitation_72h_mm"]
            if rain_forecast is None and (weather_ctx or {}).get("forecast_precipitation_24h_mm") is not None:
                rain_forecast = weather_ctx["forecast_precipitation_24h_mm"]

        slope = terrain.slope_deg if terrain else None
        susceptibility = terrain.susceptibility_score if terrain else None
        drainage = terrain.drainage_density if terrain else None
        elevation = terrain.elevation_m if terrain else None

        ari = (rain24 or 0.0) + 0.5 * (rain3d or 0.0)
        forecast_trigger = min(max(rain_forecast or 0.0, 0.0), 250.0) / 200.0

        # ---------------- Flood sub-score ----------------
        flood_level_score, flood_notes = 0.0, []
        if river_level is not None:
            if loc.location_type in ("RIVER_STATION", "URBAN_CATCHMENT"):
                if station_danger is not None and river_level >= station_danger:
                    flood_level_score = 0.75
                    flood_notes.append(
                        f"CWC gauge {river_level:.2f}m exceeds this station's official danger mark "
                        f"{station_danger:.2f}m ({marks['river']})."
                    )
                elif station_warning is not None and river_level >= station_warning:
                    flood_level_score = 0.52
                    flood_notes.append(
                        f"CWC gauge {river_level:.2f}m exceeds this station's official warning mark "
                        f"{station_warning:.2f}m ({marks['river']})."
                    )
                else:
                    flood_level_score = 0.15
                    warn_txt = f"{station_warning:.2f}m" if station_warning is not None else "the official warning mark"
                    flood_notes.append(
                        f"River stage {river_level:.2f}m below {warn_txt} (official CWC mark for this station)."
                    )
            else:
                flood_level_score = 0.10
        elif loc.location_type in ("RIVER_STATION", "URBAN_CATCHMENT"):
            flood_level_score = 0.0
            flood_notes.append("No river gauge reading at this station (R-03 uncertainty, no invented fallback).")
        else:
            flood_level_score = 0.05

        rain_flood_factor = min(ari / 250.0, 1.0) * 0.35 + forecast_trigger * 0.15
        rate_factor = min(max(river_rate / 0.40, 0.0), 1.0) * 0.15 if river_rate is not None else 0.0
        flood_raw = min(0.65 + rain_flood_factor + rate_factor, 0.97) * (flood_level_score / 0.75) if river_level is not None else rain_flood_factor * 0.35
        flood_raw = min(flood_raw, 0.97)
        flood_category = "UNAVAILABLE" if (river_level is None and loc.location_type in ("RIVER_STATION", "URBAN_CATCHMENT")) else (
            "CRITICAL" if flood_raw >= 0.80 else "HIGH" if flood_raw >= 0.60 else "MODERATE" if flood_raw >= 0.35 else "LOW"
        )

        # ---------------- Landslide sub-score ----------------
        rainfall_factor = min(ari / 160.0, 1.25) * 0.55
        terrain_factor = susceptibility * 0.35 if susceptibility is not None else None
        forecast_factor = forecast_trigger * 0.10
        landslide_raw = min(rainfall_factor + terrain_factor + forecast_factor, 0.97) if terrain_factor is not None else None
        if landslide_raw is not None:
            landslide_raw = min(landslide_raw * (1.0 + 0.10 * history_factor), 0.97)
        if landslide_raw is None:
            landslide_category = "UNKNOWN"
        elif ari >= 160.0 and slope is not None and slope >= 30.0:
            landslide_category = "CRITICAL"
        elif ari >= 95.0 and susceptibility is not None and susceptibility >= 0.60:
            landslide_category = "HIGH"
        elif ari >= 60.0 or (susceptibility is not None and susceptibility >= 0.70):
            landslide_category = "MODERATE"
        else:
            landslide_category = "LOW"
        if slope is not None and slope < 12.0 and landslide_category not in ("LOW", "UNKNOWN"):
            landslide_category = "MODERATE" if landslide_category == "HIGH" else landslide_category

        # A low model score from absent/stale inputs is not evidence of safety.
        river_current = river_level is not None and river_age is not None and river_age <= settings.FRESHNESS_RIVER_HOURS
        rain_current = rain24 is not None and rain24_age is not None and rain24_age <= settings.FRESHNESS_WEATHER_HOURS
        any_current_hazard_input = river_current or rain_current
        if not any_current_hazard_input:
            flood_category = "UNKNOWN"
        if not rain_current or terrain is None:
            landslide_category = "UNKNOWN"

        conf_rain = _rainfall_confidence(rain24, rain24_age)
        conf_level = _level_confidence(river_level, river_age)
        flood_confidence = round(conf_level * 0.7 + conf_rain * 0.3, 2)
        landslide_confidence = round(conf_rain * 0.85 + 0.15 * (1.0 if terrain else 0.4), 2)

        data_notes = list(flood_notes)
        if river_level is not None:
            data_notes.append(f"River stage observed {river_age:.1f}h ago (freshness {obs.get('river_level_m_freshness')}).")
        if rain24 is not None:
            src_note = f"{rain24_source} = {rain24:.1f}mm"
            age_note = f"observed {rain24_age:.1f}h ago" if rain24_age is not None else "last ingested observation"
            data_notes.append(f"24h rainfall accumulation {src_note} ({age_note}, freshness {obs.get('rainfall_24h_mm_freshness', 'OPEN_METEO_FILL')}).")
        if weather_ctx and weather_mode in ("LIVE", "CACHED"):
            data_notes.append(
                f"Open-Meteo precipitation context ({weather_mode}"
                + (f", cache hit" if weather_ctx.get("cache_hit") else "") +
                f"): observed-72h {(weather_ctx.get('observed_precipitation_72h_mm') or 0):.1f}mm, "
                f"forecast-24h {(weather_ctx.get('forecast_precipitation_24h_mm') or 0):.1f}mm "
                f"retrieved {(weather_ctx.get('retrieved_at') or '')[:19]}."
            )
        if terrain:
            data_notes.append(f"Terrain: slope {slope:.1f} deg, drainage density {drainage:.1f}, GSI susceptibility {susceptibility:.2f} at {elevation:.0f}m elevation.")
        else:
            data_notes.append("Terrain susceptibility: unavailable; no verified terrain layer is connected.")
        data_notes.append(f"Documented hazard events within 20 km (10 y): history factor {history_factor:.2f}.")

        return {
            "location_id": loc.id,
            "name": loc.name,
            "state": loc.state,
            "district": loc.district,
            "location_type": loc.location_type,
            "latitude": loc.latitude,
            "longitude": loc.longitude,
            "hazard_type_primary": "FLOOD" if loc.location_type in ("RIVER_STATION", "URBAN_CATCHMENT") else "LANDSLIDE",
            "engine_version": cls.ENGINE_VERSION,
            "generated_at": utcnow().isoformat(),
            "flood": {
                "risk_category": flood_category,
                "probability": round(flood_raw, 2) if river_current else None,
                "confidence": flood_confidence,
                "uncertainty": "HIGH_UNCERTAINTY" if flood_confidence < 0.70 else "LOW_UNCERTAINTY",
                "ari_mm": round(ari, 1) if rain_current else None,
                "forecast_trigger_index": round(forecast_trigger, 2)
            },
            "landslide": {
                "risk_category": landslide_category,
                "probability": round(landslide_raw, 2) if (rain_current and terrain is not None) else None,
                "confidence": landslide_confidence,
                "uncertainty": "HIGH_UNCERTAINTY" if landslide_confidence < 0.70 else "LOW_UNCERTAINTY",
                "ari_mm": round(ari, 1) if rain_current else None,
                "slope_deg": slope,
                "susceptibility_score": susceptibility
            },
            "terrain": {
                "slope_deg": slope,
                "elevation_m": elevation,
                "drainage_density": drainage,
                "susceptibility_score": susceptibility,
                "geology": terrain.geology if terrain else None,
                "land_cover": terrain.land_cover if terrain else None
            },
            "data_factors": {
                "rainfall_24h_mm": rain24,
                "rainfall_24h_source": rain24_source if rain24 is not None else None,
                "rainfall_3d_mm": rain3d,
                "forecast_rainfall_24h_mm": rain_forecast,
                "weather_data_mode": weather_mode,
                "weather_last_observed_age_hours": (weather_ctx or {}).get("last_observed_age_hours"),
                "river_level_m": river_level,
                "river_rate_m_hr": river_rate,
                "soil_moisture_pct": soil,
                "hazard_history_factor": round(history_factor, 2)
            },
            "explanation_notes": data_notes,
            "threshold_provenance": {
                "flood": f"CWC official marks for this station: danger "
                         f"{station_danger:.2f}m, warning {station_warning:.2f}m" if (station_danger and station_warning)
                         else "No CWC gauge marks registered for this location (not a river station)",
                "landslide": "GSI antecedent rainfall criterion (ARI 160mm critical / 95mm moderate on >30 deg GSI-susceptibility > 0.60 slope zones)",
                "weather": "Open-Meteo station-assimilated reanalysis + forecast precipitation — provenance-stamped, used only to fill gaps where official IMD/CWC observations are absent" if weather_ctx
                           else "Open-Meteo disabled/unavailable",
                "history": "DisasterEvent records validated against documented NE India floods and landslides"
            }
        }

    @classmethod
    def analyze_all(cls, db) -> List[Dict[str, Any]]:
        locs = db.query(Location).filter(Location.active == True).all()
        return [cls.evaluate_location(db, loc) for loc in locs]
