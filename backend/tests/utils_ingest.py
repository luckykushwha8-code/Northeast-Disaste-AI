import datetime
from app.services.ingestion import IngestionService

def set_obs(db, location_id, variable, value, hours_ago=0.0):
    return IngestionService.normalize_and_ingest(
        db=db,
        source_id="src_cwc_brahmaputra" if variable.startswith("river") else "src_imd_api",
        location_id=location_id,
        observed_at=datetime.datetime.utcnow() - datetime.timedelta(hours=hours_ago),
        variable=variable,
        raw_value=value,
        raw_unit="m" if variable.startswith("river") else "mm",
        provenance="test set",
        simulation_flag=False
    )
