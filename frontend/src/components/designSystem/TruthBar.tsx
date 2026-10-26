import React, { useMemo, useState } from 'react';
import { Database, Info, X } from 'lucide-react';
import type { DataSourceItem } from '../../types';

interface TruthBarProps {
  dataSources?: DataSourceItem[];
  simulationActive?: boolean;
}

const formatTime = (value?: string | null) => value ? new Date(value).toLocaleString() : 'Not recorded';

export const TruthBar: React.FC<TruthBarProps> = ({ dataSources = [], simulationActive = false }) => {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const counts = useMemo(() => ({
    connected: dataSources.filter(source => source.status === 'OPERATIONAL').length,
    delayed: dataSources.filter(source => ['STALE', 'DELAYED'].includes(source.status)).length,
    simulated: dataSources.filter(source => source.status === 'SIMULATED').length,
    unavailable: dataSources.filter(source => !['OPERATIONAL', 'STALE', 'DELAYED', 'SIMULATED'].includes(source.status)).length
  }), [dataSources]);
  const latestSuccess = useMemo(() => dataSources
    .map(source => source.last_success_at)
    .filter((time): time is string => Boolean(time))
    .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] ?? null, [dataSources]);
  const total = dataSources.length;
  const segments = [
    { key: 'connected', count: counts.connected, color: 'bg-emerald-500', label: 'Connected' },
    { key: 'delayed', count: counts.delayed, color: 'bg-amber-500', label: 'Delayed or stale' },
    { key: 'unavailable', count: counts.unavailable, color: 'bg-rose-500', label: 'Unavailable or unchecked' },
    { key: 'simulated', count: counts.simulated, color: 'bg-purple-500', label: 'Synthetic source' }
  ];

  return (
    <section className="relative rounded-xl border border-slate-200 bg-white p-3 shadow-sm" aria-label="Data freshness status">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <Database className="h-4 w-4 text-teal-700" />
          <div>
            <h2 className="text-xs font-bold uppercase tracking-wide text-slate-800">Data freshness</h2>
            <p className="text-[10px] text-slate-500">
              {total ? `${counts.connected} connected · ${counts.delayed} delayed/stale · ${counts.unavailable} unavailable/unchecked · ${counts.simulated} synthetic` : 'Source status has not loaded'}
              {simulationActive ? ' · simulation records are present' : ''}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[10px] text-slate-500">Last successful fetch: <b className="font-medium text-slate-700">{formatTime(latestSuccess)}</b></span>
          <button onClick={() => setDetailsOpen(open => !open)} aria-expanded={detailsOpen} className="inline-flex items-center gap-1 text-[10px] font-bold text-teal-700 hover:text-teal-900">
            <Info className="h-3.5 w-3.5" /> Sources
          </button>
        </div>
      </div>

      <div className="mt-2 flex h-2 w-full overflow-hidden rounded-full bg-slate-100" aria-label={total ? 'Source status distribution' : 'Source status unavailable'}>
        {total > 0 ? segments.map(segment => segment.count > 0 && (
          <div key={segment.key} role="img" aria-label={`${segment.count} ${segment.label.toLowerCase()} sources`}
            title={`${segment.count} ${segment.label.toLowerCase()} sources`}
            className={segment.color} style={{ width: `${(segment.count / total) * 100}%` }} />
        )) : <div className="w-full bg-slate-300" />}
      </div>

      {detailsOpen && (
        <div className="absolute left-0 right-0 top-full z-50 mt-2 rounded-xl border border-slate-300 bg-white p-4 shadow-2xl">
          <div className="mb-3 flex items-center justify-between border-b border-slate-200 pb-2">
            <div>
              <h3 className="text-xs font-bold text-slate-900">Source connection and data status</h3>
              <p className="text-[10px] text-slate-500">Observed values, synthetic records, and forecasts are labeled separately.</p>
            </div>
            <button onClick={() => setDetailsOpen(false)} aria-label="Close source details" className="rounded-md p-1 text-slate-400 hover:bg-slate-100"><X className="h-4 w-4" /></button>
          </div>
          <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
            {dataSources.length ? dataSources.map(source => (
              <article key={source.id} className="rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-[10px]">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h4 className="font-bold text-slate-900">{source.name}</h4>
                    <p className="mt-0.5 text-slate-500">{source.source_type} · expected interval {source.expected_update_interval_hours}h</p>
                  </div>
                  <span className="rounded-full bg-white px-2 py-0.5 font-bold text-slate-700">{source.status}</span>
                </div>
                <div className="mt-2 grid gap-1 text-slate-600 sm:grid-cols-2">
                  <p>Last successful fetch: {formatTime(source.last_success_at)}</p>
                  <p>Last attempt: {formatTime(source.last_fetch_attempt_at)}</p>
                  {source.latest_observation_at && <p>Observed: {source.latest_value ?? '—'} {source.latest_unit ?? ''} · {source.latest_variable?.replaceAll('_', ' ')} · {formatTime(source.latest_observation_at)}</p>}
                  {source.latest_observation_status && <p>Observation status: {source.latest_observation_status}{source.latest_observation_simulated ? ' · SYNTHETIC' : ''}</p>}
                  {source.latest_forecast_24h_mm != null && <p>Forecast: {source.latest_forecast_24h_mm} mm / 24h · {source.latest_forecast_status} · fetched {formatTime(source.latest_forecast_fetched_at)}</p>}
                  {!source.latest_observation_at && source.latest_forecast_24h_mm == null && <p>Observation data: missing</p>}
                </div>
              </article>
            )) : <p className="text-xs text-slate-500">No source status records are available yet.</p>}
          </div>
        </div>
      )}
    </section>
  );
};
