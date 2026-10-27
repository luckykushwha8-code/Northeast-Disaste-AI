import { useCallback, useEffect, useState } from 'react';
import { CloudRain, RefreshCw } from 'lucide-react';
import { api, type CurrentWeatherItem } from '../api/client';
import { useVisibleRefresh } from '../hooks/useVisibleRefresh';

export function LiveWeatherCard({ location, locationId }: {
  location: string;
  locationId: string;
}) {
  const [weather, setWeather] = useState<CurrentWeatherItem | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const result = await api.getCurrentWeather(locationId);
      setWeather(result);
      setUpdatedAt(new Date().toISOString());
      setError(null);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Weather is unavailable';
      setError(message);
      setWeather(current => current ? { ...current, data_mode: 'CACHED', cache_hit: true, live_error: message } : null);
    }
  }, [locationId]);

  useEffect(() => { void refresh(); }, [refresh]);
  useVisibleRefresh(refresh, 5 * 60_000);

  const current = weather?.current;
  const isLive = !!current && weather?.data_mode === 'LIVE';
  const isCached = !!current && weather?.data_mode === 'CACHED';
  const stateLabel = !weather && !error ? 'Loading' : isLive ? (weather?.cache_hit ? 'Live · recent cache' : 'Live model') : isCached ? 'Cached' : 'Unavailable';
  return (
    <section className="rounded-xl border border-sky-200 bg-sky-50/70 p-4" aria-label={`Weather for ${location}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="rounded-lg bg-white p-2 text-sky-700"><CloudRain className="h-4 w-4" /></span>
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Live weather · {location}</h3>
            <p className="text-[11px] text-slate-500">Open-Meteo via Geo Shield API · not an official gauge</p>
          </div>
        </div>
        <span className={`inline-flex items-center gap-1.5 rounded-full bg-white px-2 py-1 text-[10px] font-semibold ${isLive ? 'text-emerald-700' : isCached ? 'text-amber-800' : 'text-slate-600'}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${isLive ? 'bg-emerald-500' : isCached ? 'bg-amber-500' : 'bg-slate-400'}`} /> {stateLabel}
        </span>
      </div>
      {current ? <div className="mt-4 grid grid-cols-3 gap-3">
        <WeatherValue label="Temperature" value={format(current.temperature_2m, weather?.current_units?.temperature_2m)} />
        <WeatherValue label="Precipitation" value={format(current.precipitation, weather?.current_units?.precipitation)} />
        <WeatherValue label="Wind" value={format(current.wind_speed_10m, weather?.current_units?.wind_speed_10m)} />
      </div> : <p className="mt-4 text-xs text-slate-600">{error ? `Weather unavailable: ${error}` : weather?.live_error ? `Weather currently unavailable: ${weather.live_error}` : 'Loading current weather…'}</p>}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-sky-100 pt-2 text-[10px] text-slate-500">
        <span>{current?.time ? `Model time: ${new Date(current.time).toLocaleString()}` : 'Weather timestamp unavailable'}</span>
        <span className="inline-flex items-center gap-1"><RefreshCw className="h-3 w-3" /> Checked {updatedAt ? new Date(updatedAt).toLocaleTimeString() : '—'} · API checks every 5 min</span>
      </div>
    </section>
  );
}

function WeatherValue({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg bg-white px-3 py-2">
    <p className="text-[10px] font-medium text-slate-500">{label}</p>
    <p className="mt-1 text-lg font-semibold tabular-nums text-slate-900">{value}</p>
  </div>;
}

function format(value?: number, unit?: string) {
  if (value == null || !Number.isFinite(value)) return '—';
  return `${Number(value.toFixed(1))}${unit ? ` ${unit}` : ''}`;
}
