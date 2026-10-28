import datetime
import json
from sqlalchemy.orm import Session
from app.models.entities import (
    Location, TerrainFeature, DataSource, Shelter, ModelVersion, User, Observation,
    DisasterEvent, HistoricalValidationCase, LiveDataCache
)

def _dt(value: str) -> datetime.datetime:
    return datetime.datetime.fromisoformat(value + ("T00:00:00" if len(value) == 10 else ""))


def seed_database(db: Session):
    """
    Populates comprehensive seed data covering all 8 Northeast States:
    Assam, Arunachal Pradesh, Meghalaya, Manipur, Mizoram, Nagaland, Tripura, Sikkim.
    Seeds only static map locations and source catalogue entries. Live observations,
    terrain, shelter status and model metrics must come from verified source feeds.
    """
    now = datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)

    # 1. Users
    existing_users = {u.id for u in db.query(User).all()}
    users = [
        User(
            id="usr_admin_01",
            display_name="North East Regional Disaster Management Council",
            email="ner.disaster@nesafe.gov.in",
            role="ADMIN",
            preferred_language="en",
            account_status="ACTIVE"
        ),
        User(
            id="usr_operator_01",
            display_name="Pranab Barman (SEOC Operator - Guwahati)",
            email="operator.pranab@nesafe.gov.in",
            role="OPERATOR",
            preferred_language="as",
            account_status="ACTIVE"
        ),
        User(
            id="usr_responder_01",
            display_name="SDRF 1st Battalion Guwahati / Shillong",
            email="sdrf.alpha@nesafe.gov.in",
            role="RESPONDER",
            preferred_language="en",
            account_status="ACTIVE"
        ),
        User(
            id="usr_resident_01",
            display_name="Anamika Das",
            email="anamika.guwahati@example.com",
            role="RESIDENT",
            preferred_language="as",
            account_status="ACTIVE"
        )
    ]
    for u in users:
        if u.id not in existing_users:
            db.add(u)

    # 2. Data Sources (Official Portals: IMD, CWC, GSI, Bhuvan)
    existing_sources = {s.id for s in db.query(DataSource).all()}
    sources = [
        DataSource(
            id="src_imd_api",
            name="IMD official public web products (via TinyFish)",
            source_type="OFFICIAL_WEBSITE",
            configuration_reference="https://mausam.imd.gov.in/responsive/districtWiseWarningGIS.php",
            expected_update_interval_hours=3.0,
            enabled=True,
            status="NOT_CHECKED"
        ),
        DataSource(
            id="src_cwc_brahmaputra",
            name="Central Water Commission (CWC) - National Flood Forecasting System",
            source_type="CWC",
            configuration_reference="https://ffs.india-water.gov.in/station/022-MBAPU",
            expected_update_interval_hours=2.0,
            enabled=True,
            status="NOT_CHECKED"
        ),
        DataSource(
            id="src_gsi_landslide",
            name="Geological Survey of India (GSI) - Bhusanket & NLSM",
            source_type="GSI",
            configuration_reference="https://bhusanket.gsi.gov.in/landslide-hazard",
            expected_update_interval_hours=720.0,
            enabled=True,
            status="NOT_CHECKED"
        ),
        DataSource(
            id="src_isro_bhuvan",
            name="ISRO / NRSC Bhuvan Disaster Services & WMS",
            source_type="BHUVAN_WMS",
            configuration_reference="https://bhuvan.nrsc.gov.in/thematic/wms",
            expected_update_interval_hours=24.0,
            enabled=True,
            status="NOT_CHECKED"
        ),
        DataSource(
            id="src_smart_city_iot",
            name="Guwahati Smart City Urban Hydrology Sensors",
            source_type="SYNTH_IOT",
            configuration_reference="iot://smartcity.guwahati.gov.in/sensors",
            expected_update_interval_hours=1.0,
            enabled=True,
            status="SIMULATED"
        ),
        DataSource(
            id="src_open_meteo",
            name="Open-Meteo observed and forecast precipitation",
            source_type="WEATHER_API",
            configuration_reference="https://api.open-meteo.com/v1/forecast",
            expected_update_interval_hours=0.5,
            enabled=True,
            status="NOT_CHECKED"
        )
    ]
    for s in sources:
        if s.id not in existing_sources:
            db.add(s)
            continue
        # Existing source health/history is left untouched. Runtime health is
        # computed from fresh retrievals by the API and sync jobs.

    # 3. Locations across all 8 Northeast States
    existing_locations = {l.id for l in db.query(Location).all()}
    locations = [
        # --- ASSAM ---
        Location(
            id="loc_pandu_ghat",
            name="Pandu Ghat Riverfront (Brahmaputra)",
            state="Assam",
            district="Kamrup Metropolitan",
            location_type="RIVER_STATION",
            latitude=26.1772,
            longitude=91.6883,
            elevation_m=52.0,
            active=True
        ),
        Location(
            id="loc_bharalu_basin",
            name="Bharalu River Basin (Guwahati)",
            state="Assam",
            district="Kamrup Metropolitan",
            location_type="URBAN_CATCHMENT",
            latitude=26.1620,
            longitude=91.7340,
            elevation_m=54.5,
            active=True
        ),
        Location(
            id="loc_kharghuli_hills",
            name="Kharghuli Hill Slope",
            state="Assam",
            district="Kamrup Metropolitan",
            location_type="SLOPE_ZONE",
            latitude=26.2025,
            longitude=91.7760,
            elevation_m=110.0,
            active=True
        ),
        Location(
            id="loc_kamakhya_nilachal",
            name="Nilachal / Kamakhya Temple Hill",
            state="Assam",
            district="Kamrup Metropolitan",
            location_type="SLOPE_ZONE",
            latitude=26.1664,
            longitude=91.7052,
            elevation_m=175.0,
            active=True
        ),
        Location(
            id="loc_narakasur_hills",
            name="Narakasur / Bhangagarh Slope (GMCH)",
            state="Assam",
            district="Kamrup Metropolitan",
            location_type="SLOPE_ZONE",
            latitude=26.1495,
            longitude=91.7610,
            elevation_m=140.0,
            active=True
        ),
        Location(
            id="loc_cachar_silchar",
            name="Annapurna Ghat (Barak River)",
            state="Assam",
            district="Cachar",
            location_type="RIVER_STATION",
            latitude=24.8333,
            longitude=92.7789,
            elevation_m=28.0,
            active=True
        ),
        Location(
            id="loc_dhemaji_jiadhal",
            name="Jiadhal Flash Flood Catchment",
            state="Assam",
            district="Dhemaji",
            location_type="RIVER_STATION",
            latitude=27.4833,
            longitude=94.5833,
            elevation_m=104.0,
            active=True
        ),

        # --- ARUNACHAL PRADESH ---
        Location(
            id="loc_itanagar_hills",
            name="Itanagar Capital Cut Slopes",
            state="Arunachal Pradesh",
            district="Papum Pare",
            location_type="SLOPE_ZONE",
            latitude=27.0844,
            longitude=93.6053,
            elevation_m=320.0,
            active=True
        ),
        Location(
            id="loc_pasighat_siang",
            name="Pasighat Siang River Gorge",
            state="Arunachal Pradesh",
            district="East Siang",
            location_type="RIVER_STATION",
            latitude=28.0667,
            longitude=95.3333,
            elevation_m=155.0,
            active=True
        ),

        # --- MEGHALAYA ---
        Location(
            id="loc_cherrapunji_sohra",
            name="Sohra / Cherrapunji Escarpment",
            state="Meghalaya",
            district="East Khasi Hills",
            location_type="SLOPE_ZONE",
            latitude=25.2702,
            longitude=91.7323,
            elevation_m=1430.0,
            active=True
        ),
        Location(
            id="loc_shillong_hills",
            name="Shillong Urban Basin & Wahumkhrah",
            state="Meghalaya",
            district="East Khasi Hills",
            location_type="URBAN_CATCHMENT",
            latitude=25.5788,
            longitude=91.8933,
            elevation_m=1520.0,
            active=True
        ),

        # --- MANIPUR ---
        Location(
            id="loc_imphal_river",
            name="Imphal River at Sanjenthong",
            state="Manipur",
            district="Imphal West",
            location_type="RIVER_STATION",
            latitude=24.8170,
            longitude=93.9368,
            elevation_m=786.0,
            active=True
        ),
        Location(
            id="loc_tupul_slope",
            name="Tupul Railway Corridor Slopes",
            state="Manipur",
            district="Noney",
            location_type="SLOPE_ZONE",
            latitude=24.7890,
            longitude=93.6820,
            elevation_m=650.0,
            active=True
        ),

        # --- MIZORAM ---
        Location(
            id="loc_aizawl_slopes",
            name="Aizawl Ridge & Ramhlun Slopes",
            state="Mizoram",
            district="Aizawl",
            location_type="SLOPE_ZONE",
            latitude=23.7271,
            longitude=92.7176,
            elevation_m=1132.0,
            active=True
        ),

        # --- NAGALAND ---
        Location(
            id="loc_kohima_slopes",
            name="Kohima Phesama Creep Zone",
            state="Nagaland",
            district="Kohima",
            location_type="SLOPE_ZONE",
            latitude=25.6751,
            longitude=94.1086,
            elevation_m=1444.0,
            active=True
        ),
        Location(
            id="loc_dimapur_dhansiri",
            name="Dhansiri River Floodplain (Dimapur)",
            state="Nagaland",
            district="Dimapur",
            location_type="RIVER_STATION",
            latitude=25.9090,
            longitude=93.7265,
            elevation_m=145.0,
            active=True
        ),

        # --- TRIPURA ---
        Location(
            id="loc_agartala_howrah",
            name="Howrah River Embankment (Agartala)",
            state="Tripura",
            district="West Tripura",
            location_type="RIVER_STATION",
            latitude=23.8315,
            longitude=91.2868,
            elevation_m=15.0,
            active=True
        ),

        # --- SIKKIM ---
        Location(
            id="loc_gangtok_slopes",
            name="Gangtok Deorali Valley Slopes",
            state="Sikkim",
            district="East Sikkim",
            location_type="SLOPE_ZONE",
            latitude=27.3314,
            longitude=88.6138,
            elevation_m=1650.0,
            active=True
        ),
        Location(
            id="loc_teesta_mangan",
            name="Teesta River Basin (Mangan - Chungthang)",
            state="Sikkim",
            district="North Sikkim",
            location_type="RIVER_STATION",
            latitude=27.5000,
            longitude=88.5333,
            elevation_m=860.0,
            active=True
        )
    ]
    for loc in locations:
        if loc.id not in existing_locations:
            db.add(loc)
    db.flush()

    # No terrain or shelter rows are seeded. Their live/provenance feeds are not connected.

    # 6. Model Versions
    existing_models = {m.id for m in db.query(ModelVersion).all()}
    model_versions = [
        ModelVersion(
            id="cwc-ml-hybrid-v1.2",
            hazard_type="FLOOD",
            version="1.2.0",
            training_data_version="ASSAM_MONSOON_2016_2023_CWC_IMD",
            approval_status="PROTOTYPE",
            evaluation_metrics_json=None,
            known_limitations="Requires river gauge at Pandu within 2h. Accuracy degrades during unmetered sudden embankment breaches upstream."
        ),
        ModelVersion(
            id="gsi-ari-hybrid-v2.0",
            hazard_type="LANDSLIDE",
            version="2.0.0",
            training_data_version="GSI_NLSM_HISTORICAL_INVENTORY_2018_2023",
            approval_status="PROTOTYPE",
            evaluation_metrics_json=None,
            known_limitations="Subsurface soil pore pressure data is synthetic/estimated where borehole piezometers are unavailable. Low score does not guarantee slope safety."
        )
    ]
    for m in model_versions:
        if m.id not in existing_models:
            db.add(m)

    db.commit()
