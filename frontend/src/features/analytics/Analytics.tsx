import React, { useCallback, useEffect, useState } from 'react';
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend, ReferenceLine
} from 'recharts';
import { api } from '../../api/client';
import type { AnalyticsOverview } from '../../types';
import { Skeleton } from '../../components/ui/Skeleton';
import { ErrorState } from '../../components/ui/ErrorState';
import { useVisibleRefresh } from '../../hooks/useVisibleRefresh';
import { BarChart2, Droplets, Waves, Map, Bell, AlertTriangle, LifeBuoy, History, Activity, RefreshCw } from 'lucide-react';
import { LiveWeatherCard } from '../../components/LiveWeatherCard';
import type { WeatherLocationItem } from '../../api/client';

const CARD_ICONS: Record<string, React.ElementType> = {
  rainfall: Droplets,
  river: Waves,
  risk: Map,
  alerts: Bell,
  incidents: AlertTriangle,
  rescue: LifeBuoy,
  historical: History,
  freshness: Activity,
};

function AnalyticsCard({
  title, subtitle, icon: Icon, children, onCSV,
}: {
  title: string; subtitle: string; icon?: React.ElementType;
  children: React.ReactNode; onCSV?: () => void;
}) {
  const Ico = Icon ?? BarChart2;
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <Ico className="w-4 h-4 text-teal-700 flex-shrink-0" />
          <div>
            <div className="text-sm font-bold text-slate-900">{title}</div>
            <div className="text-[11px] text-slate-500">{subtitle}</div>
          </div>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <span className="text-[10px] text-slate-500">Stored records · freshness varies</span>
          {onCSV && (
            <button onClick={onCSV} className="text-[10px] font-semibold px-2 py-0.5 rounded border border-slate-200 text-slate-600 hover:bg-slate-50 transition">CSV</button>
          )}
        </div>
      </div>
      {children}
    </div>
  );
}

function downloadCSV(data: object[], filename: string) {
  if (!data.length) return;
  const keys = Object.keys(data[0]);
  const csv = [keys.join(','), ...data.map(r => keys.map(k => JSON.stringify((r as Record<string,unknown>)[k] ?? '')).join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename + '.csv'; a.click();
  URL.revokeObjectURL(url);
}

const SEVERITY_COLORS: Record<string, string> = {
  CRITICAL: '#DC2626', HIGH: '#F97316', MODERATE: '#EAB308', LOW: '#16A34A'
};

const STATUS_COLORS: Record<string, string> = {
  SUBMITTED: '#64748B', RECEIVED: '#2563EB', ASSIGNED: '#7C3AED',
  EN_ROUTE: '#0EA5E9', SERVED: '#16A34A', CLOSED: '#94A3B8', UNREACHABLE: '#DC2626'
};

export default function Analytics() {
  const [data, setData] = useState<AnalyticsOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hoursWindow, setHoursWindow] = useState(48);
  const [weatherLocations, setWeatherLocations] = useState<WeatherLocationItem[]>([]);
  const [weatherLocationId, setWeatherLocationId] = useState('wx_guwahati');

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    api.getAnalyticsOverview(hoursWindow)
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [hoursWindow]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    let active = true;
    api.getWeatherLocations().then(result => {
      if (!active) return;
      setWeatherLocations(result.locations);
      setWeatherLocationId(current => result.locations.some(location => location.id === current)
        ? current
        : result.locations[0]?.id ?? '');
    }).catch(() => { if (active) setWeatherLocations([]); });
    return () => { active = false; };
  }, []);
  useVisibleRefresh(load, 5 * 60 * 1000);

  if (loading && !data) return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-64" />)}
      </div>
    </div>
  );
  if (error && !data) return <ErrorState message={error ?? 'Analytics unavailable'} onRetry={load} />;
  if (!data) return <ErrorState message="Analytics unavailable" onRetry={load} />;

  const riverWithMarks = data.river_trend;

  return (
    <div className="space-y-4">
      {/* Global filters */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white rounded-xl border border-slate-200 shadow-sm p-3">
        <div className="flex items-center gap-2">
          <BarChart2 className="w-4 h-4 text-teal-700" />
          <span className="text-sm font-bold text-slate-900">Analytics Dashboard</span>
        </div>
        <p className="mt-1 text-[11px] text-slate-500">Live weather refreshes every 5 minutes. Stored charts use verified backend observations only.</p>
        <div className="flex items-center gap-2">
          <label className="text-xs text-slate-500 font-medium">Window:</label>
          <select
            value={hoursWindow}
            onChange={e => setHoursWindow(Number(e.target.value))}
            className="text-xs border border-slate-200 rounded-lg px-2 py-1 focus:outline-none"
          >
            <option value={24}>24 h</option>
            <option value={48}>48 h</option>
            <option value={72}>72 h</option>
            <option value={168}>7 days</option>
          </select>
          <span className="text-[10px] text-slate-400">Generated {new Date(data.generated_at).toLocaleTimeString('en-IN')} IST</span>
          <button onClick={load} className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50" aria-label="Refresh analytics"><RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} /> Refresh</button>
        </div>
      </div>

      {weatherLocationId && <section className="space-y-3" aria-label="Live weather analytics">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div><h2 className="text-sm font-semibold text-slate-900">Live conditions and forecast</h2><p className="text-xs text-slate-500">Direct from the weather API for one monitored point; source and observation time are shown below.</p></div>
          <label className="flex items-center gap-2 text-xs text-slate-600">Location
            <select value={weatherLocationId} onChange={event => setWeatherLocationId(event.target.value)} className="max-w-64 rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs">
              {weatherLocations.map(location => <option key={location.id} value={location.id}>{location.city} · {location.district}, {location.state}</option>)}
            </select>
          </label>
        </div>
        <LiveWeatherCard key={weatherLocationId} location={weatherLocations.find(location => location.id === weatherLocationId)?.city ?? 'Guwahati'} locationId={weatherLocationId} />
      </section>}
      {error && <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">Analytics refresh failed; showing the last loaded report. {error}</div>}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

        {/* 1. Rainfall Trend */}
        <AnalyticsCard
          title="Observed Rainfall (24h accumulation)"
          subtitle="Average and peak station readings by report hour · mm/24h"
          icon={CARD_ICONS.rainfall}
          onCSV={() => downloadCSV(data.rainfall_trend_hourly, 'rainfall-trend')}
        >
          {data.rainfall_trend_hourly.length === 0 ? (
            <div className="text-xs text-slate-400 text-center py-8">No rainfall data in this window</div>
          ) : (
            <ResponsiveContainer width="100%" height={180}>
              <AreaChart data={data.rainfall_trend_hourly} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                <XAxis dataKey="time" tick={{ fontSize: 9, fill: '#64748B' }} tickLine={false} tickFormatter={v => v.slice(11,16)} />
                <YAxis tick={{ fontSize: 9, fill: '#64748B' }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ fontSize: 11 }} formatter={(v, n) => [`${v} mm/24h`, n]} />
                <Area type="monotone" dataKey="avg_mm" stroke="#0EA5E9" fill="#BAE6FD" strokeWidth={2} name="Average station total" />
                <Area type="monotone" dataKey="max_mm" stroke="#0F766E" fill="#CCFBF1" strokeWidth={1.5} strokeDasharray="4 2" name="Highest station total" />
              </AreaChart>
            </ResponsiveContainer>
          )}
          <p className="text-[10px] text-slate-400">Stored, non-simulated 24-hour rainfall observations · grouped by observation time. {hoursWindow}h filter. No model gap-fill is included.</p>
        </AnalyticsCard>

        <AnalyticsCard
          title="Next 24h Rainfall Forecast by Location"
          subtitle="Open-Meteo forecast model · advisory trigger at 64.5 mm/24h"
          icon={CARD_ICONS.rainfall}
          onCSV={() => downloadCSV(data.forecast_rainfall_24h, 'rainfall-forecast-24h')}
        >
          {data.forecast_rainfall_24h.length === 0 ? (
            <div className="text-xs text-slate-400 text-center py-8">No cached forecast available. Check System Health for feed status.</div>
          ) : <>
            <div className="text-[11px] text-slate-500 mb-2">{data.forecast_rainfall_24h.filter(point => point.forecast_mm >= 64.5).length} monitored locations exceed this dashboard’s advisory rainfall trigger. Model output is not an IMD warning.</div>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={data.forecast_rainfall_24h} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                <XAxis dataKey="location" tick={{ fontSize: 9, fill: '#64748B' }} tickLine={false} interval={0} angle={-20} textAnchor="end" height={48} />
                <YAxis tick={{ fontSize: 9, fill: '#64748B' }} axisLine={false} tickLine={false} unit=" mm" />
                <Tooltip contentStyle={{ fontSize: 11 }} formatter={v => [`${v} mm`, 'Forecast next 24h']} />
                <ReferenceLine y={64.5} stroke="#dc2626" strokeDasharray="5 3" label={{ value: 'Heavy rain', fill: '#b91c1c', fontSize: 9 }} />
                <Bar dataKey="forecast_mm" name="Forecast mm" fill="#7C3AED" radius={[3,3,0,0]} maxBarSize={28} />
              </BarChart>
            </ResponsiveContainer>
            <div className="max-h-28 overflow-y-auto text-[10px] text-slate-500">
              {data.forecast_rainfall_24h.map(point => <div key={`${point.location}-${point.district}`} className="flex justify-between border-b border-slate-100 py-1"><span>{point.location} · {point.district}</span><span className="font-semibold">{point.forecast_mm.toFixed(1)} mm</span></div>)}
            </div>
          </>}
          <p className="text-[10px] text-slate-400">Forecast window is the next 24h from retrieval time. Heavy-rain band follows IMD amount classification; model forecast does not mean an official warning.</p>
        </AnalyticsCard>

        {/* 2. River Levels vs CWC Marks */}
        <AnalyticsCard
          title="River Levels vs CWC Warning/Danger Marks"
          subtitle="Gauge readings in metres · CWC official thresholds"
          icon={CARD_ICONS.river}
          onCSV={() => downloadCSV(riverWithMarks, 'river-levels')}
        >
          {riverWithMarks.length === 0 ? (
            <div className="text-xs text-slate-400 text-center py-8">No river level data available</div>
          ) : (
            <div className="max-h-64 overflow-auto">
              <table className="w-full text-[11px]">
                <thead className="sticky top-0 bg-white"><tr className="border-b border-slate-100">
                  <th className="text-left py-1.5 px-2 text-slate-500">Gauge / river</th><th className="text-right py-1.5 px-2 text-slate-500">Level</th><th className="text-right py-1.5 px-2 text-orange-700">Warning</th><th className="text-right py-1.5 px-2 text-red-700">Danger</th><th className="text-right py-1.5 px-2 text-slate-500">Observed</th>
                </tr></thead>
                <tbody>{riverWithMarks.map((r, i) => <tr key={`${r.location}-${r.time}-${i}`} className="border-b border-slate-50">
                  <td className="py-1.5 px-2"><b>{r.location}</b><span className="ml-1 text-slate-500">{r.river}</span></td><td className="py-1.5 px-2 text-right font-semibold">{r.level_m.toFixed(2)} m</td><td className="py-1.5 px-2 text-right">{r.warning_level_m == null ? '—' : `${r.warning_level_m} m`}</td><td className="py-1.5 px-2 text-right">{r.danger_level_m == null ? '—' : `${r.danger_level_m} m`}</td><td className="py-1.5 px-2 text-right text-slate-500">{new Date(r.time).toLocaleString('en-IN')}</td>
                </tr>)}</tbody>
              </table>
            </div>
          )}
          <p className="text-[10px] text-slate-400">⚠ Warning and Danger marks are CWC official thresholds. AI cannot override them.</p>
        </AnalyticsCard>

        {/* 3. Risk by Area */}
        <AnalyticsCard
          title="Current Risk Assessment by Location"
          subtitle="Integrated flood + landslide risk score (AI-assessed, PROPOSED)"
          icon={CARD_ICONS.risk}
          onCSV={() => downloadCSV(data.risk_by_area, 'risk-by-area')}
        >
          {data.risk_by_area.length === 0 ? (
            <div className="text-xs text-slate-400 text-center py-8">No risk data</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="border-b border-slate-100">
                    <th className="text-left py-1.5 px-2 text-slate-500 font-semibold">Location</th>
                    <th className="text-left py-1.5 px-2 text-slate-500 font-semibold">Flood</th>
                    <th className="text-left py-1.5 px-2 text-slate-500 font-semibold">Landslide</th>
                    <th className="text-left py-1.5 px-2 text-slate-500 font-semibold">Overall</th>
                  </tr>
                </thead>
                <tbody>
                  {data.risk_by_area.map((r, i) => (
                    <tr key={i} className="border-b border-slate-50 hover:bg-slate-50">
                      <td className="py-1.5 px-2 font-medium text-slate-800">{r.location}</td>
                      <td className="py-1.5 px-2">
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-bold" style={{ background: (SEVERITY_COLORS[r.flood_category] ?? '#64748B') + '20', color: SEVERITY_COLORS[r.flood_category] ?? '#64748B' }}>{r.flood_category}</span>
                      </td>
                      <td className="py-1.5 px-2">
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-bold" style={{ background: (SEVERITY_COLORS[r.landslide_category] ?? '#64748B') + '20', color: SEVERITY_COLORS[r.landslide_category] ?? '#64748B' }}>{r.landslide_category}</span>
                      </td>
                      <td className="py-1.5 px-2">
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-bold" style={{ background: (SEVERITY_COLORS[r.risk_category] ?? '#64748B') + '20', color: SEVERITY_COLORS[r.risk_category] ?? '#64748B' }}>{r.risk_category}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </AnalyticsCard>

        {/* 4. Alerts by Severity */}
        <AnalyticsCard
          title="Active Alerts by Severity"
          subtitle="Official vs AI-generated alerts breakdown"
          icon={CARD_ICONS.alerts}
          onCSV={() => downloadCSV(data.alerts_by_severity, 'alerts-by-severity')}
        >
          {data.alerts_by_severity.length === 0 ? (
            <div className="text-xs text-slate-400 text-center py-8">No alert data</div>
          ) : (
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={data.alerts_by_severity} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                <XAxis dataKey="severity" tick={{ fontSize: 10, fill: '#64748B' }} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: '#64748B' }} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip contentStyle={{ fontSize: 11 }} />
                <Legend wrapperStyle={{ fontSize: 10 }} />
                <Bar dataKey="official" name="Official Agency" fill="#0EA5E9" radius={[2,2,0,0]} maxBarSize={32} />
                <Bar dataKey="ai_generated" name="AI PROPOSED" fill="#7C3AED" radius={[2,2,0,0]} maxBarSize={32} />
              </BarChart>
            </ResponsiveContainer>
          )}
          <p className="text-[10px] text-slate-400">AI-PROPOSED alerts are advisory only. Official alerts carry agency name and verbatim text.</p>
        </AnalyticsCard>

        {/* 5. Incidents by Category */}
        <AnalyticsCard
          title="Community Incidents by Category"
          subtitle={`Reports submitted in the selected ${hoursWindow}h window · rejected reports excluded`}
          icon={CARD_ICONS.incidents}
          onCSV={() => downloadCSV(data.incidents_by_category, 'incidents')}
        >
          {data.incidents_by_category.length === 0 ? (
            <div className="text-xs text-slate-400 text-center py-8">No incident data</div>
          ) : (
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={data.incidents_by_category} layout="vertical" margin={{ top: 4, right: 8, left: 80, bottom: 0 }}>
                <XAxis type="number" tick={{ fontSize: 10, fill: '#64748B' }} axisLine={false} tickLine={false} allowDecimals={false} />
                <YAxis dataKey="category" type="category" tick={{ fontSize: 10, fill: '#64748B' }} tickLine={false} width={80} />
                <Tooltip contentStyle={{ fontSize: 11 }} />
                <Bar dataKey="count" name="Incidents" fill="#F97316" radius={[0,2,2,0]} maxBarSize={20} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </AnalyticsCard>

        {/* 6. Rescue Pipeline */}
        <AnalyticsCard
          title="Rescue Request Pipeline"
          subtitle={`Requests submitted in the selected ${hoursWindow}h window · responder workload`}
          icon={CARD_ICONS.rescue}
          onCSV={() => downloadCSV(data.rescue_by_status, 'rescue-pipeline')}
        >
          {data.rescue_by_status.length === 0 ? (
            <div className="text-xs text-slate-400 text-center py-8">No rescue data</div>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              {data.rescue_by_status.map(r => (
                <div key={r.status} className="rounded-lg p-2.5 text-center" style={{ background: (STATUS_COLORS[r.status] ?? '#64748B') + '15' }}>
                  <div className="text-xl font-black" style={{ color: STATUS_COLORS[r.status] ?? '#64748B' }}>{r.count}</div>
                  <div className="text-[10px] font-semibold text-slate-600 mt-0.5">{r.status.replace('_', '\u00A0')}</div>
                </div>
              ))}
            </div>
          )}
          <p className="text-[10px] text-red-600 font-semibold">🚨 This form does not dispatch help automatically. In an emergency call 112.</p>
        </AnalyticsCard>

        {/* 7. Historical Rainfall Extremes */}
        <AnalyticsCard
          title="Historical Rainfall Extremes Reference"
          subtitle="Documented ARI events — model calibration baseline"
          icon={CARD_ICONS.historical}
          onCSV={() => downloadCSV(data.historical_rainfall_comparison, 'historical-rainfall')}
        >
          {data.historical_rainfall_comparison.length === 0 ? (
            <div className="text-xs text-slate-400 text-center py-8">No historical data</div>
          ) : (
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={data.historical_rainfall_comparison} margin={{ top: 4, right: 8, left: 0, bottom: 24 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                <XAxis dataKey="event" tick={{ fontSize: 9, fill: '#64748B' }} tickLine={false} angle={-25} textAnchor="end" />
                <YAxis tick={{ fontSize: 9, fill: '#64748B' }} axisLine={false} tickLine={false} label={{ value: 'ARI mm', angle: -90, position: 'insideLeft', offset: 10, style: { fontSize: 9 } }} />
                <Tooltip contentStyle={{ fontSize: 11 }} formatter={(v) => [`${v} mm`, 'Documented ARI']} />
                <Bar dataKey="documented_ari_mm" fill="#92400E" radius={[2,2,0,0]} maxBarSize={28} />
              </BarChart>
            </ResponsiveContainer>
          )}
          <p className="text-[10px] text-slate-400">BASELINE · GSI/IMD documented events. Used for model training validation only, not forecasting.</p>
        </AnalyticsCard>

        {/* 8. Source Freshness */}
        <AnalyticsCard
          title="Data Source Freshness"
          subtitle="Age of last successful data pull per source"
          icon={CARD_ICONS.freshness}
          onCSV={() => downloadCSV(data.source_freshness, 'source-freshness')}
        >
          {data.source_freshness.length === 0 ? (
            <div className="text-xs text-slate-400 text-center py-8">No source data</div>
          ) : (
            <div className="space-y-1.5 max-h-48 overflow-y-auto">
              {data.source_freshness.map((s, i) => {
                const age = s.age_hours_success;
                const isStale = ['STALE', 'DELAYED', 'FAILED', 'AUTH_REQUIRED', 'AUTH_ERROR', 'DISABLED'].includes(s.status) || (age !== null && age > 3);
                return (
                  <div key={i} className="flex items-center justify-between text-xs py-1.5 px-2 rounded-lg bg-slate-50 border border-slate-100">
                    <div className="font-medium text-slate-800 truncate max-w-[50%]">{s.source}</div>
                    <div className="flex items-center gap-2">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${isStale ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
                        {s.status}
                      </span>
                      <span className="text-slate-500 font-mono text-[10px]">
                        {age !== null ? `${age.toFixed(1)}h ago` : 'Never'}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </AnalyticsCard>

      </div>
    </div>
  );
}
