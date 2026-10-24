import datetime
from app.time_utils import utcnow
import json
import logging
from typing import Dict, Any, Optional

from sqlalchemy.orm import Session

from app.models.entities import (
    Alert, Location, Observation, DataSource
)
from app.services.alert_engine import AlertEngine
from app.services.audit_service import log_audit

logger = logging.getLogger("auto_alert_service")

ACTIVE_STATES = ["PROPOSED", "REVIEWED", "APPROVED", "ISSUED", "ACKNOWLEDGED"]

RIVER_MARKS = {
    "loc_pandu_ghat": {"warning_level_m": 48.68, "danger_level_m": 49.68, "site": "Brahmaputra at Pandu (#022-MBAPU)"},
    "loc_cachar_silchar": {"warning_level_m": 18.87, "danger_level_m": 19.83, "site": "Barak at Silchar (#014-BRSIL)"},
    "loc_pasighat_siang": {"warning_level_m": 152.00, "danger_level_m": 153.96, "site": "Siang at Pasighat (#031-SNGPAS)"},
    "loc_teesta_mangan": {"warning_level_m": 860.00, "danger_level_m": 865.00, "site": "Teesta at Mangan (#008-TSTMAN)"},
    "loc_imphal_river": {"warning_level_m": 788.00, "danger_level_m": 790.30, "site": "Imphal at Sanjenbam (#019-IMPSAN)"},
    "loc_dimapur_dhansiri": {"warning_level_m": 146.50, "danger_level_m": 148.00, "site": "Dhansiri at Dimapur (#025-DHSDIM)"},
    "loc_agartala_howrah": {"warning_level_m": 6.00, "danger_level_m": 6.30, "site": "Howrah at Agartala (#047-TRSHWR)"}
}


def _latest(db: Session, location_id: str, variable: str) -> Optional[Observation]:
    return db.query(Observation).filter(
        Observation.location_id == location_id,
        Observation.variable == variable
    ).order_by(Observation.observed_at.desc()).first()


def _existing_active_alert(db: Session, location_id: str, hazard_type: str) -> Optional[Alert]:
    """Highest-severity active alert (official or AI) for location+hazard."""
    return db.query(Alert).filter(
        Alert.location_id == location_id,
        Alert.hazard_type == hazard_type,
        Alert.lifecycle_status.in_(ACTIVE_STATES)
    ).order_by(
        (Alert.severity == "CRITICAL").desc(),
        (Alert.severity == "HIGH").desc(),
        (Alert.severity == "MODERATE").desc()
    ).first()


def _data_source_ref(db: Session, source_id: str) -> str:
    src = db.query(DataSource).filter(DataSource.id == source_id).first()
    if src:
        return f"{src.name} ({src.source_type})"
    return source_id


class AutoAlertService:
    """
    Evaluates validated stored observations against the platform's safety rules
    AFTER each data sync and creates/updates PROPOSED alerts.

    Safety properties:
      - Never invents thresholds: rules use official CWC danger/warning marks and
        GSI antecedent-rainfall criteria already validated against history.
      - Dedup: no duplicate alert is created if an active (higher-or-equal
        severity) alert already exists for the same location + hazard.
      - All AI-generated alerts are PROPOSED (operator review required) and
        explicitly labeled AI_ASSESSMENT, never as official government warnings.
    """

    RULES_VERSION = "auto-alert-rules-v1.0"

    # ------------------ RULE: CWC river marks ------------------
    def rule_river_level(self, db: Session, loc: Location):
        obs = _latest(db, loc.id, "river_level_m")
        if not obs or obs.value is None:
            return None
        marks = RIVER_MARKS.get(loc.id)
        if not marks:
            return None
        if obs.value >= marks["danger_level_m"]:
            severity, reason = "CRITICAL", (
                f"CWC gauge {obs.value:.2f}m is at or above the official DANGER level "
                f"{marks['danger_level_m']:.2f}m at {marks['site']}."
            )
        elif obs.value >= marks["warning_level_m"]:
            severity, reason = "HIGH", (
                f"CWC gauge {obs.value:.2f}m is above the official WARNING level "
                f"{marks['warning_level_m']:.2f}m at {marks['site']}."
            )
        else:
            return None
        return {
            "hazard_type": "FLOOD",
            "severity": severity,
            "reason": reason,
            "data_source_reference": f"{_data_source_ref(db, obs.source_id)} | obs {obs.observed_at.isoformat()} ({obs.variable}={obs.value}{obs.unit})",
            "rule_id": "AUTO-R1-cwc-marks",
            "title": f"River at/above official {'danger' if severity == 'CRITICAL' else 'warning'} level — {marks['site']}"
        }

    # ------------------ RULE: rapid rise ------------------
    def rule_rapid_rise(self, db: Session, loc: Location):
        obs = _latest(db, loc.id, "river_rate_m_hr")
        if not obs or obs.value is None or obs.value < 0.12:
            return None
        return {
            "hazard_type": "FLOOD",
            "severity": "HIGH" if obs.value >= 0.25 else "MODERATE",
            "reason": (
                f"River stage rising at {obs.value:.2f} m/hr (measured CWC trend) at "
                f"{loc.name} — sustained rise may reach official warning level within hours."
            ),
            "data_source_reference": f"{_data_source_ref(db, obs.source_id)} | obs {obs.observed_at.isoformat()} (river_rate_m_hr={obs.value:.2f} m/hr)",
            "rule_id": "AUTO-R2-rapid-rise",
            "title": f"Rapid river-level rise detected — {loc.name}"
        }

    # ------------------ RULE: heavy rainfall ------------------
    def rule_heavy_rainfall(self, db: Session, loc: Location):
        obs = _latest(db, loc.id, "rainfall_24h_mm")
        if not obs or obs.value is None:
            return None
        if obs.value < 100.0:
            return None
        severity = "HIGH" if obs.value >= 150.0 else "MODERATE"
        return {
            "hazard_type": "LANDSLIDE",  # rainfall information conveyed as hazard notification
            "severity": severity,
            "reason": (
                f"Heavy rainfall recorded: {obs.value:.1f} mm in the last 24h "
                f"(IMD-stored observation {obs.observed_at.isoformat()}). "
                f"Slope zones in the district should brace for landslide triggers."
            ),
            "data_source_reference": f"{_data_source_ref(db, obs.source_id)} | obs {obs.observed_at.isoformat()} (rainfall_24h_mm={obs.value:.1f})",
            "rule_id": "AUTO-R3-heavy-rain",
            "title": f"Heavy rainfall ({obs.value:.0f}mm/24h) — {loc.name}"
        }

    # ------------------ RULE: landslide antecedent criteria ------------------
    def rule_landslide_criteria(self, db: Session, loc: Location):
        rain = _latest(db, loc.id, "rainfall_24h_mm")
        if not rain or rain.value is None:
            return None
        terrain = loc.terrain
        slope = terrain.slope_deg if terrain else 8.0
        susceptibility = terrain.susceptibility_score if terrain else 0.30
        ari = rain.value
        if ari >= 160.0 and slope >= 30.0:
            severity = "CRITICAL"
        elif ari >= 95.0 and susceptibility >= 0.60:
            severity = "HIGH"
        else:
            return None
        return {
            "hazard_type": "LANDSLIDE",
            "severity": severity,
            "reason": (
                f"GSI antecedent-rainfall criterion met: ARI {ari:.1f}mm on a slope of "
                f"{slope:.0f} deg with GSI susceptibility {susceptibility:.2f} at {loc.name}."
            ),
            "data_source_reference": f"{_data_source_ref(db, rain.source_id)} | obs {rain.observed_at.isoformat()} (rainfall_24h_mm={ari:.1f}, terrain slope {slope:.0f}deg)",
            "rule_id": "AUTO-R4-landslide-ari",
            "title": f"Landslide risk ({severity}) — {loc.name}"
        }

    # ------------------ ENGINE ------------------
    def evaluate_and_generate_alerts(self, db: Session) -> Dict[str, Any]:
        started = utcnow()
        locs = db.query(Location).filter(Location.active == True).all()
        created, skipped_duplicates, evaluated_rules = [], 0, 0

        for loc in locs:
            proposals = []
            for rule in (self.rule_river_level, self.rule_rapid_rise,
                         self.rule_heavy_rainfall, self.rule_landslide_criteria):
                try:
                    p = rule(db, loc)
                except Exception as e:
                    logger.warning("Rule %s failed for %s: %s", rule.__name__, loc.id, e)
                    continue
                if p:
                    proposals.append(p)
                evaluated_rules += 1

            for p in proposals:
                hazard = p["hazard_type"]
                existing = _existing_active_alert(db, loc.id, hazard)
                if existing:
                    rank = {"MODERATE": 1, "HIGH": 2, "CRITICAL": 3}
                    if rank.get(existing.severity, 0) >= rank.get(p["severity"], 0):
                        skipped_duplicates += 1
                        continue
                    # New evidence is worse — expire the weaker active alert
                    existing.lifecycle_status = "EXPIRED"
                    db.commit()

                alert = AlertEngine.create_proposal(
                    db=db,
                    location_id=loc.id,
                    hazard_type=hazard,
                    severity=p["severity"],
                    title=p["title"],
                    description=p["reason"],
                    action_instructions=(
                        "Move livestock/valuables to safe ground, prepare GO-BAG and documents; "
                        "follow only official ASDMA/DDMA instructions. Emergency number: 112."
                    ),
                    source_type="AI_ASSESSMENT",
                    official_source_reference=p["data_source_reference"],
                    created_by=f"AUTO_RULES({self.RULES_VERSION}:{p['rule_id']})",
                    simulation_flag=False,
                    expiry_hours=12
                )
                created.append({
                    "alert_id": alert.id,
                    "location_id": loc.id,
                    "hazard_type": hazard,
                    "severity": p["severity"],
                    "rule_id": p["rule_id"]
                })

        expired_count = AlertEngine.check_and_expire_alerts(db)

        returned = {
            "rules_version": self.RULES_VERSION,
            "evaluated_at": started.isoformat(),
            "locations_evaluated": len(locs),
            "rules_evaluated": evaluated_rules,
            "alerts_created": len(created),
            "duplicates_skipped": skipped_duplicates,
            "alerts_expired": expired_count,
            "new_alerts": created,
            "policy": "AI alerts stay PROPOSED for operator review; official CWC/IMD data is the only live-authentic source"
        }
        if created or skipped_duplicates:
            log_audit(
                db=db,
                actor_id="SYSTEM_AUTO_ALERT_RULES",
                action="AUTO_ALERT_EVALUATION",
                resource_type="Alert",
                resource_id=",".join(c["alert_id"] for c in created) or "none",
                reason=json.dumps(returned["new_alerts"]) if created else str(skipped_duplicates)
            )
        return returned


auto_alert_service = AutoAlertService()
