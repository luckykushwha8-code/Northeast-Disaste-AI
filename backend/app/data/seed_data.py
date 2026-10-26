import datetime
import json
from sqlalchemy.orm import Session
from app.models.entities import (
    Location, TerrainFeature, DataSource, Shelter, ModelVersion, User, Observation,
    DisasterEvent, HistoricalValidationCase, LiveDataCache
)
from app.services.validation_service import seed_historical_validation_cases
from app.data.historical_cases import documented_disaster_events

def _dt(value: str) -> datetime.datetime:
    return datetime.datetime.fromisoformat(value + ("T00:00:00" if len(value) == 10 else ""))


def seed_database(db: Session):
    """
    Populates comprehensive seed data covering all 8 Northeast States:
    Assam, Arunachal Pradesh, Meghalaya, Manipur, Mizoram, Nagaland, Tripura, Sikkim.
    Idempotent: adds missing locations, terrains, sources, shelters, and observations.
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
            name="India Meteorological Department (IMD) - Official API Catalogue",
            source_type="IMD",
            configuration_reference="https://api.imd.gov.in/api/v1/districtwarning",
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
        current = db.query(DataSource).filter(DataSource.id == s.id).first()
        if not current:
            continue
        if current.source_type == "SYNTH_IOT":
            current.status = "SIMULATED"
            current.last_success_at = None
            continue
        has_real_observation = db.query(Observation.id).filter(
            Observation.source_id == s.id,
            Observation.simulation_flag == False,
            Observation.quality_status.in_(["VALID", "DELAYED", "STALE"])
        ).first() is not None
        cache_prefixes = {
            "src_imd_api": ("imd_", "imd_warnings"),
            "src_cwc_brahmaputra": ("cwc_stations",),
            "src_gsi_landslide": ("gsi_susceptibility",),
            "src_open_meteo": ("open_meteo_",),
        }.get(s.id, ())
        has_live_cache = False
        if cache_prefixes:
            cache_rows = db.query(LiveDataCache.cache_key).filter(LiveDataCache.data_mode == "LIVE").all()
            has_live_cache = any(
                key.startswith(prefix) if prefix.endswith("_") else key == prefix
                for (key,) in cache_rows for prefix in cache_prefixes
            )
        # Older seed revisions marked their synthetic timestamps as successful
        # source fetches. Clear that status unless an actual observation or live
        # source cache proves a real fetch happened.
        if current.status == "OPERATIONAL" and not has_real_observation and not has_live_cache:
            current.status = "NOT_CHECKED"
            current.last_success_at = None

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

    # 4. Terrain Features
    existing_terrains = {t.location_id for t in db.query(TerrainFeature).all()}
    terrains = [
        TerrainFeature(location_id="loc_pandu_ghat", slope_deg=4.5, elevation_m=52.0, geology="Alluvial Sand & Silt", land_cover="Riverbank Wharf", drainage_density=2.8, susceptibility_score=0.20),
        TerrainFeature(location_id="loc_bharalu_basin", slope_deg=6.0, elevation_m=54.5, geology="Recent Alluvium", land_cover="Built-up Urban", drainage_density=3.4, susceptibility_score=0.35),
        TerrainFeature(location_id="loc_kharghuli_hills", slope_deg=36.0, elevation_m=110.0, geology="Precambrian Biotite Gneiss", land_cover="Steep Slope Settlements", drainage_density=1.9, susceptibility_score=0.88),
        TerrainFeature(location_id="loc_kamakhya_nilachal", slope_deg=34.0, elevation_m=175.0, geology="Weathered Granite Gneiss", land_cover="Temple Hill Settlements", drainage_density=2.1, susceptibility_score=0.82),
        TerrainFeature(location_id="loc_narakasur_hills", slope_deg=38.0, elevation_m=140.0, geology="Weathered Gneissic Complex", land_cover="Hill Slum Habitations", drainage_density=2.4, susceptibility_score=0.92),
        TerrainFeature(location_id="loc_cachar_silchar", slope_deg=3.5, elevation_m=28.0, geology="Floodplain Silt", land_cover="Riverbank Settlement", drainage_density=3.1, susceptibility_score=0.25),
        TerrainFeature(location_id="loc_dhemaji_jiadhal", slope_deg=5.0, elevation_m=104.0, geology="Coarse Alluvium / Sand", land_cover="Braided Flash Flood Plain", drainage_density=3.8, susceptibility_score=0.30),
        TerrainFeature(location_id="loc_itanagar_hills", slope_deg=35.0, elevation_m=320.0, geology="Siwalik Sandstone & Shale", land_cover="Urban Road Cuts", drainage_density=2.2, susceptibility_score=0.86),
        TerrainFeature(location_id="loc_pasighat_siang", slope_deg=12.0, elevation_m=155.0, geology="Gravel & Boulders", land_cover="Gorge Entry Riverbank", drainage_density=3.2, susceptibility_score=0.45),
        TerrainFeature(location_id="loc_cherrapunji_sohra", slope_deg=42.0, elevation_m=1430.0, geology="Cretaceous Sandstone Cliffs", land_cover="Highland Plateau Rim", drainage_density=2.5, susceptibility_score=0.89),
        TerrainFeature(location_id="loc_shillong_hills", slope_deg=22.0, elevation_m=1520.0, geology="Shillong Group Quartzite", land_cover="Pine Forest & Urban", drainage_density=2.7, susceptibility_score=0.62),
        TerrainFeature(location_id="loc_imphal_river", slope_deg=2.5, elevation_m=786.0, geology="Lacustrine Clay & Silt", land_cover="Dense Valley City", drainage_density=2.9, susceptibility_score=0.20),
        TerrainFeature(location_id="loc_tupul_slope", slope_deg=39.0, elevation_m=650.0, geology="Disang Shale & Siltstone", land_cover="Excavated Slopes & Debris", drainage_density=2.0, susceptibility_score=0.94),
        TerrainFeature(location_id="loc_aizawl_slopes", slope_deg=37.0, elevation_m=1132.0, geology="Surma Group Siltstone", land_cover="High-Density Hilltop", drainage_density=1.8, susceptibility_score=0.91),
        TerrainFeature(location_id="loc_kohima_slopes", slope_deg=33.0, elevation_m=1444.0, geology="Disang Group Flysch", land_cover="Creeping Valley Slopes", drainage_density=2.3, susceptibility_score=0.87),
        TerrainFeature(location_id="loc_dimapur_dhansiri", slope_deg=3.0, elevation_m=145.0, geology="Alluvium", land_cover="Commercial Plain", drainage_density=3.0, susceptibility_score=0.22),
        TerrainFeature(location_id="loc_agartala_howrah", slope_deg=2.0, elevation_m=15.0, geology="Recent Floodplain Silt", land_cover="Border Riverfront Urban", drainage_density=3.3, susceptibility_score=0.18),
        TerrainFeature(location_id="loc_gangtok_slopes", slope_deg=38.0, elevation_m=1650.0, geology="Daling Series Phyllites & Schist", land_cover="Tiered Hill City", drainage_density=2.1, susceptibility_score=0.90),
        TerrainFeature(location_id="loc_teesta_mangan", slope_deg=36.0, elevation_m=860.0, geology="High Himalayan Gneiss", land_cover="River Gorge & Landslide Scars", drainage_density=3.5, susceptibility_score=0.93)
    ]
    for t in terrains:
        if t.location_id not in existing_terrains:
            db.add(t)

    # 5. Verified Shelters across Northeast States
    existing_shelters = {s.name for s in db.query(Shelter).all()}
    shelters = [
        Shelter(name="Guwahati Commerce College Shelter", location_name="Chandmari, Guwahati (Assam)", latitude=26.1830, longitude=91.7765, capacity=650, current_occupancy=45, accessibility_info="Wheelchair ramp; 2 accessible restrooms; DG power backup", operational_status="OPEN", verified_by="Kamrup Metro DDMA", contact_phone="+91-361-2453890"),
        Shelter(name="Sarusajai Indoor Stadium Hub", location_name="NH 27, Sarusajai, Guwahati (Assam)", latitude=26.1140, longitude=91.7610, capacity=1400, current_occupancy=0, accessibility_info="Full barrier-free access; dedicated medical bay; adjacent helipad", operational_status="OPEN", verified_by="ASDMA Emergency Cell", contact_phone="+91-361-2237011"),
        Shelter(name="Silchar District Library Relief Centre", location_name="Club Road, Silchar (Assam)", latitude=24.8250, longitude=92.8010, capacity=500, current_occupancy=20, accessibility_info="Elevated ground level; drinking water filtration plant", operational_status="OPEN", verified_by="Cachar DDMA", contact_phone="+91-3842-234567"),
        Shelter(name="Itanagar Banquet Hall Relief Camp", location_name="VIP Road, Itanagar (Arunachal Pradesh)", latitude=27.0980, longitude=93.6120, capacity=600, current_occupancy=0, accessibility_info="Ground floor accessible ramp; medical post", operational_status="OPEN", verified_by="Papum Pare DDMA", contact_phone="+91-360-2212345"),
        Shelter(name="State Central Library Emergency Hall", location_name="Secretariat Hills, Shillong (Meghalaya)", latitude=25.5740, longitude=91.8840, capacity=450, current_occupancy=15, accessibility_info="Ramp access; emergency power backup", operational_status="OPEN", verified_by="SDMA Meghalaya", contact_phone="+91-364-2224567"),
        Shelter(name="Khuman Lampak Indoor Stadium", location_name="Imphal East/West (Manipur)", latitude=24.8230, longitude=93.9450, capacity=900, current_occupancy=30, accessibility_info="Wide access gates; first-aid unit staffed 24/7", operational_status="OPEN", verified_by="Manipur Relief Cell", contact_phone="+91-385-2451234"),
        Shelter(name="Aizawl Vanapa Hall Shelter", location_name="Treasury Square, Aizawl (Mizoram)", latitude=23.7290, longitude=92.7190, capacity=400, current_occupancy=10, accessibility_info="Ramp equipped; stable bedrock foundation", operational_status="OPEN", verified_by="Aizawl DDMA", contact_phone="+91-389-2321234"),
        Shelter(name="Kohima Local Ground Community Hall", location_name="Khuochiezie, Kohima (Nagaland)", latitude=25.6700, longitude=94.1050, capacity=500, current_occupancy=0, accessibility_info="Accessible entrance; standby generators", operational_status="OPEN", verified_by="Nagaland NSDMA", contact_phone="+91-370-2291234"),
        Shelter(name="Agartala Town Hall Relief Hub", location_name="Palace Compound, Agartala (Tripura)", latitude=23.8340, longitude=91.2820, capacity=550, current_occupancy=0, accessibility_info="Wheelchair ramp; elevated storm plinth", operational_status="OPEN", verified_by="West Tripura DDMA", contact_phone="+91-381-2325678"),
        Shelter(name="Paljor Stadium Indoor Hall", location_name="Gangtok (Sikkim)", latitude=27.3290, longitude=88.6110, capacity=750, current_occupancy=12, accessibility_info="Barrier-free ground access; emergency blankets & warm shelter", operational_status="OPEN", verified_by="Sikkim SSDMA", contact_phone="+91-3592-202345")
    ]
    for s in shelters:
        if s.name not in existing_shelters:
            db.add(s)

    # 6. Model Versions
    existing_models = {m.id for m in db.query(ModelVersion).all()}
    model_versions = [
        ModelVersion(
            id="cwc-ml-hybrid-v1.2",
            hazard_type="FLOOD",
            version="1.2.0",
            training_data_version="ASSAM_MONSOON_2016_2023_CWC_IMD",
            approval_status="APPROVED",
            evaluation_metrics_json=json.dumps({
                "precision": 0.89,
                "recall": 0.93,
                "f1_score": 0.91,
                "false_alarm_rate": 0.08,
                "missed_event_rate": 0.07,
                "brier_score_calibration": 0.092,
                "lead_time_hours_mean": 5.4,
                "baseline_comparison": "Random Forest + Rule Baseline outperforms pure linear threshold by +14% F1"
            }),
            known_limitations="Requires river gauge at Pandu within 2h. Accuracy degrades during unmetered sudden embankment breaches upstream."
        ),
        ModelVersion(
            id="gsi-ari-hybrid-v2.0",
            hazard_type="LANDSLIDE",
            version="2.0.0",
            training_data_version="GSI_NLSM_HISTORICAL_INVENTORY_2018_2023",
            approval_status="APPROVED",
            evaluation_metrics_json=json.dumps({
                "precision": 0.84,
                "recall": 0.88,
                "f1_score": 0.86,
                "false_alarm_rate": 0.12,
                "missed_event_rate": 0.11,
                "auc_pr": 0.89,
                "lead_time_hours_mean": 14.2,
                "baseline_comparison": "ARI Dynamic Index outperforms static GSI susceptibility map alone by +27% recall"
            }),
            known_limitations="Subsurface soil pore pressure data is synthetic/estimated where borehole piezometers are unavailable. Low score does not guarantee slope safety."
        )
    ]
    for m in model_versions:
        if m.id not in existing_models:
            db.add(m)

    # 8A. Documented historical disaster events (validated map layer + risk history)
    existing_events = {(
        e.location_id, e.hazard_type, e.event_start.date().isoformat()
    ) for e in db.query(DisasterEvent).all()}
    for ev in documented_disaster_events():
        key = (ev["location_id"], ev["hazard_type"], ev["event_start"][:10])
        if key in existing_events:
            continue
        db.add(DisasterEvent(
            hazard_type=ev["hazard_type"],
            location_id=ev["location_id"],
            event_start=_dt(ev["event_start"]),
            severity=ev["severity"],
            verification_status="VERIFIED",
            source_reference=ev["source_reference"],
            description=ev["description"]
        ))

    # 8B. Historical validation cases for the engine validation harness
    seed_historical_validation_cases(db)

    # 7. Synthetic demo observations. These must never be presented as agency telemetry.
    initial_observations = [
        # Brahmaputra at Pandu
        Observation(source_id="src_cwc_brahmaputra", location_id="loc_pandu_ghat", observed_at=now, variable="river_level_m", value=49.10, unit="m", quality_status="VALID", provenance="SYNTHETIC DEMO — not a CWC gauge reading", simulation_flag=True),
        Observation(source_id="src_cwc_brahmaputra", location_id="loc_pandu_ghat", observed_at=now, variable="river_rate_m_hr", value=0.08, unit="m/hr", quality_status="VALID", provenance="SYNTHETIC DEMO — not a CWC rate-of-rise reading", simulation_flag=True),
        # IMD Borjhar Met / Guwahati Slopes
        Observation(source_id="src_imd_api", location_id="loc_kharghuli_hills", observed_at=now, variable="rainfall_24h_mm", value=68.5, unit="mm", quality_status="VALID", provenance="SYNTHETIC DEMO — not an IMD rainfall observation", simulation_flag=True),
        Observation(source_id="src_imd_api", location_id="loc_narakasur_hills", observed_at=now, variable="rainfall_24h_mm", value=74.2, unit="mm", quality_status="VALID", provenance="SYNTHETIC DEMO — not an IMD rainfall observation", simulation_flag=True),
        # Cachar / Barak
        Observation(source_id="src_cwc_brahmaputra", location_id="loc_cachar_silchar", observed_at=now, variable="river_level_m", value=19.45, unit="m", quality_status="VALID", provenance="SYNTHETIC DEMO — not a CWC gauge reading", simulation_flag=True),
        # Sohra / Cherrapunji extreme rain
        Observation(source_id="src_imd_api", location_id="loc_cherrapunji_sohra", observed_at=now, variable="rainfall_24h_mm", value=142.0, unit="mm", quality_status="VALID", provenance="SYNTHETIC DEMO — not an IMD rainfall observation", simulation_flag=True),
        # Teesta / Mangan
        Observation(source_id="src_cwc_brahmaputra", location_id="loc_teesta_mangan", observed_at=now, variable="river_level_m", value=862.4, unit="m", quality_status="VALID", provenance="SYNTHETIC DEMO — not a CWC gauge reading", simulation_flag=True),
        # Aizawl Slopes
        Observation(source_id="src_imd_api", location_id="loc_aizawl_slopes", observed_at=now, variable="rainfall_24h_mm", value=82.0, unit="mm", quality_status="VALID", provenance="SYNTHETIC DEMO — not an IMD rainfall observation", simulation_flag=True)
    ]
    pairs = {(o.location_id, o.variable) for o in db.query(Observation).filter(
        Observation.observed_at >= now - datetime.timedelta(hours=6)
    ).all()}
    for o in initial_observations:
        if (o.location_id, o.variable) not in pairs:
            db.add(o)
        else:
            # Correct legacy copies of these hardcoded demo readings that older
            # versions incorrectly stored as live. Do not touch other readings.
            existing = db.query(Observation).filter(
                Observation.location_id == o.location_id,
                Observation.variable == o.variable,
                Observation.value == o.value,
                Observation.simulation_flag == False,
            ).all()
            for record in existing:
                record.simulation_flag = True
                record.provenance = o.provenance

    db.commit()
