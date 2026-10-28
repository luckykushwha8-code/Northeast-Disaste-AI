import datetime
from app.time_utils import utcnow
from typing import Dict, Any
from app.config import settings

# Empirical threshold for steep cut slopes in Guwahati / Shillong plateau (GSI benchmark)
ARI_CRITICAL_THRESHOLD_MM = 160.0
ARI_MODERATE_THRESHOLD_MM = 95.0

class LandslidePredictionEngine:
    """
    Landslide risk engine combining Geological Survey of India (GSI) baseline susceptibility
    with dynamic Antecedent Rainfall Index (ARI) and near-term precipitation triggers.
    Enforces FR-LAND-03 (susceptibility vs near-term hazard) and FR-LAND-05 (no false safety guarantee).
    """
    MODEL_VERSION = "gsi-ari-hybrid-v2.0"

    @classmethod
    def evaluate(
        cls,
        location_id: str,
        terrain: Dict[str, Any],
        observations: Dict[str, Any],
        forecast_horizon_hours: int = 24,
        is_simulation: bool = False
    ) -> Dict[str, Any]:
        now = utcnow()
        horizon_end = now + datetime.timedelta(hours=forecast_horizon_hours)

        # 1. Check for missing critical inputs
        rainfall_24h = observations.get("rainfall_24h_mm")
        if rainfall_24h is None:
            return {
                "hazard_type": "LANDSLIDE",
                "model_version": cls.MODEL_VERSION,
                "generated_at": now.isoformat(),
                "horizon_start": now.isoformat(),
                "horizon_end": horizon_end.isoformat(),
                "probability": None,
                "risk_category": "UNAVAILABLE",
                "data_quality_status": "MISSING_CRITICAL",
                "simulation_flag": is_simulation,
                "input_snapshot": {"terrain": terrain, "observations": observations},
                "explanation": {
                    "primary_reason": "Missing 24-hour rainfall observation. Rule R-03 fallback engaged.",
                    "disclaimer": "Lack of data does not imply slope stability.",
                    "contributing_factors": []
                }
            }

        # This model is not calibrated for use without a sourced terrain layer
        # and observed antecedent rainfall windows. Do not fill these with
        # plausible-looking defaults and publish a risk score.
        if not terrain or terrain.get("slope_deg") is None or terrain.get("susceptibility_score") is None:
            return {
                "hazard_type": "LANDSLIDE", "model_version": cls.MODEL_VERSION,
                "generated_at": now.isoformat(), "horizon_start": now.isoformat(),
                "horizon_end": horizon_end.isoformat(), "probability": None,
                "risk_category": "UNAVAILABLE", "data_quality_status": "MISSING_VERIFIED_TERRAIN",
                "simulation_flag": is_simulation,
                "input_snapshot": {"terrain": None, "observations": observations},
                "explanation": {"primary_reason": "No verified terrain susceptibility layer is connected.",
                                "disclaimer": "Unavailable assessment does not imply slope stability.",
                                "contributing_factors": []}
            }

        # 2. Check for stale data (Rule R-02)
        rainfall_age_hours = observations.get("rainfall_age_hours", 0.0)
        if rainfall_age_hours > settings.FRESHNESS_WEATHER_HOURS:
            return {
                "hazard_type": "LANDSLIDE",
                "model_version": cls.MODEL_VERSION,
                "generated_at": now.isoformat(),
                "horizon_start": now.isoformat(),
                "horizon_end": horizon_end.isoformat(),
                "probability": None,
                "risk_category": "UNAVAILABLE",
                "data_quality_status": "STALE",
                "simulation_flag": is_simulation,
                "input_snapshot": {"terrain": terrain, "observations": observations},
                "explanation": {
                    "primary_reason": f"Weather data is {rainfall_age_hours:.1f}h old (exceeds max freshness of {settings.FRESHNESS_WEATHER_HOURS}h). Assessment marked STALE.",
                    "disclaimer": "Stale meteorological inputs prevent dependable slope hazard evaluation.",
                    "contributing_factors": []
                }
            }

        # Terrain static susceptibility
        slope_deg = terrain["slope_deg"]
        susceptibility_score = terrain["susceptibility_score"]
        geology = terrain.get("geology", "Unspecified")

        # Dynamic rainfall features
        rainfall_3d = observations.get("rainfall_3d_mm")
        rainfall_15d = observations.get("rainfall_15d_mm")
        if rainfall_3d is None or rainfall_15d is None:
            return {
                "hazard_type": "LANDSLIDE", "model_version": cls.MODEL_VERSION,
                "generated_at": now.isoformat(), "horizon_start": now.isoformat(),
                "horizon_end": horizon_end.isoformat(), "probability": None,
                "risk_category": "UNAVAILABLE", "data_quality_status": "MISSING_ANTECEDENT_RAINFALL",
                "simulation_flag": is_simulation,
                "input_snapshot": {"terrain": terrain, "observations": observations},
                "explanation": {"primary_reason": "Verified 3-day and 15-day rainfall observations are required.",
                                "disclaimer": "Unavailable assessment does not imply slope stability.",
                                "contributing_factors": []}
            }
        soil_moisture = observations.get("soil_moisture_pct")

        # Antecedent Rainfall Index (ARI)
        ari = rainfall_24h + (0.5 * rainfall_3d) + (0.2 * rainfall_15d)

        contributing_factors = []
        contributing_factors.append(f"Terrain slope: {slope_deg:.1f}° with GSI susceptibility score of {susceptibility_score:.2f} ({geology}).")
        contributing_factors.append(f"Cumulative ARI metric: {ari:.1f} mm (24h rain: {rainfall_24h:.1f}mm, 3d rain: {rainfall_3d:.1f}mm).")

        # Dynamic score
        rainfall_factor = min(ari / ARI_CRITICAL_THRESHOLD_MM, 1.2) * 0.60
        terrain_factor = susceptibility_score * 0.40
        raw_prob = min(max(rainfall_factor + terrain_factor, 0.05), 0.95)

        if ari >= ARI_CRITICAL_THRESHOLD_MM and slope_deg >= 30.0:
            category = "CRITICAL"
            contributing_factors.append(f"Rainfall threshold exceeded: ARI ({ari:.1f}mm) > critical threshold ({ARI_CRITICAL_THRESHOLD_MM}mm) on steep slope ({slope_deg:.1f}°).")
        elif ari >= ARI_MODERATE_THRESHOLD_MM and susceptibility_score >= 0.60:
            category = "HIGH"
            contributing_factors.append(f"Elevated risk: ARI ({ari:.1f}mm) above moderate threshold with high geological susceptibility.")
        elif ari >= 60.0 or susceptibility_score >= 0.70:
            category = "MODERATE"
        else:
            category = "LOW"

        quality_status = "SIMULATED" if is_simulation else "FRESH"

        return {
            "hazard_type": "LANDSLIDE",
            "model_version": cls.MODEL_VERSION,
            "generated_at": now.isoformat(),
            "horizon_start": now.isoformat(),
            "horizon_end": horizon_end.isoformat(),
            "probability": round(raw_prob, 2),
            "risk_category": category,
            "data_quality_status": quality_status,
            "simulation_flag": is_simulation,
            "input_snapshot": {
                "slope_deg": slope_deg,
                "susceptibility_score": susceptibility_score,
                "ari_mm": round(ari, 1),
                "rainfall_24h_mm": rainfall_24h,
                "soil_moisture_pct": soil_moisture
            },
            "explanation": {
                "primary_reason": f"Slope stability evaluation: {category} landslide hazard ({raw_prob*100:.0f}%) over {forecast_horizon_hours}h horizon.",
                "disclaimer": "Per FR-LAND-05: A low model estimate does NOT guarantee slope safety. Report any slope cracks or seepage immediately.",
                "contributing_factors": contributing_factors
            }
        }
