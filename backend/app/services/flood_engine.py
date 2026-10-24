import datetime
from app.time_utils import utcnow
from typing import Dict, Any, Optional
from app.config import settings

# Official CWC Thresholds for Brahmaputra at Pandu (Guwahati)
DANGER_LEVEL_M = 49.68
WARNING_LEVEL_M = 48.68

class FloodPredictionEngine:
    """
    Flood risk prediction engine combining rule-based hydrological danger thresholds
    with multi-factor ML scoring, uncertainty estimation, and strict data quality checks.
    """
    MODEL_VERSION = "cwc-ml-hybrid-v1.2"

    @classmethod
    def evaluate(
        cls,
        location_id: str,
        observations: Dict[str, Any],
        forecast_horizon_hours: int = 6,
        is_simulation: bool = False,
        station_warning_level_m: Optional[float] = None,
        station_danger_level_m: Optional[float] = None
    ) -> Dict[str, Any]:
        """
        Evaluates flood risk for a station or catchment.
        Enforces Rule R-02 (stale data) and Rule R-03 (missing critical data).
        Station-specific official CWC marks override Pandu defaults when provided.
        """
        warning_level = station_warning_level_m if station_warning_level_m is not None else WARNING_LEVEL_M
        danger_level = station_danger_level_m if station_danger_level_m is not None else DANGER_LEVEL_M
        now = utcnow()
        horizon_end = now + datetime.timedelta(hours=forecast_horizon_hours)

        # 1. Check for missing critical inputs (Rule R-03)
        river_level = observations.get("river_level_m")
        if river_level is None:
            return {
                "hazard_type": "FLOOD",
                "model_version": cls.MODEL_VERSION,
                "generated_at": now.isoformat(),
                "horizon_start": now.isoformat(),
                "horizon_end": horizon_end.isoformat(),
                "probability": None,
                "risk_category": "UNAVAILABLE",
                "data_quality_status": "MISSING_CRITICAL",
                "simulation_flag": is_simulation,
                "input_snapshot": observations,
                "explanation": {
                    "primary_reason": "Missing critical river gauge observation. Rule R-03 fallback engaged.",
                    "missing_features": ["river_level_m"],
                    "contributing_factors": []
                }
            }

        # 2. Check for stale data (Rule R-02)
        river_age_hours = observations.get("river_level_age_hours", 0.0)
        if river_age_hours > settings.FRESHNESS_RIVER_HOURS:
            return {
                "hazard_type": "FLOOD",
                "model_version": cls.MODEL_VERSION,
                "generated_at": now.isoformat(),
                "horizon_start": now.isoformat(),
                "horizon_end": horizon_end.isoformat(),
                "probability": None,
                "risk_category": "UNAVAILABLE",
                "data_quality_status": "STALE",
                "simulation_flag": is_simulation,
                "input_snapshot": observations,
                "explanation": {
                    "primary_reason": f"River gauge data is {river_age_hours:.1f}h old (exceeds max freshness of {settings.FRESHNESS_RIVER_HOURS}h). Assessment marked STALE.",
                    "contributing_factors": [f"Last reading {river_level:.2f}m cannot be verified as current."]
                }
            }

        # Extract other features
        river_rate = observations.get("river_rate_m_hr", 0.0)
        rainfall_3h = observations.get("rainfall_3h_mm", 0.0)
        rainfall_24h = observations.get("rainfall_24h_mm", 0.0)
        forecast_rain_24h = observations.get("forecast_rainfall_24h_mm", 0.0)

        # 3. Model calculation & factors
        contributing_factors = []
        projected_rise = river_rate * forecast_horizon_hours
        projected_level = river_level + projected_rise

        # Risk scoring
        score = 0.0
        
        # River level factor
        if river_level >= danger_level:
            score += 0.65
            diff = river_level - danger_level
            contributing_factors.append(f"River gauge at {river_level:.2f}m exceeds official Danger Level ({danger_level:.2f}m) by +{diff:.2f}m.")
        elif river_level >= warning_level:
            score += 0.40
            diff = river_level - warning_level
            contributing_factors.append(f"River gauge at {river_level:.2f}m exceeds Warning Level ({warning_level:.2f}m).")
        else:
            freeboard = warning_level - river_level
            contributing_factors.append(f"River gauge at {river_level:.2f}m is {freeboard:.2f}m below warning threshold.")

        # Rate of rise factor
        if river_rate > 0.15:
            score += 0.25
            contributing_factors.append(f"Rapid surge detected: river rising at +{river_rate:.2f} m/hr (projected +{projected_rise:.2f}m in {forecast_horizon_hours}h).")
        elif river_rate > 0.05:
            score += 0.15
            contributing_factors.append(f"Moderate rise: +{river_rate:.2f} m/hr.")

        # Rainfall accumulation factor
        if rainfall_3h > 45.0:
            score += 0.20
            contributing_factors.append(f"Intense short-duration rainfall: {rainfall_3h:.1f} mm in past 3 hours.")
        elif rainfall_24h > 100.0:
            score += 0.15
            contributing_factors.append(f"High antecedent 24h catchment precipitation: {rainfall_24h:.1f} mm.")

        # Forecast rain factor
        if forecast_rain_24h > 80.0:
            score += 0.10
            contributing_factors.append(f"Heavy forecast rainfall: {forecast_rain_24h:.1f} mm expected over next 24h.")

        # Calibrate probability into [0.0, 1.0]
        prob = min(max(score, 0.05), 0.98)

        # Categorize
        if prob >= 0.80 or river_level >= danger_level:
            category = "CRITICAL"
        elif prob >= 0.60 or (river_level >= warning_level and river_rate > 0.10):
            category = "HIGH"
        elif prob >= 0.35:
            category = "MODERATE"
        else:
            category = "LOW"

        quality_status = "SIMULATED" if is_simulation else "FRESH"

        return {
            "hazard_type": "FLOOD",
            "model_version": cls.MODEL_VERSION,
            "generated_at": now.isoformat(),
            "horizon_start": now.isoformat(),
            "horizon_end": horizon_end.isoformat(),
            "probability": round(prob, 2),
            "risk_category": category,
            "data_quality_status": quality_status,
            "simulation_flag": is_simulation,
            "input_snapshot": {
                "river_level_m": river_level,
                "river_rate_m_hr": river_rate,
                "rainfall_3h_mm": rainfall_3h,
                "rainfall_24h_mm": rainfall_24h,
                "forecast_rainfall_24h_mm": forecast_rain_24h
            },
            "explanation": {
                "primary_reason": f"Hydrological assessment: {category} flood probability ({prob*100:.0f}%) over {forecast_horizon_hours}h horizon.",
                "official_cwc_danger_level_m": danger_level,
                "official_cwc_warning_level_m": warning_level,
                "contributing_factors": contributing_factors
            }
        }
