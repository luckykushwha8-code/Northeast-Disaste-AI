THRESHOLD_PROVENANCE = "Engine replay at documented hydrological/hazard thresholds; thresholds per CWC official marks and GSI antecedent rainfall criteria"

HISTORICAL_VALIDATION_CASES = [
    {
        "id": "val_flood_pandu_2022_06",
        "case_type": "POSITIVE_EVENT",
        "hazard_type": "FLOOD",
        "location_id": "loc_pandu_ghat",
        "event_date": "2022-06-19T00:00:00",
        "event_name": "Brahmaputra crossed official danger mark at Pandu, Guwahati (June 2022 flood spell)",
        "documented_inputs_json": "{\"river_level_m\": 49.82, \"river_rate_m_hr\": 0.12, \"rainfall_24h_mm\": 104.5, \"rainfall_age_hours\": 2.0, \"river_level_age_hours\": 1.5}",
        "expected_categories_json": "[\"HIGH\",\"CRITICAL\"]",
        "documented_outcome": "ASDMA/CWC situation reports June 2022: Brahmaputra at Pandu crossed Danger Level 49.68m; low-lying Guwahati wards flooded, SDRF evacuations executed.",
        "source_reference": "ASDMA Daily Flood Situation Reports, June 2022; CWC FFS bulletin 022-MBAPU"
    },
    {
        "id": "val_flood_silchar_2022_06",
        "case_type": "POSITIVE_EVENT",
        "hazard_type": "FLOOD",
        "location_id": "loc_cachar_silchar",
        "event_date": "2022-06-13T00:00:00",
        "event_name": "Barak breached embankment and flooded Silchar city (June 2022)",
        "documented_inputs_json": "{\"river_level_m\": 20.05, \"river_rate_m_hr\": 0.08, \"rainfall_24h_mm\": 72.3, \"rainfall_age_hours\": 3.0, \"river_level_age_hours\": 2.0}",
        "expected_categories_json": "[\"HIGH\",\"CRITICAL\"]",
        "documented_outcome": "Annapurna Ghat stage crossed the town danger level and an embankment breach flooded most of Silchar in June 2022; weeks-long recovery.",
        "source_reference": "CWC Barak bulletin (014-BRSIL); Cachar DDMA June 2022 records"
    },
    {
        "id": "val_flood_pandu_normal_2025_10",
        "case_type": "NEGATIVE_EVENT",
        "hazard_type": "FLOOD",
        "location_id": "loc_pandu_ghat",
        "event_date": "2025-10-15T00:00:00",
        "event_name": "Post-monsoon normal stage at Pandu (no flood event documented during evaluation window)",
        "documented_inputs_json": "{\"river_level_m\": 47.90, \"river_rate_m_hr\": 0.02, \"rainfall_24h_mm\": 4.0, \"rainfall_age_hours\": 2.0, \"river_level_age_hours\": 1.0}",
        "expected_categories_json": "[\"LOW\",\"MODERATE\"]",
        "documented_outcome": "No flood event documented in CWC daily status for the evaluation window; river receded below warning.",
        "source_reference": "CWC FFS daily status (Brahmaputra sites below warning level)"
    },
    {
        "id": "val_flood_pandu_missing_gauge",
        "case_type": "SAFETY_CASE",
        "hazard_type": "FLOOD",
        "location_id": "loc_pandu_ghat",
        "event_date": "2024-08-05T00:00:00",
        "event_name": "Telemetry outage — Rule R-03 must refuse to guess (no false safety)",
        "documented_inputs_json": "{\"river_level_m\": null, \"rainfall_24h_mm\": 60.0, \"rainfall_age_hours\": 1.0}",
        "expected_categories_json": "[\"UNAVAILABLE\"]",
        "documented_outcome": "Engine must mark assessment UNAVAILABLE / MISSING_CRITICAL, never emit a low-risk number without gauge data.",
        "source_reference": "PRD Rule R-03 (missing sensor handling)"
    },
    {
        "id": "val_land_kharghuli_2022_06",
        "case_type": "POSITIVE_EVENT",
        "hazard_type": "LANDSLIDE",
        "location_id": "loc_kharghuli_hills",
        "event_date": "2022-06-19T00:00:00",
        "event_name": "Kharghuli Hills slope failures, Guwahati (June 2022 cloudburst spell)",
        "documented_inputs_json": "{\"rainfall_24h_mm\": 185.0, \"rainfall_3d_mm\": 260.0, \"rainfall_age_hours\": 2.0}",
        "expected_categories_json": "[\"HIGH\",\"CRITICAL\"]",
        "documented_outcome": "Multiple slope failures / debris flows on Kharghuli residential slopes after the June 2022 very heavy rainfall spell (GSI NE region records).",
        "source_reference": "GSI NE landslide advisory June 2022; Kamrup Metro DDMA reports"
    },
    {
        "id": "val_land_narakasur_2022_06",
        "case_type": "POSITIVE_EVENT",
        "hazard_type": "LANDSLIDE",
        "location_id": "loc_narakasur_hills",
        "event_date": "2022-06-19T00:00:00",
        "event_name": "Narakasur / GMCH slope collapse, Guwahati (June 2022)",
        "documented_inputs_json": "{\"rainfall_24h_mm\": 178.5, \"rainfall_3d_mm\": 245.0, \"rainfall_age_hours\": 2.0}",
        "expected_categories_json": "[\"HIGH\",\"CRITICAL\"]",
        "documented_outcome": "Cut-slope failure on Narakasur hill segment during the June 2022 spell; road blockage and house damage documented.",
        "source_reference": "Kamrup Metro DDMA June 2022; Guwahati Municipal Corporation records"
    },
    {
        "id": "val_land_tupul_2022_07",
        "case_type": "POSITIVE_EVENT",
        "hazard_type": "LANDSLIDE",
        "location_id": "loc_tupul_slope",
        "event_date": "2022-07-01T00:00:00",
        "event_name": "Tupul railway construction site landslide, Noney, Manipur (1 July 2022)",
        "documented_inputs_json": "{\"rainfall_24h_mm\": 118.0, \"rainfall_3d_mm\": 190.0, \"rainfall_age_hours\": 2.0}",
        "expected_categories_json": "[\"HIGH\",\"CRITICAL\"]",
        "documented_outcome": "Large excavated-slope failure at the Tupul railway site on 1 July 2022 with mass casualties after days of intense monsoon rain.",
        "source_reference": "Manipur SDMA; National Highway & Infrastructure disaster records July 2022"
    },
    {
        "id": "val_land_aizawl_2023_06",
        "case_type": "POSITIVE_EVENT",
        "hazard_type": "LANDSLIDE",
        "location_id": "loc_aizawl_slopes",
        "event_date": "2023-06-26T00:00:00",
        "event_name": "Aizawl urban slope collapse, Mizoram (late June 2023 extreme rain)",
        "documented_inputs_json": "{\"rainfall_24h_mm\": 168.0, \"rainfall_3d_mm\": 320.0, \"rainfall_age_hours\": 2.0}",
        "expected_categories_json": "[\"HIGH\",\"CRITICAL\"]",
        "documented_outcome": "Several destructive landslides across Aizawl after extreme Cloudburst-scale rainfall in late June 2023; casualties and house losses documented.",
        "source_reference": "Mizoram SDMA June 2023; IMD Aizawl daily rainfall records"
    },
    {
        "id": "val_land_shillong_normal",
        "case_type": "NEGATIVE_EVENT",
        "hazard_type": "LANDSLIDE",
        "location_id": "loc_shillong_hills",
        "event_date": "2025-10-10T00:00:00",
        "event_name": "Shillong dry spell baseline (no landslide during evaluation window)",
        "documented_inputs_json": "{\"rainfall_24h_mm\": 12.0, \"rainfall_3d_mm\": 25.0, \"rainfall_age_hours\": 3.0}",
        "expected_categories_json": "[\"LOW\"]",
        "documented_outcome": "No landslide event documented during the dry post-monsoon window; engine must not trigger false alarms.",
        "source_reference": "Meghalaya SDMA; IMD Shillong station records"
    }
]


def documented_disaster_events():
    return [
        {"hazard_type": "FLOOD", "location_id": "loc_pandu_ghat", "event_start": "2022-06-19", "severity": "CRITICAL",
         "source_reference": "ASDMA situation reports / CWC FFS, June 2022", "description": "Brahmaputra at Pandu crossed the 49.68m danger mark; widespread Guwahati ignition flooding and SDRF evacuations."},
        {"hazard_type": "FLOOD", "location_id": "loc_cachar_silchar", "event_start": "2022-06-13", "severity": "HIGH",
         "source_reference": "CWC Barak bulletin / Cachar DDMA, June 2022", "description": "Barak at Annapurna Ghat breached the town protection embankment; Silchar city flooded."},
        {"hazard_type": "FLOOD", "location_id": "loc_dhemaji_jiadhal", "event_start": "2023-07-08", "severity": "HIGH",
         "source_reference": "ASDMA monsoon 2023 records", "description": "Jiadhal flash flood; sand casting across Dhemaji riverside neighborhoods."},
        {"hazard_type": "FLOOD", "location_id": "loc_imphal_river", "event_start": "2015-07-28", "severity": "HIGH",
         "source_reference": "Manipur relief records; NDMA archive", "description": "Imphal river spillover submerged Sanjenthong and lowland wards during the July 2015 spell."},
        {"hazard_type": "FLOOD", "location_id": "loc_pasighat_siang", "event_start": "2020-07-12", "severity": "HIGH",
         "source_reference": "East Siang district administration records", "description": "Siang surge flooded riverside quarters at Pasighat gorge entry."},
        {"hazard_type": "LANDSLIDE", "location_id": "loc_kharghuli_hills", "event_start": "2022-06-19", "severity": "CRITICAL",
         "source_reference": "GSI NE landslide advisory / Kamrup Metro DDMA, June 2022", "description": "Multiple slope failures on Kharghuli residential slopes after very heavy rainfall."},
        {"hazard_type": "LANDSLIDE", "location_id": "loc_narakasur_hills", "event_start": "2022-06-19", "severity": "HIGH",
         "source_reference": "Kamrup Metro DDMA June 2022", "description": "Narakasur cut-slope collapse; roadway blocked, homes damaged."},
        {"hazard_type": "LANDSLIDE", "location_id": "loc_tupul_slope", "event_start": "2022-07-01", "severity": "CRITICAL",
         "source_reference": "Manipur SDMA July 2022", "description": "Tupul railway site landslide with mass casualties on 1 July 2022."},
        {"hazard_type": "LANDSLIDE", "location_id": "loc_aizawl_slopes", "event_start": "2023-06-26", "severity": "CRITICAL",
         "source_reference": "Mizoram SDMA June 2023", "description": "Destructive Aizawl slope collapses after extreme rainfall spell."},
        {"hazard_type": "LANDSLIDE", "location_id": "loc_kohima_slopes", "event_start": "2022-07-05", "severity": "HIGH",
         "source_reference": "Nagaland NSDMA 2022 records", "description": "Kohima roadside cut-slope landslides blocked NH-2 during heavy spells."},
        {"hazard_type": "LANDSLIDE", "location_id": "loc_gangtok_slopes", "event_start": "2020-07-15", "severity": "HIGH",
         "source_reference": "Sikkim SSDMA records", "description": "Gangtok-Deorali slope failures amid prolonged monsoon saturation."},
        {"hazard_type": "LANDSLIDE", "location_id": "loc_itanagar_hills", "event_start": "2021-06-30", "severity": "HIGH",
         "source_reference": "Papum Pare administration records", "description": "Itanagar capital road-cut failures during monsoon spells of 2021."}
    ]
