"""Curated point locations for weather requests; each point is not statewide."""

from typing import Any, Dict, List


# Coordinates point to town/official station locations and retain a reference per row.
# OpenWeather's coordinate API samples a point; it does not summarize the state.
WEATHER_LOCATIONS: List[Dict[str, Any]] = [
    {
        "id": "wx_guwahati", "city": "Guwahati", "name": "Guwahati town point", "state": "Assam",
        "district": "Kamrup Metropolitan", "latitude": 26.1806, "longitude": 91.7539,
        "location_type": "CITY_POINT", "coordinate_source": "OpenStreetMap-based Guwahati city gazetteer",
        "coordinate_reference_url": "https://mapcarta.com/Guwahati",
    },
    {
        "id": "wx_dibrugarh", "city": "Dibrugarh", "name": "Dibrugarh town point",
        "state": "Assam", "district": "Dibrugarh", "latitude": 27.479888, "longitude": 94.908370,
        "location_type": "CITY_POINT", "coordinate_source": "GeoNames populated-place record",
        "coordinate_reference_url": "https://www.geonames.org/search.html?country=IN&q=Dibrugarh",
    },
    {
        "id": "wx_silchar", "city": "Silchar", "name": "Silchar IMD location point", "state": "Assam",
        "district": "Cachar", "latitude": 24.7500, "longitude": 92.8000,
        "location_type": "CITY_POINT", "coordinate_source": "India Meteorological Department station location",
        "coordinate_reference_url": "https://packolkata.imd.gov.in/download/smrs/Silchar.pdf",
    },
    {
        "id": "wx_shillong", "city": "Shillong", "name": "Shillong IMD location point", "state": "Meghalaya",
        "district": "East Khasi Hills", "latitude": 25.5700, "longitude": 91.8800,
        "location_type": "CITY_POINT", "coordinate_source": "India Meteorological Department station location",
        "coordinate_reference_url": "https://packolkata.imd.gov.in/download/smrs/Shillong.pdf",
    },
    {
        "id": "wx_sohra", "city": "Cherrapunji (Sohra)", "name": "Sohra town point", "state": "Meghalaya",
        "district": "East Khasi Hills", "latitude": 25.284083, "longitude": 91.719500,
        "location_type": "CITY_POINT", "coordinate_source": "Central Ground Water Board site coordinates",
        "coordinate_reference_url": "https://www.cgwb.gov.in/old_website/AQM/NAQUIM_REPORT/Meghalaya/East%20Khasi%20hills_report.pdf",
    },
    {
        "id": "wx_gangtok", "city": "Gangtok", "name": "Gangtok IMD location point", "state": "Sikkim",
        "district": "Gangtok", "latitude": 27.3300, "longitude": 88.6200,
        "location_type": "CITY_POINT", "coordinate_source": "India Meteorological Department station location",
        "coordinate_reference_url": "https://packolkata.imd.gov.in/download/smrs/Gangtok.pdf",
    },
    {
        "id": "wx_itanagar", "city": "Itanagar", "name": "Itanagar IMD location point", "state": "Arunachal Pradesh",
        "district": "Papum Pare", "latitude": 27.1000, "longitude": 93.6200,
        "location_type": "CITY_POINT", "coordinate_source": "India Meteorological Department station location",
        "coordinate_reference_url": "https://www.packolkata.gov.in/download/smrs/Itanagar.pdf",
    },
    {
        "id": "wx_pasighat", "city": "Pasighat", "name": "Pasighat town point", "state": "Arunachal Pradesh",
        "district": "East Siang", "latitude": 28.066310, "longitude": 95.326783,
        "location_type": "CITY_POINT", "coordinate_source": "GeoNames populated-place record",
        "coordinate_reference_url": "https://www.geonames.org/search.html?country=IN&q=Pasighat",
    },
    {
        "id": "wx_kohima", "city": "Kohima", "name": "Kohima government reference point", "state": "Nagaland",
        "district": "Kohima", "latitude": 25.667000, "longitude": 94.117000,
        "location_type": "CITY_POINT", "coordinate_source": "Government of India Kohima district report",
        "coordinate_reference_url": "https://dcmsme.gov.in/dips/dipr-kohima-final.pdf",
    },
    {
        "id": "wx_dimapur", "city": "Dimapur", "name": "Dimapur town point", "state": "Nagaland",
        "district": "Dimapur", "latitude": 25.911744, "longitude": 93.721703,
        "location_type": "CITY_POINT", "coordinate_source": "GeoNames populated-place record",
        "coordinate_reference_url": "https://www.geonames.org/9747972/dimapur.html",
    },
    {
        "id": "wx_imphal", "city": "Imphal", "name": "Imphal town point", "state": "Manipur",
        "district": "Imphal West", "latitude": 24.808053, "longitude": 93.944203,
        "location_type": "CITY_POINT", "coordinate_source": "GeoNames populated-place record",
        "coordinate_reference_url": "https://www.geonames.org/1269771/imphal.html",
    },
    {
        "id": "wx_aizawl", "city": "Aizawl", "name": "Aizawl district reference point", "state": "Mizoram",
        "district": "Aizawl", "latitude": 23.730000, "longitude": 92.720000,
        "location_type": "CITY_POINT", "coordinate_source": "Aizawl district administration geography",
        "coordinate_reference_url": "https://aizawl.nic.in/about-district/geography/",
    },
    {
        "id": "wx_agartala", "city": "Agartala", "name": "Agartala IMD location point", "state": "Tripura",
        "district": "West Tripura", "latitude": 23.880000, "longitude": 91.250000,
        "location_type": "CITY_POINT", "coordinate_source": "India Meteorological Department station location",
        "coordinate_reference_url": "https://packolkata.imd.gov.in/download/smrs/Agartala.pdf",
    },
]

WEATHER_LOCATION_BY_ID = {item["id"]: item for item in WEATHER_LOCATIONS}


def list_weather_locations() -> List[Dict[str, Any]]:
    """Return fresh dicts so API serialization cannot mutate the registry."""
    return [dict(item) for item in WEATHER_LOCATIONS]


def get_weather_location(location_id: str):
    item = WEATHER_LOCATION_BY_ID.get(location_id)
    return dict(item) if item else None
