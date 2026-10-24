import json
import datetime
from app.time_utils import utcnow
from typing import Dict, Any

from sqlalchemy.orm import Session

from app.models.entities import HistoricalValidationCase
from app.services.flood_engine import FloodPredictionEngine
from app.services.landslide_engine import LandslidePredictionEngine

from app.data.historical_cases import (HISTORICAL_VALIDATION_CASES)

STATION_OFFICIAL_MARKS = {
    "loc_pandu_ghat": {"warning_level_m": 48.68, "danger_level_m": 49.68},
    "loc_cachar_silchar": {"warning_level_m": 18.87, "danger_level_m": 19.83},
    "loc_pasighat_siang": {"warning_level_m": 152.00, "danger_level_m": 153.96},
    "loc_teesta_mangan": {"warning_level_m": 860.00, "danger_level_m": 865.00},
    "loc_imphal_river": {"warning_level_m": 788.00, "danger_level_m": 790.30},
    "loc_dimapur_dhansiri": {"warning_level_m": 146.50, "danger_level_m": 148.00},
    "loc_agartala_howrah": {"warning_level_m": 6.00, "danger_level_m": 6.30}
}

LOCATION_TERRAIN = {
    "loc_pandu_ghat": {"slope_deg": 4.5, "susceptibility_score": 0.20, "geology": "Alluvial Sand & Silt"},
    "loc_bharalu_basin": {"slope_deg": 6.0, "susceptibility_score": 0.35, "geology": "Recent Alluvium"},
    "loc_kharghuli_hills": {"slope_deg": 36.0, "susceptibility_score": 0.88, "geology": "Precambrian Biotite Gneiss"},
    "loc_kamakhya_nilachal": {"slope_deg": 34.0, "susceptibility_score": 0.82, "geology": "Weathered Granite Gneiss"},
    "loc_narakasur_hills": {"slope_deg": 38.0, "susceptibility_score": 0.92, "geology": "Weathered Gneissic Complex"},
    "loc_cachar_silchar": {"slope_deg": 3.5, "susceptibility_score": 0.25, "geology": "Floodplain Silt"},
    "loc_dhemaji_jiadhal": {"slope_deg": 5.0, "susceptibility_score": 0.30, "geology": "Coarse Alluvium / Sand"},
    "loc_itanagar_hills": {"slope_deg": 35.0, "susceptibility_score": 0.86, "geology": "Siwalik Sandstone & Shale"},
    "loc_pasighat_siang": {"slope_deg": 12.0, "susceptibility_score": 0.45, "geology": "Gravel & Boulders"},
    "loc_cherrapunji_sohra": {"slope_deg": 42.0, "susceptibility_score": 0.89, "geology": "Cretaceous Sandstone Cliffs"},
    "loc_shillong_hills": {"slope_deg": 22.0, "susceptibility_score": 0.62, "geology": "Shillong Group Quartzite"},
    "loc_imphal_river": {"slope_deg": 2.5, "susceptibility_score": 0.20, "geology": "Lacustrine Clay & Silt"},
    "loc_tupul_slope": {"slope_deg": 39.0, "susceptibility_score": 0.94, "geology": "Disang Shale & Siltstone"},
    "loc_aizawl_slopes": {"slope_deg": 37.0, "susceptibility_score": 0.91, "geology": "Surma Group Siltstone"},
    "loc_kohima_slopes": {"slope_deg": 33.0, "susceptibility_score": 0.87, "geology": "Disang Group Flysch"},
    "loc_dimapur_dhansiri": {"slope_deg": 3.0, "susceptibility_score": 0.22, "geology": "Alluvium"},
    "loc_agartala_howrah": {"slope_deg": 2.0, "susceptibility_score": 0.18, "geology": "Recent Floodplain Silt"},
    "loc_gangtok_slopes": {"slope_deg": 38.0, "susceptibility_score": 0.90, "geology": "Daling Series Phyllites & Schist"},
    "loc_teesta_mangan": {"slope_deg": 36.0, "susceptibility_score": 0.93, "geology": "High Himalayan Gneiss"}
}


def seed_historical_validation_cases(db: Session):
    existing = {c.id for c in db.query(HistoricalValidationCase).all()}
    for case in HISTORICAL_VALIDATION_CASES:
        if case["id"] in existing:
            continue
        db.add(HistoricalValidationCase(
            id=case["id"],
            case_type=case["case_type"],
            hazard_type=case["hazard_type"],
            location_id=case["location_id"],
            event_date=datetime.datetime.fromisoformat(case["event_date"]),
            event_name=case["event_name"],
            documented_inputs_json=case["documented_inputs_json"],
            expected_categories_json=case["expected_categories_json"],
            documented_outcome=case["documented_outcome"],
            source_reference=case["source_reference"]
        ))
    db.commit()


def replay_case(case: HistoricalValidationCase) -> Dict[str, Any]:
    inputs = json.loads(case.documented_inputs_json)
    expected = json.loads(case.expected_categories_json)
    if case.hazard_type == "FLOOD":
        marks = STATION_OFFICIAL_MARKS.get(case.location_id)
        res = FloodPredictionEngine.evaluate(
            location_id=case.location_id,
            observations=inputs,
            forecast_horizon_hours=6,
            is_simulation=False,
            station_warning_level_m=marks.get("warning_level_m") if marks else None,
            station_danger_level_m=marks.get("danger_level_m") if marks else None
        )
    else:
        terrain = LOCATION_TERRAIN.get(case.location_id, {"slope_deg": 28.0, "susceptibility_score": 0.65, "geology": "Regional default"})
        res = LandslidePredictionEngine.evaluate(
            location_id=case.location_id,
            terrain=terrain,
            observations=inputs,
            forecast_horizon_hours=24,
            is_simulation=False
        )
    predicted = res["risk_category"]
    passed = predicted in expected

    result = {
        "case_id": case.id,
        "hazard_type": case.hazard_type,
        "case_type": case.case_type,
        "event_date": case.event_date.isoformat() if case.event_date else None,
        "event_name": case.event_name,
        "model_version": res["model_version"],
        "predicted_category": predicted,
        "predicted_probability": res["probability"],
        "predicted_quality": res["data_quality_status"],
        "expected_categories": expected,
        "passed": passed,
        "documented_outcome": case.documented_outcome,
        "source_reference": case.source_reference,
        "engine_explanation": res.get("explanation", {})
    }
    return result


def replay_case_baseline(case: HistoricalValidationCase) -> Dict[str, Any]:
    """Baseline comparison: 'official-marks-only' operational practice, no AI layer.

    FLOOD  : use only CWC gauge marks (>= danger -> CRITICAL, >= warning -> HIGH,
             else LOW); missing gauge -> UNAVAILABLE (official practice cannot call).
    LANDSLIDE: no official real-time operational thresholds exist (GSI susceptibility
             zones are static) -> no-skill always-LOW prediction.

    This exists to demonstrate what value the risk engines add beyond raw
    government marks — especially for landslides, where the official baseline
    has no actionable real-time rule at all.
    """
    inputs = json.loads(case.documented_inputs_json)
    expected = json.loads(case.expected_categories_json)

    if case.hazard_type == "FLOOD":
        marks = STATION_OFFICIAL_MARKS.get(case.location_id)
        river = inputs.get("river_level_m")
        if river is None or marks is None:
            predicted = "UNAVAILABLE"
        elif river >= marks["danger_level_m"]:
            predicted = "CRITICAL"
        elif river >= marks["warning_level_m"]:
            predicted = "HIGH"
        else:
            predicted = "LOW"
    else:
        predicted = "LOW"

    return {
        "case_id": case.id,
        "hazard_type": case.hazard_type,
        "case_type": case.case_type,
        "baseline_name": "official-marks-only-no-ai",
        "predicted_category": predicted,
        "passed": predicted in expected,
        "expected_categories": expected
    }


def run_historical_validation(db: Session) -> Dict[str, Any]:
    cases = db.query(HistoricalValidationCase).all()
    results = [replay_case(c) for c in cases]
    baseline_results = [replay_case_baseline(c) for c in cases]

    positives = [r for r in results if r["case_type"] == "POSITIVE_EVENT"]
    negatives = [r for r in results if r["case_type"] == "NEGATIVE_EVENT"]
    safety = [r for r in results if r["case_type"] == "SAFETY_CASE"]

    hits = sum(1 for r in positives if r["passed"])
    false_alarms = sum(1 for r in negatives if not r["passed"])
    safety_pass = sum(1 for r in safety if r["passed"])

    hit_rate = round(hits / len(positives), 3) if positives else None
    false_alarm_rate = round(false_alarms / len(negatives), 3) if negatives else None
    safety_rate = round(safety_pass / len(safety), 3) if safety else None

    by_hazard = {}
    for h in ("FLOOD", "LANDSLIDE"):
        hr = [r for r in results if r["hazard_type"] == h]
        if hr:
            hp = [r for r in hr if r["case_type"] == "POSITIVE_EVENT"]
            by_hazard[h] = {
                "cases": len(hr),
                "hits": sum(1 for r in hp if r["passed"]),
                "hit_rate": round(sum(1 for r in hp if r["passed"]) / len(hp), 3) if hp else None
            }

    # ---- Baseline (official-marks-only, no AI) comparison ----
    base_positives = [r for r in baseline_results if r["case_type"] == "POSITIVE_EVENT"]
    base_negatives = [r for r in baseline_results if r["case_type"] == "NEGATIVE_EVENT"]
    base_hit_rate = (round(sum(1 for r in base_positives if r["passed"]) / len(base_positives), 3)
                     if base_positives else None)
    base_false_alarm_rate = (round(sum(1 for r in base_negatives if not r["passed"]) / len(base_negatives), 3)
                             if base_negatives else None)
    baseline_by_hazard = {}
    for h in ("FLOOD", "LANDSLIDE"):
        bh = [r for r in baseline_results if r["hazard_type"] == h]
        bhp = [r for r in bh if r["case_type"] == "POSITIVE_EVENT"]
        if bh:
            baseline_by_hazard[h] = {
                "cases": len(bh),
                "hit_rate": round(sum(1 for r in bhp if r["passed"]) / len(bhp), 3) if bhp else None
            }
    # Model gain: same-pass-rate delta per hazard, None where either side lacks samples
    model_gain = {}
    for h in ("FLOOD", "LANDSLIDE"):
        m = by_hazard.get(h, {}).get("hit_rate") if h in by_hazard else None
        b = baseline_by_hazard.get(h, {}).get("hit_rate")
        model_gain[h] = (
            round(m - b, 3) if (m is not None and b is not None) else None
        )

    overall_pass = len(results) - sum(1 for r in results if not r["passed"])
    verdict = "VALIDATED" if (hit_rate == 1.0 and false_alarm_rate == 0.0 and safety_rate == 1.0) else "NEEDS_REVIEW"

    return {
        "validated_at": utcnow().isoformat(),
        "total_cases": len(results),
        "positive_events": len(positives),
        "negative_events": len(negatives),
        "safety_cases": len(safety),
        "historical_hit_rate": hit_rate,
        "false_alarm_rate": false_alarm_rate,
        "safety_rule_pass_rate": safety_rate,
        "overall_pass_count": overall_pass,
        "verdict": verdict,
        "by_hazard": by_hazard,
        "baseline": {
            "name": "official-marks-only-no-ai",
            "method_note": "Baseline replays the SAME documented inputs using only official "
                           "operational practice: CWC gauge danger/warning marks for flood "
                           "(UNAVAILABLE when the gauge is missing) and no real-time rule at "
                           "all for landslides (always LOW), since no official real-time "
                           "threshold exists. The delta shows what the risk engines add.",
            "historical_hit_rate": base_hit_rate,
            "false_alarm_rate": base_false_alarm_rate,
            "safety_rule_pass_rate": round(
                sum(1 for r in baseline_results if r["case_type"] == "SAFETY_CASE" and r["passed"]) /
                max(1, sum(1 for r in baseline_results if r["case_type"] == "SAFETY_CASE")), 3
            ) if any(r["case_type"] == "SAFETY_CASE" for r in baseline_results) else None,
            "by_hazard": baseline_by_hazard,
            "model_gain_over_baseline": model_gain
        },
        "baseline_cases": baseline_results,
        "cases": results,
        "method_note": "Cases replay documented hydrological / hazard inputs from official "
                       "ASDMA, CWC, GSI and SDMA event records into the prediction engines. "
                       "A prediction is reliable only after these historical replays match "
                       "documented outcomes.",
        "threshold_provenance": {
            "flood": "CWC official danger/warning marks applied per station (Pandu 49.68/48.68, "
                     "Silchar 19.83/18.87, Teesta 865/860, Imphal 790.3/788, Dhansiri 148/146.5)",
            "landslide": "GSI antecedent rainfall thresholds: ARI >= 160mm critical / "
                         ">= 95mm moderate on GSI-susceptibility >= 0.60 steep zones"
        }
    }
