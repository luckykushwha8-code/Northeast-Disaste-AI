import { useCallback, useEffect, useRef, useState } from 'react';
import { CloudRain, RefreshCw } from 'lucide-react';
import { api, type CurrentWeatherItem, type WeatherForecastResponse } from '../api/client';
import { useVisibleRefresh } from '../hooks/useVisibleRefresh';

export function LiveWeatherCard({ location, locationId }: { location: string; locationId: string }) {
  const [weather, setWeather] = useState<CurrentWeatherItem | null>(null);
  const [forecast, setForecast] = useState<WeatherForecastResponse | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [forecastError, setForecastError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const requestVersion = useRef(0);

  const refresh = useCallback(async () => {
    const version = ++requestVersion.current;
    setLoading(true);
    try {
      const result = await api.getCurrentWeather(locationId);
      if (version !== requestVersion.current) return;
      setWeather(result);
      setUpdatedAt(new Date().toISOString());
      setError(result.current ? null : result.live_error || 'No current weather is available for this point.');
      if (result.source.toLowerCase().includes('openweather')) {
        try {
          const nextForecast = await api.getWeatherForecast(locationId);
          if (version !== requestVersion.current) return;
          setForecast(nextForecast);
          setForecastError(nextForecast.forecast.length ? null : nextForecast.live_error || 'Forecast is unavailable for this location.');
        } catch (reason) {
          if (version !== requestVersion.current) return;
          setForecast(null);
          setForecastError(reason instanceof Error ? reason.message : 'Forecast is unavailable.');
        }
      } else {
        setForecast(null);
        setForecastError(result.current ? 'OpenWeather forecast has not been verified for this point; this reading is from a fallback provider.' : null);
      }
    } catch (reason) {
      if (version !== requestVersion.current) return;
      const message = reason instanceof Error ? reason.message : 'Weather is unavailable.';
      setError(message);
      setForecast(null);
      setForecastError(null);
      setWeather(current => {
        if (!current?.current || !current.retrieved_at) return null;
        const age = Math.max(0, Math.floor((Date.now() - Date.parse(current.retrieved_at)) / 1000));
        if (!Number.isFinite(age) || age > 3 * 60 * 60) return { ...current, current: null, data_mode: 'UNAVAILABLE', cache_hit: false, live_error: message };
        return { ...current, data_mode: 'CACHED', cache_hit: true, cache_age_seconds: age, live_error: message };
      });
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }, [locationId]);

  useEffect(() => {
    void refresh();
    return () => { requestVersion.current += 1; };
  }, [refresh, retry]);
  useVisibleRefresh(refresh, 5 * 60_000);

  const current = weather?.current;
  const isLive = !!current && weather?.data_mode === 'LIVE';
  const isCached = !!current && weather?.data_mode === 'CACHED';
  const isStale = !!current && weather?.data_mode === 'STALE';
  const stateLabel = loading && !current ? 'Loading' : isLive ? (weather?.cache_hit ? 'Live · cached briefly' : 'Live') : isCached ? 'Cached' : isStale ? 'Stale' : 'Unavailable';
  const rainfall = current?.rainfall ?? {};

  return (
    <section className="rounded-xl border border-sky-200 bg-sky-50/70 p-4" aria-label={`Weather for ${location}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="rounded-lg bg-white p-2 text-sky-700"><CloudRain className="h-4 w-4" /></span>
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Weather · {weather?.city || location}</h3>
            <p className="text-[11px] text-slate-500">{weather?.state || 'Point location'} · {weather?.source || 'Weather feed'}</p>
            {weather?.latitude != null && weather?.longitude != null && <p className="text-[10px] text-slate-400">{weather.latitude.toFixed(4)}, {weather.longitude.toFixed(4)} · point data, not a state summary</p>}
          </div>
        </div>
        <span className={`inline-flex items-center gap-1.5 rounded-full bg-white px-2 py-1 text-[10px] font-semibold ${isLive ? 'text-emerald-700' : isCached || isStale ? 'text-amber-800' : 'text-slate-600'}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${isLive ? 'bg-emerald-500' : isCached || isStale ? 'bg-amber-500' : 'bg-slate-400'}`} /> {stateLabel}
        </span>
      </div>

      {current ? <div>
        {(current.weather_condition || current.weather_description) && <p className="mt-3 text-sm font-semibold capitalize text-slate-800">{current.weather_condition || current.weather_description}</p>}
        {current.weather_condition && current.weather_description && <p className="text-xs capitalize text-slate-600">{current.weather_description}</p>}
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
          <WeatherValue label="Temperature" value={format(current.temperature_2m, weather?.current_units?.temperature_2m || '°C')} />
          <WeatherValue label="Feels like" value={format(current.feels_like, weather?.current_units?.feels_like || '°C')} />
          <WeatherValue label="Wind" value={format(current.wind_speed_10m, weather?.current_units?.wind_speed_10m || 'm/s')} />
          <WeatherValue label="Humidity" value={format(current.relative_humidity_2m, weather?.current_units?.relative_humidity_2m || '%')} />
          <WeatherValue label="Pressure" value={format(current.surface_pressure, weather?.current_units?.surface_pressure || 'hPa')} />
          <WeatherValue label="Cloud cover" value={format(current.cloud_cover_percent, weather?.current_units?.cloud_cover_percent || '%')} />
          <WeatherValue label="Wind direction" value={current.wind_direction_deg == null ? '—' : `${current.wind_direction_deg}°`} />
          {current.precipitation != null && <WeatherValue label="Precipitation · provider" value={format(current.precipitation, weather?.current_units?.precipitation || 'mm')} />}
          <WeatherValue label="Rain · 1 hour" value={rainfall['1h'] == null ? 'Not reported' : `${format(rainfall['1h'], 'mm')} / 1h`} />
          <WeatherValue label="Rain · 3 hours" value={rainfall['3h'] == null ? 'Not reported' : `${format(rainfall['3h'], 'mm')} / 3h`} />
        </div>
      </div> : <div className="mt-4 flex items-center justify-between gap-3 rounded-lg bg-white px-3 py-3 text-xs text-slate-600" role="status">
        <span>{loading ? 'Loading current conditions…' : error || weather?.live_error || 'Current conditions are unavailable.'}</span>
        {!loading && <button onClick={() => setRetry(value => value + 1)} className="inline-flex shrink-0 items-center gap-1 rounded-md border border-slate-200 px-2 py-1 font-semibold text-slate-700 hover:border-sky-400" aria-label="Retry weather request"><RefreshCw className="h-3 w-3" /> Retry</button>}
      </div>}

      {forecast && forecast.forecast.length > 0 && <div className="mt-3 border-t border-sky-100 pt-3">
        <div className="flex flex-wrap items-center justify-between gap-1"><h4 className="text-xs font-semibold text-slate-800">5-day forecast · 3-hour steps</h4><span className="text-[10px] text-slate-500">Forecast, not observed weather · {forecast.data_mode}</span></div>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {forecast.forecast.slice(0, 6).map(item => <div key={item.forecast_at} className="rounded-lg bg-white px-2.5 py-2">
            <p className="text-[10px] font-medium text-slate-500">{new Date(item.forecast_at).toLocaleString([], { weekday: 'short', hour: 'numeric' })}</p>
            <p className="mt-1 text-sm font-semibold text-slate-800">{format(item.temperature_c, '°C')}{item.precipitation_probability == null ? '' : ` · ${Math.round(item.precipitation_probability * 100)}% rain`}</p>
            <p className="text-[10px] capitalize text-slate-500">{item.weather_description || 'Condition unavailable'}{item.rainfall_3h_mm == null ? '' : ` · ${format(item.rainfall_3h_mm, 'mm / 3h')}`}</p>
          </div>)}
        </div>
      </div>}
      {forecastError && <p className="mt-2 text-[11px] text-amber-800">Forecast unavailable: {forecastError}</p>}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-sky-100 pt-2 text-[10px] text-slate-500">
        <span>{current?.time ? `Observed: ${new Date(current.time).toLocaleString()}` : 'Observation time unavailable'}</span>
        <span>Retrieved: {weather?.retrieved_at ? new Date(weather.retrieved_at).toLocaleString() : '—'}</span>
      </div>
      {(isCached || isStale) && <p className="mt-2 text-[10px] text-amber-800">{isStale ? 'Provider observation is older than 3 hours.' : `Cached copy · ${Math.floor((weather?.cache_age_seconds ?? 0) / 60)} min old.`}</p>}
      {(weather?.fallback_notice || weather?.live_error) && <p className="mt-2 text-[10px] text-amber-800">{weather.fallback_notice || weather.live_error}</p>}
      <p className="mt-2 text-[10px] leading-relaxed text-slate-400">{weather?.provenance_policy || 'Weather point data is not an official disaster warning or state-wide summary.'}</p>
    </section>
  );
}

function WeatherValue({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg bg-white px-3 py-2">
    <p className="text-[10px] font-medium text-slate-500">{label}</p>
    <p className="mt-1 text-lg font-semibold tabular-nums text-slate-900">{value}</p>
  </div>;
}

function format(value?: number | null, unit?: string) {
  if (value == null || !Number.isFinite(value)) return '—';
  return `${Number(value.toFixed(1))}${unit ? ` ${unit}` : ''}`;
}
