import pytest
import datetime
from unittest import mock

import httpx

from app.services import open_meteo_service as oms
from app.models.entities import LiveDataCache


def _om_payload():
    """Open-Meteo-shaped payload: 72h past + 96h forecast hourly precipitation."""
    now = datetime.datetime(2026, 10, 22, 12, 0, 0)
    times = []
    values = []
    for h in range(-72, 97):
        t = now + datetime.timedelta(hours=h)
        times.append(t.strftime("%Y-%m-%dT%H:00"))
        if h < 0:
            values.append(2.0)
        elif h < 24:
            values.append(5.0)
        else:
            values.append(0.0)
    return {"hourly": {"time": times, "precipitation": values}, "elevation": 55.0}


@pytest.fixture(autouse=True)
def freeze_clock(monkeypatch):
    pinned = datetime.datetime(2026, 10, 22, 12, 0, 0)
    monkeypatch.setattr(oms, "_now", lambda: pinned)


@pytest.fixture
def db_session():
    from app.database import SessionLocal, Base, engine
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    db.query(LiveDataCache).filter(LiveDataCache.cache_key.contains("open_meteo")).delete()
    db.commit()
    yield db
    db.close()


def _fake_client(payload, status=200):
    def _client(*args, **kwargs):
        resp = mock.Mock()
        resp.status_code = status
        resp.json.return_value = payload
        resp.raise_for_status.side_effect = lambda: (
            (_ for _ in ()).throw(httpx.HTTPStatusError("boom", request=mock.Mock(), response=resp))
            if status >= 400 else None
        )
        return mock.MagicMock() if False else _Ctx(resp)
    class _Ctx:
        def __init__(self, resp): self.resp = resp
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def get(self, *a, **k): return self.resp
    return _client


def test_live_parse_and_ari_sums(db_session):
    oms.open_meteo_service.fetch_forecast.__wrapped__ if False else None
    with mock.patch.object(oms.httpx, "Client", _fake_client(_om_payload())):
        ctx = oms.open_meteo_service.fetch_forecast(
            db_session, "loc_test_a", 26.14, 91.73
        )
    assert ctx["data_mode"] == "LIVE"
    # cutoff = "now" (12:00); h in [-23,-1] -> 23 x 2.0 = 46, h=0 (12:00) counts as past -> 5.0
    assert ctx["observed_precipitation_24h_mm"] == pytest.approx(51.0)
    assert ctx["observed_precipitation_72h_mm"] == pytest.approx(147.0)
    assert ctx["forecast_precipitation_24h_mm"] == pytest.approx(115.0)
    assert ctx["forecast_precipitation_72h_mm"] == pytest.approx(115.0)
    assert ctx["last_observed_age_hours"] == pytest.approx(0.0)


def test_cache_hit_within_ttl(db_session):
    with mock.patch.object(oms.httpx, "Client", _fake_client(_om_payload())):
        first = oms.open_meteo_service.fetch_forecast(db_session, "loc_test_b", 26.1, 91.7)
        second = oms.open_meteo_service.fetch_forecast(db_session, "loc_test_b", 26.1, 91.7)
    assert first["cache_hit"] is False
    assert second["cache_hit"] is True
    assert second["data_mode"] == "LIVE"


def test_failure_falls_back_to_cached_not_fake(db_session, monkeypatch):
    with mock.patch.object(oms.httpx, "Client", _fake_client(_om_payload())):
        oms.open_meteo_service.fetch_forecast(db_session, "loc_test_c", 26.1, 91.7)
    # Stale the cache past TTL before the network failure so the fallback path runs
    monkeypatch.setattr(
        oms, "_now",
        lambda: datetime.datetime(2026, 10, 22, 13, 1, 0)
    )
    with mock.patch.object(oms.httpx, "Client", _fake_client({}, status=500)):
        out = oms.open_meteo_service.fetch_forecast(db_session, "loc_test_c", 26.1, 91.7)
    assert out["data_mode"] == "CACHED"
    assert out["cached_at"] is not None
    assert (out.get("observed_precipitation_24h_mm")) is not None


def test_no_cache_no_network_means_unavailable(db_session):
    with mock.patch.object(oms.httpx, "Client", _fake_client({}, status=500)):
        out = oms.open_meteo_service.fetch_forecast(db_session, "loc_test_d", 26.1, 91.7)
    assert out["data_mode"] == "UNAVAILABLE"
    assert out["observed_precipitation_24h_mm"] is None
    assert out["forecast_precipitation_24h_mm"] is None


def test_malformed_payload_is_unavailable(db_session):
    with mock.patch.object(oms.httpx, "Client", _fake_client({"hourly": {"time": [], "precipitation": []}})):
        out = oms.open_meteo_service.fetch_forecast(db_session, "loc_test_e", 26.1, 91.7)
    assert out["data_mode"] == "UNAVAILABLE"
