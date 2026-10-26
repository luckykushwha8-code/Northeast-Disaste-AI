import datetime
from sqlalchemy.orm import Session
from app.models.entities import Observation, DataSource, Location
from app.config import settings

UNIT_STANDARDS = {
    "rainfall": "mm",
    "rainfall_1h_mm": "mm",
    "rainfall_24h_mm": "mm",
    "rainfall_3d_mm": "mm",
    "river_level": "m",
    "river_level_m": "m",
    "river_rate": "m/hr",
    "river_rate_m_hr": "m/hr",
    "soil_moisture": "%",
    "soil_moisture_pct": "%"
}

UNIT_CONVERSIONS = {
    ("cm", "mm"): 10.0,
    ("in", "mm"): 25.4,
    ("ft", "m"): 0.3048
}

class IngestionService:
    """Handles data validation, unit standardization, duplicate detection, and freshness tracking."""

    @staticmethod
    def normalize_and_ingest(
        db: Session,
        source_id: str,
        location_id: str,
        observed_at: datetime.datetime,
        variable: str,
        raw_value: float,
        raw_unit: str,
        provenance: str = "Automated Feed",
        simulation_flag: bool = False
    ) -> Observation:
        # Check location and source exist
        loc = db.query(Location).filter(Location.id == location_id).first()
        if not loc:
            raise ValueError(f"Unknown location_id: {location_id}")

        source = db.query(DataSource).filter(DataSource.id == source_id).first()
        if not source:
            raise ValueError(f"Unknown source_id: {source_id}")

        # Normalize observed_at to naive UTC datetime for consistent storage
        if observed_at.tzinfo is not None:
            clean_observed_at = observed_at.astimezone(datetime.timezone.utc).replace(tzinfo=None)
        else:
            clean_observed_at = observed_at

        # Unit validation and conversion (FR-DATA-03)
        std_unit = UNIT_STANDARDS.get(variable)
        converted_val = raw_value

        if std_unit and raw_unit.lower() != std_unit.lower():
            conversion_key = (raw_unit.lower(), std_unit.lower())
            if conversion_key in UNIT_CONVERSIONS:
                converted_val = raw_value * UNIT_CONVERSIONS[conversion_key]
            else:
                raise ValueError(f"Incompatible unit '{raw_unit}' for variable '{variable}'. Expected '{std_unit}'.")

        # Duplicate detection (FR-DATA-04)
        existing = db.query(Observation).filter(
            Observation.source_id == source_id,
            Observation.location_id == location_id,
            Observation.variable == variable,
            Observation.observed_at == clean_observed_at
        ).first()

        if existing:
            return existing  # Idempotent: return existing record without duplicating

        # Data Freshness calculation (FR-DATA-06)
        now = datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)
        age_hours = (now - clean_observed_at).total_seconds() / 3600.0
        max_freshness = source.expected_update_interval_hours or settings.FRESHNESS_WEATHER_HOURS

        if simulation_flag:
            quality_status = "SIMULATED"
        elif age_hours <= max_freshness:
            quality_status = "VALID"
        elif age_hours <= (max_freshness * 2):
            quality_status = "DELAYED"
        else:
            quality_status = "STALE"

        obs = Observation(
            source_id=source_id,
            location_id=location_id,
            observed_at=clean_observed_at,
            ingested_at=now,
            variable=variable,
            value=round(converted_val, 2),
            unit=std_unit or raw_unit,
            quality_status=quality_status,
            provenance=provenance,
            simulation_flag=simulation_flag
        )
        db.add(obs)

        # Synthetic replay rows are never evidence of a successful live source.
        if not simulation_flag and quality_status in {"VALID", "DELAYED"}:
            source.last_success_at = now
            source.status = "OPERATIONAL" if quality_status == "VALID" else "DELAYED"

        db.commit()
        db.refresh(obs)
        return obs

    @staticmethod
    def record_source_failure(db: Session, source_id: str, error_message: str):
        """Enforces FR-DATA-07: Record source failures and update feed health without crashing."""
        source = db.query(DataSource).filter(DataSource.id == source_id).first()
        if source:
            source.last_error_at = datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)
            source.status = "FAILED"
            db.commit()
