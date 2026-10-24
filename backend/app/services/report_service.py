import datetime
from app.time_utils import utcnow
import csv
import io
import os
import logging
from typing import Dict, Any

from sqlalchemy.orm import Session

from app.models.entities import (
    Location, Observation, Alert, IncidentReport, RescueRequest,
    Shelter, DataSource, DisasterEvent, LiveDataCache
)
from app.services.audit_service import log_audit

logger = logging.getLogger("report_service")

SEVERITY_ORDER = ["CRITICAL", "HIGH", "MODERATE", "LOW", "UNAVAILABLE"]
ACTIVE_STATES = ["PROPOSED", "REVIEWED", "APPROVED", "ISSUED", "ACKNOWLEDGED"]


def _latest_obs_map(db: Session, location_id: str) -> Dict[str, Observation]:
    recs = db.query(Observation).filter(
        Observation.location_id == location_id
    ).order_by(Observation.observed_at.desc()).limit(20).all()
    out: Dict[str, Observation] = {}
    for o in recs:
        if o.variable not in out:
            out[o.variable] = o
    return out


def build_report_data(db: Session) -> Dict[str, Any]:
    now = utcnow()
    locs = {l.id: l for l in db.query(Location).filter(Location.active == True).all()}
    src_map = {s.id: s for s in db.query(DataSource).all()}

    # ---- Weather summary + affected locations ----
    weather = []
    active_alerts = db.query(Alert).filter(Alert.lifecycle_status.in_(ACTIVE_STATES)).all()
    alerted_loc_ids = {a.location_id for a in active_alerts}
    for loc in locs.values():
        obs = _latest_obs_map(db, loc.id)
        rain = obs.get("rainfall_24h_mm")
        level = obs.get("river_level_m")
        weather.append({
            "location": loc.name,
            "state": loc.state,
            "district": loc.district,
            "rainfall_24h_mm": round(rain.value, 1) if rain else None,
            "river_level_m": round(level.value, 2) if level else None,
            "has_active_alert": loc.id in alerted_loc_ids
        })

    # ---- Alerts split: official vs AI ----
    official, ai_generated = [], []
    for a in active_alerts:
        row = {
            "id": a.id,
            "severity": a.severity,
            "hazard_type": a.hazard_type,
            "location": (locs.get(a.location_id).name if a.location_id in locs else a.location_id),
            "status": a.lifecycle_status,
            "issued_at": a.issued_at.isoformat() if a.issued_at else None,
            "expires_at": a.expires_at.isoformat() if a.expires_at else None,
            "title": a.title
        }
        if a.source_type == "AI_ASSESSMENT":
            row["source"] = "AI-GENERATED ESTIMATE (needs operator review)"
            ai_generated.append(row)
        else:
            row["source"] = f"OFFICIAL ({a.source_type})"
            official.append(row)

    # ---- Incidents ----
    incidents_all = db.query(IncidentReport).order_by(IncidentReport.report_time.desc()).all()
    verified = sum(1 for i in incidents_all if i.verification_status == "VERIFIED")
    unverified = sum(1 for i in incidents_all if i.verification_status == "UNVERIFIED")
    rejected = sum(1 for i in incidents_all if i.verification_status == "REJECTED")
    by_cat: Dict[str, int] = {}
    for i in incidents_all:
        by_cat[i.category] = by_cat.get(i.category, 0) + 1

    # ---- Rescue requests ----
    by_status: Dict[str, int] = {}
    for r in db.query(RescueRequest).all():
        by_status[r.status] = by_status.get(r.status, 0) + 1

    # ---- Documented historical events (reference baseline) ----
    events = db.query(DisasterEvent).order_by(DisasterEvent.event_start.desc()).all()
    events_summary = [{
        "hazard_type": e.hazard_type,
        "location": (locs.get(e.location_id).name if e.location_id in locs else e.location_id),
        "event_start": e.event_start.date().isoformat() if e.event_start else None,
        "severity": e.severity,
        "source_reference": e.source_reference
    } for e in events[:30]]

    # ---- Data freshness warnings ----
    warnings = []
    expected_hours = {
        "IMD": settings_fresh("FRESHNESS_WEATHER_HOURS"),
        "CWC": settings_fresh("FRESHNESS_RIVER_HOURS"),
        "SYNTH_IOT": settings_fresh("FRESHNESS_SENSOR_HOURS"),
        "GSI": 24.0
    }
    for s in src_map.values():
        ref = expected_hours.get(s.source_type, 24.0)
        if s.last_success_at is None:
            warnings.append(f"{s.name}: never synchronised (badge: {s.status})")
        else:
            age = (now - s.last_success_at).total_seconds() / 3600.0
            if age > ref * 3:
                warnings.append(f"{s.name}: last success {s.last_success_at.isoformat()} — {age:.1f}h ago, expected every {ref:.0f}h")

    # ---- Shelter capacity ----
    shelters = db.query(Shelter).all()
    total_cap = sum(sh.capacity or 0 for sh in shelters)
    total_occ = sum(sh.current_occupancy or 0 for sh in shelters)

    return {
        "generated_at": now.isoformat(),
        "study_area": "Northeast India (all 8 states) — monitored points only",
        "weather_summary": weather,
        "official_alerts": official,
        "ai_assessments": ai_generated,
        "incidents": {
            "verified": verified, "unverified": unverified, "rejected": rejected,
            "total": len(incidents_all), "by_category": by_cat,
            "note": "Citizen reports are UNVERIFIED until a responder reviews them — never treated as official data."
        },
        "rescue_requests": {
            "by_status": by_status,
            "active": sum(v for k, v in by_status.items() if k in ["SUBMITTED", "RECEIVED", "ASSIGNED", "EN_ROUTE"]),
            "note": "'SERVED/CLOSED' only after responder confirmation; platform never auto-dispatches."
        },
        "shelters": {"count": len(shelters), "total_capacity": total_cap, "current_occupancy": total_occ},
        "historical_reference": events_summary,
        "data_warnings": warnings,
        "sources": [{
            "id": s.id, "name": s.name, "type": s.source_type,
            "status": s.status,
            "last_success": s.last_success_at.isoformat() if s.last_success_at else None
        } for s in src_map.values()]
    }


def settings_fresh(key: str) -> float:
    from app.config import settings
    return float(getattr(settings, key, 24.0))


# ---------------- CSV ----------------
def render_csv(data: Dict[str, Any]) -> bytes:
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["NE-SAFE AI — DISASTER SITUATION REPORT"])
    w.writerow(["GENERATED_AT", data["generated_at"]])
    w.writerow(["STUDY_AREA", data["study_area"]])
    w.writerow([])
    w.writerow(["SECTION", "WEATHER SUMMARY (latest stored observations)"])
    w.writerow(["Location", "State", "District", "Rainfall 24h (mm)", "River level (m)", "Has active alert?"])
    for r in data["weather_summary"]:
        w.writerow([r["location"], r["state"], r["district"], r["rainfall_24h_mm"], r["river_level_m"],
                    "YES" if r["has_active_alert"] else "no"])
    w.writerow([])
    w.writerow(["SECTION", "OFFICIAL ALERTS"])
    w.writerow(["Severity", "Hazard", "Location", "Status", "Issued", "Expires", "Title"])
    for a in data["official_alerts"]:
        w.writerow([a["severity"], a["hazard_type"], a["location"], a["status"], a["issued_at"], a["expires_at"], a["title"]])
    w.writerow([])
    w.writerow(["SECTION", "AI ASSESSMENTS (ADVISORY ONLY — pending operator review)"])
    for a in data["ai_assessments"]:
        w.writerow([a["severity"], a["hazard_type"], a["location"], a["status"], a["title"]])
    w.writerow([])
    w.writerow(["SECTION", "COMMUNITY INCIDENTS"])
    w.writerow(["Verified", "Unverified", "Rejected", "Total"])
    inc = data["incidents"]
    w.writerow([inc["verified"], inc["unverified"], inc["rejected"], inc["total"]])
    w.writerow(["Category", "Count"])
    for cat, n in inc["by_category"].items():
        w.writerow([cat, n])
    w.writerow([])
    w.writerow(["SECTION", "RESCUE REQUESTS"])
    w.writerow(["Status", "Count"])
    for st, n in data["rescue_requests"]["by_status"].items():
        w.writerow([st, n])
    w.writerow([])
    w.writerow(["SECTION", "DOCUMENTED HISTORICAL EVENTS (source-referenced)"])
    w.writerow(["Hazard", "Location", "Date", "Severity", "Source"])
    for e in data["historical_reference"]:
        w.writerow([e["hazard_type"], e["location"], e["event_start"], e["severity"], e["source_reference"]])
    w.writerow([])
    w.writerow(["SECTION", "DATA QUALITY WARNINGS (stale / never-synced feeds)"])
    if not data["data_warnings"]:
        w.writerow(["None — all feeds within expected intervals or explicitly offline."])
    for msg in data["data_warnings"]:
        w.writerow([msg])
    w.writerow([])
    w.writerow(["SECTION", "DATA SOURCES"])
    w.writerow(["Name", "Type", "Status", "Last successful sync"])
    for s in data["sources"]:
        w.writerow([s["name"], s["type"], s["status"], s["last_success"]])
    w.writerow([])
    w.writerow(["DISCLAIMER", "Official CWC/IMD/GSI bulletins remain authoritative. "
                              "AI values are advisory and provenance-stamped. Citizen reports are unverified."])
    return buf.getvalue().encode("utf-8-sig", errors="replace")


# ---------------- PDF ----------------
def render_pdf(data: Dict[str, Any]) -> bytes:
    from reportlab.lib.pagesizes import A4
    from reportlab.lib import colors
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle

    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, title="NE-SAFE AI Situation Report")
    styles = getSampleStyleSheet()
    h2 = ParagraphStyle("H2", parent=styles["Heading2"], fontSize=13, spaceBefore=10, textColor=colors.HexColor("#0f172a"))
    small = ParagraphStyle("small", parent=styles["Normal"], fontSize=8, textColor=colors.HexColor("#334155"))
    cells = ParagraphStyle("cell", parent=small)

    def table(rows, col_widths=None, header=True):
        t = Table(rows, colWidths=col_widths, repeatRows=1 if header else 0)
        t.setStyle(TableStyle([
            ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#cbd5e1")),
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#e2e8f0")),
            ("FONTSIZE", (0, 0), (-1, -1), 7.5),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f8fafc")])
        ]))
        return t

    flow = [
        Paragraph("NE-SAFE AI — Disaster Situation Report", styles["Title"]),
        Paragraph(f"Generated: {data['generated_at']} UTC &nbsp;|&nbsp; Study area: {data['study_area']}", styles["Normal"]),
        Spacer(1, 8),
    ]

    flow.append(Paragraph("1. Weather Summary (latest stored observations)", h2))
    rows = [[Paragraph(x, cells) for x in
             ("Location", "State", "Rain 24h (mm)", "River (m)", "Active alert")]]
    for r in data["weather_summary"]:
        rows.append([
            Paragraph(str(r["location"]), cells), Paragraph(str(r["state"]), cells),
            Paragraph(str(r["rainfall_24h_mm"]), cells), Paragraph(str(r["river_level_m"]), cells),
            Paragraph("YES" if r["has_active_alert"] else "no", cells)])
    flow.append(table(rows))

    flow.append(Paragraph("2. Official Alerts (government / CWC / IMD-sourced)", h2))
    if data["official_alerts"]:
        rows = [[Paragraph(x, cells) for x in ("Severity", "Hazard", "Location", "Status", "Expires (UTC)")]]
        for a in data["official_alerts"]:
            rows.append([Paragraph(str(a["severity"]), cells), Paragraph(str(a["hazard_type"]), cells),
                         Paragraph(str(a["location"]), cells), Paragraph(str(a["status"]), cells),
                         Paragraph(str((a["expires_at"] or "")[:19]), cells)])
        flow.append(table(rows))
    else:
        flow.append(Paragraph("No active official alerts at report time.", small))

    flow.append(Paragraph("3. AI Risk Assessments (ADVISORY ONLY)", h2))
    if data["ai_assessments"]:
        rows = [[Paragraph(x, cells) for x in ("Severity", "Hazard", "Location", "Status", "Title")]]
        for a in data["ai_assessments"]:
            rows.append([Paragraph(str(a["severity"]), cells), Paragraph(str(a["hazard_type"]), cells),
                         Paragraph(str(a["location"]), cells), Paragraph(str(a["status"]), cells),
                         Paragraph(str(a["title"])[:120], cells)])
        flow.append(table(rows))
    else:
        flow.append(Paragraph("No active AI-assessment alerts.", small))

    inc = data["incidents"]
    flow.append(Paragraph(f"4. Community Incidents — verified {inc['verified']} | unverified {inc['unverified']} | rejected {inc['rejected']}", h2))
    rows = [[Paragraph(x, cells) for x in ("Category", "Count")]] if inc["by_category"] else None
    if inc["by_category"]:
        for cat, n in inc["by_category"].items():
            rows.append([Paragraph(str(cat), cells), Paragraph(str(n), cells)])
        flow.append(table(rows))
    else:
        flow.append(Paragraph("No incidents reported.", small))

    rr = data["rescue_requests"]["by_status"]
    flow.append(Paragraph("5. Rescue Requests (responder-confirmed only)", h2))
    if rr:
        rows = [[Paragraph(x, cells) for x in ("Status", "Count")]]
        for st, n in sorted(rr.items()):
            rows.append([Paragraph(str(st), cells), Paragraph(str(n), cells)])
        flow.append(table(rows))
    else:
        flow.append(Paragraph("No rescue requests at report time.", small))

    flow.append(Paragraph("6. Documented Historical Events (source-referenced)", h2))
    rows = [[Paragraph(x, cells) for x in ("Hazard", "Location", "Date", "Severity", "Source (truncated)")]]
    for e in data["historical_reference"][:15]:
        rows.append([Paragraph(str(e["hazard_type"]), cells), Paragraph(str(e["location"]), cells),
                     Paragraph(str(e["event_start"]), cells), Paragraph(str(e["severity"]), cells),
                     Paragraph(str(e["source_reference"])[:90], cells)])
    flow.append(table(rows))

    flow.append(Paragraph("7. Data Quality Warnings", h2))
    if data["data_warnings"]:
        for msg in data["data_warnings"]:
            flow.append(Paragraph(f"• {msg}", small))
    else:
        flow.append(Paragraph("All monitored feeds within expected intervals.", small))

    flow.append(Paragraph("8. Data Sources", h2))
    rows = [[Paragraph(x, cells) for x in ("Name", "Type", "Status", "Last success (UTC)")]]
    for s in data["sources"]:
        rows.append([Paragraph(str(s["name"]), cells), Paragraph(str(s["type"]), cells),
                     Paragraph(str(s["status"]), cells), Paragraph(str((s["last_success"] or "")[:19]), cells)])
    flow.append(table(rows))

    flow.append(Spacer(1, 10))
    flow.append(Paragraph(
        "Disclaimer: Official CWC / IMD / GSI / SDMA bulletins remain strictly authoritative. "
        "AI probability outputs are advisory and provenance-stamped. Citizen reports are unverified until reviewed. "
        "This report was generated automatically from stored platform data.", small))
    doc.build(flow)
    return buf.getvalue()


def generate_daily_pdf_to_disk(db: Session, reports_dir: str = "reports") -> str:
    """Scheduled daily job: writes snapshot PDF to disk + audit log entry."""
    os.makedirs(reports_dir, exist_ok=True)
    data = build_report_data(db)
    fname = f"nesafe_daily_{utcnow().strftime('%Y%m%d_%H%M')}.pdf"
    path = os.path.join(reports_dir, fname)
    with open(path, "wb") as f:
        f.write(render_pdf(data))
    log_audit(
        db=db,
        actor_id="SYSTEM_DAILY_REPORT",
        action="DAILY_REPORT_GENERATED",
        resource_type="Report",
        resource_id=fname,
        reason=f"Auto situation report written to {path}"
    )
    return path
