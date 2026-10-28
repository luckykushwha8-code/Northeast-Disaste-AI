import datetime
from types import SimpleNamespace
from unittest import mock

import httpx
import pytest
from sqlalchemy.exc import SQLAlchemyError
from fastapi.testclient import TestClient

from app.config import settings
from app.data.weather_locations import list_weather_locations
from app.services.openweather_service import OpenWeatherService
from app.database import get_db
from app.main import app


POINT = SimpleNamespace(
    id="wx_test", name="Test town point", city="Test town", state="Assam", district="Test district",
    latitude=26.2, longitude=91.7,
)


def _response(payload, status=200):
    response = mock.Mock()
    response.status_code = status
    response.json.return_value = payload
    response.raise_for_status.side_effect = (
        httpx.HTTPStatusError("provider error", request=mock.Mock(), response=response) if status >= 400 else None
    )
    return response


@pytest.fixture(autouse=True)
def configured_key(monkeypatch):
    monkeypatch.setattr(settings, "OPENWEATHER_API_KEY", "test-key-never-returned")


def test_current_weather_parses_units_timestamp_and_optional_rainfall(monkeypatch):
    now = datetime.datetime.now(datetime.timezone.utc)
    observed_epoch = int(now.timestamp())
    payload = {
        "dt": observed_epoch, "main": {"temp": 22.4, "feels_like": 23, "humidity": 80, "pressure": 1004},
        "wind": {"speed": 2.5, "deg": 130, "gust": 4.1}, "clouds": {"all": 72},
        "weather": [{"main": "Rain", "description": "light rain", "icon": "10d"}],
        "rain": {"1h": 1.2},
    }
    calls = []
    monkeypatch.setattr("app.services.openweather_service.httpx.get", lambda url, **kwargs: calls.append((url, kwargs)) or _response(payload))
    service = OpenWeatherService()

    result = service.fetch_current_weather(POINT)

    assert result["data_mode"] == "LIVE"
    assert result["current"]["temperature_2m"] == 22.4
    assert result["current"]["rainfall"] == {"1h": 1.2}
    assert result["current"]["wind_direction_deg"] == 130
    assert result["observed_at"].endswith("Z")
    assert result["retrieved_at"].endswith("Z")
    assert result["latitude"] == POINT.latitude and result["longitude"] == POINT.longitude
    assert "appid" in calls[0][1]["params"]
    assert "test-key-never-returned" not in repr(result)


def test_missing_key_is_unavailable_without_provider_request(monkeypatch):
    monkeypatch.setattr(settings, "OPENWEATHER_API_KEY", None)
    request = mock.Mock(side_effect=AssertionError("provider must not be called"))
    monkeypatch.setattr("app.services.openweather_service.httpx.get", request)

    result = OpenWeatherService().fetch_current_weather(POINT)

    assert result["data_mode"] == "UNAVAILABLE"
    assert result["availability_status"] == "AUTH_REQUIRED"
    assert result["current"] is None
    request.assert_not_called()


def test_unauthorized_key_is_not_exposed(monkeypatch):
    monkeypatch.setattr("app.services.openweather_service.httpx.get", lambda *a, **k: _response({}, status=401))
    service = OpenWeatherService()

    result = service.fetch_current_weather(POINT)

    assert result["data_mode"] == "UNAVAILABLE"
    assert result["availability_status"] == "AUTH_ERROR"
    assert result["error_code"] == "HTTP_401"
    assert "test-key-never-returned" not in repr(result)


def test_timeout_is_unavailable_and_never_contains_invented_values(monkeypatch):
    monkeypatch.setattr(
        "app.services.openweather_service.httpx.get",
        mock.Mock(side_effect=httpx.ReadTimeout("simulated timeout")),
    )

    result = OpenWeatherService().fetch_current_weather(POINT)

    assert result["data_mode"] == "UNAVAILABLE"
    assert result["error_code"] == "TIMEOUT"
    assert result["current"] is None


def test_current_request_uses_short_cache(monkeypatch):
    now = int(datetime.datetime.now(datetime.timezone.utc).timestamp())
    response = _response({"dt": now, "main": {"temp": 21.0}, "weather": []})
    request = mock.Mock(return_value=response)
    monkeypatch.setattr("app.services.openweather_service.httpx.get", request)
    service = OpenWeatherService()

    first = service.fetch_current_weather(POINT)
    second = service.fetch_current_weather(POINT)

    assert first["cache_hit"] is False
    assert second["cache_hit"] is True
    assert second["data_mode"] == "LIVE"
    request.assert_called_once()


def test_forecast_is_timestamped_and_never_labeled_observed(monkeypatch):
    now = int(datetime.datetime.now(datetime.timezone.utc).timestamp())
    payload = {"list": [{
        "dt": now + 10800, "main": {"temp": 19.5, "feels_like": 19}, "pop": 0.6,
        "rain": {"3h": 2.4}, "weather": [{"main": "Rain", "description": "moderate rain"}],
        "clouds": {"all": 95},
    }]}
    monkeypatch.setattr("app.services.openweather_service.httpx.get", lambda *a, **k: _response(payload))

    result = OpenWeatherService().fetch_forecast(POINT)

    assert result["forecast_kind"] == "PROVIDER_FORECAST_NOT_OBSERVATION"
    assert result["forecast"][0]["forecast_at"].endswith("Z")
    assert result["forecast"][0]["rainfall_3h_mm"] == 2.4
    assert result["forecast"][0]["precipitation_probability"] == 0.6
    assert result["data_mode"] == "LIVE"


def test_curated_weather_locations_cover_all_northeast_states():
    locations = list_weather_locations()
    assert {item["state"] for item in locations} == {
        "Assam", "Meghalaya", "Sikkim", "Arunachal Pradesh", "Nagaland", "Manipur", "Mizoram", "Tripura"
    }
    assert all(21 <= item["latitude"] <= 30 and 88 <= item["longitude"] <= 98 for item in locations)
    assert all(item["coordinate_source"] and item["coordinate_reference_url"].startswith("https://") for item in locations)


def test_weather_registry_and_health_are_exposed_without_claiming_unverified_provider(monkeypatch):
    monkeypatch.setattr(settings, "AUTO_SYNC_ENABLED", False)
    monkeypatch.setattr(settings, "OPENWEATHER_API_KEY", "test-key-never-returned")
    service = OpenWeatherService()
    monkeypatch.setattr("app.api.v1.routes.openweather_service.status", service.status)
    queried_points = []

    def current(point):
        queried_points.append((point.city, point.latitude, point.longitude))
        return {
            "location_id": point.id, "location_name": point.name, "city": point.city, "state": point.state,
            "latitude": point.latitude, "longitude": point.longitude, "source": "OpenWeather Current Weather API",
            "current": {"temperature_2m": 23.0}, "current_units": {"temperature_2m": "°C"},
            "retrieved_at": "2026-10-28T00:00:00Z", "observed_at": "2026-10-28T00:00:00Z",
            "data_mode": "LIVE", "availability_status": "OPERATIONAL", "cache_hit": False,
            "provenance_policy": "point data",
        }

    def forecast(point):
        return {
            "location_id": point.id, "location_name": point.name, "city": point.city, "state": point.state,
            "latitude": point.latitude, "longitude": point.longitude, "source": "OpenWeather Forecast API",
            "forecast_kind": "PROVIDER_FORECAST_NOT_OBSERVATION", "forecast": [],
            "retrieved_at": "2026-10-28T00:00:00Z", "data_mode": "LIVE",
            "availability_status": "OPERATIONAL", "cache_hit": False,
        }

    monkeypatch.setattr("app.api.v1.routes.openweather_service.fetch_current_weather", current)
    monkeypatch.setattr("app.api.v1.routes.openweather_service.fetch_forecast", forecast)
    with TestClient(app) as client:
        registry = client.get("/api/v1/weather/locations")
        health = client.get("/api/v1/health")
        current_response = client.get("/api/v1/weather/current", params={"location_id": "wx_dibrugarh"})
        forecast_response = client.get("/api/v1/weather/forecast", params={"location_id": "wx_dibrugarh", "provider": "openweather"})
        unknown_location = client.get("/api/v1/weather/current", params={"location_id": "not-approved"})
        forecast_without_location = client.get("/api/v1/weather/forecast", params={"provider": "openweather"})

    assert registry.status_code == 200
    assert registry.json()["state_count"] == 8
    assert len(registry.json()["locations"]) == 13
    assert health.status_code == 200
    assert health.json()["weather_integration"]["configured"] is True
    assert health.json()["weather_integration"]["connectivity_verified"] is False
    assert health.json()["weather_integration"]["status"] == "NOT_CHECKED"
    assert current_response.status_code == 200
    assert current_response.json()["city"] == "Dibrugarh"
    assert current_response.json()["latitude"] == 27.479888
    assert forecast_response.status_code == 200
    assert forecast_response.json()["forecast_kind"] == "PROVIDER_FORECAST_NOT_OBSERVATION"
    assert unknown_location.status_code == 404
    assert forecast_without_location.status_code == 422
    assert queried_points == [("Dibrugarh", 27.479888, 94.90837)]


def test_readiness_checks_database_connection(monkeypatch):
    monkeypatch.setattr(settings, "AUTO_SYNC_ENABLED", False)
    database = SimpleNamespace(execute=mock.Mock())

    def override_db():
        yield database

    monkeypatch.setitem(app.dependency_overrides, get_db, override_db)
    with TestClient(app) as client:
        response = client.get("/api/v1/health/ready")

    assert response.status_code == 200
    assert response.json()["status"] == "READY"
    assert response.json()["database_connected"] is True
    database.execute.assert_called_once()


def test_readiness_returns_503_when_database_is_unavailable(monkeypatch):
    monkeypatch.setattr(settings, "AUTO_SYNC_ENABLED", False)
    database = SimpleNamespace(execute=mock.Mock(side_effect=SQLAlchemyError("database unavailable")))

    def override_db():
        yield database

    monkeypatch.setitem(app.dependency_overrides, get_db, override_db)
    with TestClient(app) as client:
        response = client.get("/api/v1/health/ready")

    assert response.status_code == 503
    assert response.json()["detail"]["status"] == "NOT_READY"
    assert response.json()["detail"]["database_connected"] is False


def test_current_weather_accepts_bounded_ne_coordinates(monkeypatch):
    monkeypatch.setattr(settings, "AUTO_SYNC_ENABLED", False)
    requested = []

    def current(point):
        requested.append(point)
        return {
            "location_id": point.id, "location_name": point.name,
            "latitude": point.latitude, "longitude": point.longitude,
            "state": point.state, "district": point.district,
            "current": {"temperature_2m": 24.0}, "current_units": {"temperature_2m": "°C"},
            "source": "OpenWeather Current Weather API", "observed_at": "2026-10-28T06:00:00Z",
            "retrieved_at": "2026-10-28T06:01:00Z", "data_mode": "LIVE",
            "availability_status": "OPERATIONAL", "cache_hit": False,
        }

    monkeypatch.setattr("app.api.v1.routes.openweather_service.fetch_current_weather", current)
    monkeypatch.setattr(
        "app.api.v1.routes.open_meteo_service.fetch_current_weather",
        lambda *args, **kwargs: (_ for _ in ()).throw(AssertionError("live primary must not invoke fallback")),
    )
    with TestClient(app) as client:
        response = client.get("/api/v1/weather/current", params={"lat": 26.1445, "lon": 91.7362})
        out_of_region = client.get("/api/v1/weather/current", params={"lat": 40.0, "lon": -74.0})

    assert response.status_code == 200
    assert response.json()["data_mode"] == "LIVE"
    assert response.json()["latitude"] == 26.1445
    assert response.json()["longitude"] == 91.7362
    assert response.json()["state"] is None and response.json()["district"] is None
    assert out_of_region.status_code == 422
    assert len(requested) == 1
    assert requested[0].city is None
