import React, { useEffect, useState } from 'react';
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend, LineChart, Line, ReferenceLine
} from 'recharts';
import { api } from '../../api/client';
import type { AnalyticsOverview } from '../../types';
import { Skeleton } from '../../components/ui/Skeleton';
import { ErrorState } from '../../components/ui/ErrorState';
import { BarChart2, Droplets, Waves, Map, Bell, AlertTriangle, LifeBuoy, History, Activity } from 'lucide-react';

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

  const load = () => {
    setLoading(true);
    setError(null);
    api.getAnalyticsOverview(hoursWindow)
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, [hoursWindow]);

  if (loading) return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-64" />)}
      </div>
    </div>
  );
  if (error || !data) return <ErrorState message={error ?? 'Analytics unavailable'} onRetry={load} />;

  const riverWithMarks = data.river_trend.slice(0, 40);

  return (
    <div className="space-y-4">
      {/* Global filters */}
      <div className="flex items-center justify-between bg-white rounded-xl border border-slate-200 shadow-sm p-3">
        <div className="flex items-center gap-2">
          <BarChart2 className="w-4 h-4 text-teal-700" />
          <span className="text-sm font-bold text-slate-900">Analytics Dashboard</span>
        </div>
        <p className="mt-1 text-[11px] text-slate-500">Aggregates saved by the backend; see System Health for current feed status.</p>
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
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

        {/* 1. Rainfall Trend */}
        <AnalyticsCard
          title="Rainfall Trend (Hourly)"
          subtitle="Observed precipitation across all locations · mm/hr"
          icon={CARD_ICONS.rainfall}
          onCSV={() => downloadCSV(data.rainfall_trend_hourly, 'rainfall-trend')}
        >
          {data.rainfall_trend_hourly.length === 0 ? (
            <div className="text-xs text-slate-400 text-center py-8">No rainfall data in this window</div>
          ) : (
            <ResponsiveContainer width="100%" height={180}>
              <AreaChart data={data.rainfall_trend_hourly.slice(-24)} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                <XAxis dataKey="time" tick={{ fontSize: 9, fill: '#64748B' }} tickLine={false} tickFormatter={v => v.slice(11,16)} />
                <YAxis tick={{ fontSize: 9, fill: '#64748B' }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ fontSize: 11 }} formatter={(v) => [`${v} mm`, 'Avg Rainfall']} />
                <Area type="monotone" dataKey="avg_mm" stroke="#0EA5E9" fill="#BAE6FD" strokeWidth={2} name="Avg mm" />
                <Area type="monotone" dataKey="max_mm" stroke="#0F766E" fill="#CCFBF1" strokeWidth={1.5} strokeDasharray="4 2" name="Max mm" />
              </AreaChart>
            </ResponsiveContainer>
          )}
          <p className="text-[10px] text-slate-400">Source: IMD AWS telemetry + Open-Meteo gap-fill (hatched). Accumulation window: {hoursWindow}h.</p>
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
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={riverWithMarks} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                <XAxis dataKey="location" tick={{ fontSize: 9, fill: '#64748B' }} tickLine={false} />
                <YAxis tick={{ fontSize: 9, fill: '#64748B' }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ fontSize: 11 }} formatter={(v, n) => [`${v} m`, n === 'level_m' ? 'Level' : n]} />
                <Line type="monotone" dataKey="level_m" stroke="#0EA5E9" strokeWidth={2} dot={{ r: 3, fill: '#0EA5E9' }} name="level_m" />
                {riverWithMarks[0]?.warning_level_m && (
                  <ReferenceLine y={riverWithMarks[0].warning_level_m} stroke="#F97316" strokeDasharray="6 3" label={{ value: 'Warning', fill: '#F97316', fontSize: 9 }} />
                )}
                {riverWithMarks[0]?.danger_level_m && (
                  <ReferenceLine y={riverWithMarks[0].danger_level_m} stroke="#DC2626" strokeDasharray="6 3" label={{ value: 'Danger', fill: '#DC2626', fontSize: 9 }} />
                )}
              </LineChart>
            </ResponsiveContainer>
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
                  {data.risk_by_area.slice(0, 10).map((r, i) => (
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
          subtitle="Citizen-reported and operator-verified incidents"
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
          subtitle="Open requests by status — responder workload"
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
                const isStale = age !== null && age > 3;
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
