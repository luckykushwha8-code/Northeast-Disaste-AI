import React, { useCallback, useEffect, useState } from 'react';
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend
} from 'recharts';
import { api } from '../../api/client';
import type { AnalyticsOverview } from '../../types';
import { Skeleton } from '../../components/ui/Skeleton';
import { ErrorState } from '../../components/ui/ErrorState';
import { useVisibleRefresh } from '../../hooks/useVisibleRefresh';
import { BarChart2, Droplets, Waves, Map, Bell, AlertTriangle, LifeBuoy, History, Activity, RefreshCw } from 'lucide-react';
import { LiveWeatherCard } from '../../components/LiveWeatherCard';
import type { WeatherForecastResponse, WeatherLocationItem } from '../../api/client';

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
  title, subtitle, icon: Icon, children, onCSV, dataLabel = 'Verified backend data',
}: {
  title: string; subtitle: string; icon?: React.ElementType;
  children: React.ReactNode; onCSV?: () => void; dataLabel?: string;
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
          <span className="text-[10px] text-slate-500">{dataLabel}</span>
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
  const [weatherForecast, setWeatherForecast] = useState<{ locationId: string; data: WeatherForecastResponse } | null>(null);
  const [forecastError, setForecastError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    api.getAnalyticsOverview(hoursWindow)
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [hoursWindow]);

  const refreshForecast = useCallback(() => {
    if (!weatherLocationId) return;
    setForecastError(null);
    api.getWeatherForecast(weatherLocationId)
      .then(result => setWeatherForecast({ locationId: weatherLocationId, data: result }))
      .catch(reason => setForecastError(reason instanceof Error ? reason.message : 'Forecast unavailable'));
  }, [weatherLocationId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { refreshForecast(); }, [refreshForecast]);
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
  useVisibleRefresh(refreshForecast, 30 * 60 * 1000);

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
  const totalAlerts = data.alerts_by_severity.reduce((sum, item) => sum + item.official + item.ai_generated, 0);
  const selectedForecast = weatherForecast?.locationId === weatherLocationId ? weatherForecast.data : null;
  const forecastCutoff = Date.now() + 24 * 60 * 60 * 1000;
  const liveForecast24h = (selectedForecast?.forecast ?? [])
    .filter(point => {
      const time = Date.parse(point.forecast_at);
      return Number.isFinite(time) && time >= Date.now() && time <= forecastCutoff;
    })
    .map(point => ({
      time: point.forecast_at,
      rain_mm: point.rainfall_3h_mm ?? null,
      probability: point.precipitation_probability == null ? null : Math.round(point.precipitation_probability * 100),
      temperature_c: point.temperature_c ?? null,
      condition: point.weather_description ?? point.weather_condition ?? 'Not reported',
    }));
  const riskDistribution = ['CRITICAL', 'HIGH', 'MODERATE', 'LOW', 'UNKNOWN', 'UNAVAILABLE'].map(severity => ({
    severity,
    flood: data.risk_by_area.filter(location => location.flood_category === severity).length,
    landslide: data.risk_by_area.filter(location => location.landslide_category === severity).length,
    overall: data.risk_by_area.filter(location => location.risk_category === severity).length,
  }));

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
          dataLabel="Verified station records"
          onCSV={() => downloadCSV(data.rainfall_trend_hourly, 'rainfall-trend')}
        >
          {data.rainfall_trend_hourly.length === 0 ? (
            <div className="text-xs text-slate-500 text-center py-8">No verified station rainfall observations were recorded in this window.</div>
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
          title="Next 24h Rainfall Forecast"
          subtitle={`OpenWeather · ${selectedForecast?.city || 'selected monitored point'} · 3-hour steps`}
          icon={CARD_ICONS.rainfall}
          dataLabel={`${selectedForecast?.data_mode ?? 'Loading'} · ${selectedForecast?.source ?? 'weather provider'}`}
          onCSV={() => downloadCSV(liveForecast24h, 'rainfall-forecast-24h')}
        >
          {liveForecast24h.length === 0 ? (
            <div className="text-xs text-slate-500 text-center py-8">{forecastError ?? selectedForecast?.live_error ?? 'No verified forecast periods are available for this location.'}</div>
          ) : <>
            <div className="text-[11px] text-slate-500 mb-2">Point forecast for {selectedForecast?.location_name}. Blank rainfall amounts mean the provider reported no amount for that step; they are not filled as zero.</div>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={liveForecast24h} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                <XAxis dataKey="time" tick={{ fontSize: 9, fill: '#64748B' }} tickLine={false} tickFormatter={value => new Date(value).toLocaleTimeString('en-IN', { hour: '2-digit' })} />
                <YAxis tick={{ fontSize: 9, fill: '#64748B' }} axisLine={false} tickLine={false} unit=" mm" />
                <Tooltip contentStyle={{ fontSize: 11 }} labelFormatter={value => new Date(String(value)).toLocaleString('en-IN')} formatter={value => [value == null ? 'Not reported' : `${value} mm / 3h`, 'Forecast rainfall']} />
                <Bar dataKey="rain_mm" name="Forecast rainfall · mm/3h" fill="#0E7490" radius={[3,3,0,0]} maxBarSize={28} />
              </BarChart>
            </ResponsiveContainer>
            <div className="max-h-32 overflow-y-auto text-[10px] text-slate-500">
              {liveForecast24h.map(point => <div key={point.time} className="flex justify-between border-b border-slate-100 py-1"><span>{new Date(point.time).toLocaleString('en-IN', { weekday: 'short', hour: '2-digit' })} · {point.condition}{point.probability == null ? '' : ` · ${point.probability}% rain`}</span><span className="font-semibold">{point.rain_mm == null ? 'Not reported' : `${point.rain_mm.toFixed(2)} mm / 3h`}</span></div>)}
            </div>
          </>}
          <p className="text-[10px] text-slate-400">Forecast, not an observation or official IMD warning. Retrieved {selectedForecast?.retrieved_at ? new Date(selectedForecast.retrieved_at).toLocaleString('en-IN') : '—'}.</p>
        </AnalyticsCard>

        {/* 2. River Levels vs CWC Marks */}
        <AnalyticsCard
          title="River Levels vs CWC Warning/Danger Marks"
          subtitle="Gauge readings in metres · CWC official thresholds"
          icon={CARD_ICONS.river}
          dataLabel="CWC gauge observations"
          onCSV={() => downloadCSV(riverWithMarks, 'river-levels')}
        >
          {riverWithMarks.length === 0 ? (
            <div className="text-xs text-slate-500 text-center py-8">CWC has not supplied a current gauge reading for these monitored stations. The warning and danger marks are reference thresholds only.</div>
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
          dataLabel="PROPOSED backend assessment"
          onCSV={() => downloadCSV(data.risk_by_area, 'risk-by-area')}
        >
          {data.risk_by_area.length === 0 ? (
            <div className="text-xs text-slate-400 text-center py-8">No risk data</div>
          ) : (
            <div className="overflow-x-auto">
              <ResponsiveContainer width="100%" height={190}>
                <BarChart data={riskDistribution} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                  <XAxis dataKey="severity" tick={{ fontSize: 9, fill: '#64748B' }} tickLine={false} />
                  <YAxis tick={{ fontSize: 9, fill: '#64748B' }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip contentStyle={{ fontSize: 11 }} />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  <Bar dataKey="flood" name="Flood locations" fill="#0E7490" radius={[2, 2, 0, 0]} maxBarSize={28} />
                  <Bar dataKey="landslide" name="Landslide locations" fill="#7C3AED" radius={[2, 2, 0, 0]} maxBarSize={28} />
                  <Bar dataKey="overall" name="Overall locations" fill="#D97706" radius={[2, 2, 0, 0]} maxBarSize={28} />
                </BarChart>
              </ResponsiveContainer>
              <p className="mb-2 text-[10px] text-slate-500">Counts by backend assessment label. UNKNOWN and UNAVAILABLE are shown as such; they do not mean low risk.</p>
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
          dataLabel="Current active alert records"
          onCSV={() => downloadCSV(data.alerts_by_severity, 'alerts-by-severity')}
        >
          {data.alerts_by_severity.length === 0 ? (
            <div className="py-8 text-center text-xs text-slate-500">No alert count data returned by the backend.</div>
          ) : <>
            <div className="mb-1 text-center"><span className="text-xl font-semibold text-slate-800">{totalAlerts} active alerts</span><div className="text-[11px] text-slate-500">Counted from the backend active alert queue</div></div>
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
          </>}
          <p className="text-[10px] text-slate-400">AI-PROPOSED alerts are advisory only. Official alerts carry agency name and verbatim text.</p>
        </AnalyticsCard>

        {/* 5. Incidents by Category */}
        <AnalyticsCard
          title="Community Incidents by Category"
          subtitle={`Reports submitted in the selected ${hoursWindow}h window · rejected reports excluded`}
          icon={CARD_ICONS.incidents}
          dataLabel="Community submissions"
          onCSV={() => downloadCSV(data.incidents_by_category, 'incidents')}
        >
          {data.incidents_by_category.length === 0 ? (
            <div className="py-8 text-center"><div className="text-2xl font-semibold text-slate-800">0 incident reports</div><div className="mt-1 text-xs text-slate-500">No community reports were submitted in the selected window.</div></div>
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
          dataLabel="Rescue requests"
          onCSV={() => downloadCSV(data.rescue_by_status, 'rescue-pipeline')}
        >
          {data.rescue_by_status.length === 0 ? (
            <div className="py-8 text-center"><div className="text-2xl font-semibold text-slate-800">0 requests</div><div className="mt-1 text-xs text-slate-500">No rescue requests were submitted in the selected window.</div></div>
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
          dataLabel="Verified rainfall baseline"
          onCSV={() => downloadCSV(data.historical_rainfall_comparison, 'historical-rainfall')}
        >
          {data.historical_rainfall_comparison.length === 0 ? (
            <div className="py-8 text-center text-xs text-slate-500">No independently verified historical rainfall extremes are connected, so this chart has no rainfall values to plot.</div>
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
