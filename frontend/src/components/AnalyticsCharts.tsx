import { useEffect, useState } from 'react';
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine, Cell
} from 'recharts';
import { api } from '../api/client';
import type {
  AnalyticsOverview, SeverityLevel, RiskByAreaPoint
} from '../types';

const SEVERITY_COLORS: Record<SeverityLevel, string> = {
  LOW: '#16a34a',
  MODERATE: '#d97706',
  HIGH: '#ea580c',
  CRITICAL: '#dc2626',
  UNAVAILABLE: '#6b7280'
};

function DataStatus({ text }: { text: string }) {
  return <div className="analytics-empty">{text}</div>;
}

function ChartCard({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="analytics-card">
      <div className="analytics-card-title">{title}</div>
      {subtitle && <div className="analytics-card-subtitle">{subtitle}</div>}
      <div className="analytics-card-body">{children}</div>
    </div>
  );
}

function riskColor(scale: number): string {
  if (scale >= 0.80) return SEVERITY_COLORS.CRITICAL;
  if (scale >= 0.55) return SEVERITY_COLORS.HIGH;
  if (scale >= 0.30) return SEVERITY_COLORS.MODERATE;
  return SEVERITY_COLORS.LOW;
}

const fmtTime = (t: string) => t.replace('T', ' ').slice(0, 16) + ' UTC';
const fmtHour = (t: string) => t.slice(11, 16);
const fmtDay = (t: string) => t.slice(5, 10);

export default function AnalyticsCharts() {
  const [data, setData] = useState<AnalyticsOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    api.getAnalyticsOverview()
      .then((overview: AnalyticsOverview) => { if (!cancelled) { setData(overview); setError(null); } })
      .catch((e: unknown) => { if (!cancelled) setError(String(e instanceof Error ? e.message : e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  if (loading) return <div className="analytics-empty">Loading platform analytics…</div>;
  if (error) return <DataStatus text={`Analytics unavailable: ${error}`} />;
  if (!data) return null;

  return (
    <div className="analytics-root">
      <div className="analytics-generated">
        Generated {fmtTime(data.generated_at)} UTC · Data sources: CWC, IMD, Open-Meteo, GSI, citizen reports
      </div>

      <div className="analytics-grid">
        <ChartCard title="Rainfall — last 72 hours" subtitle="Average and max recorded rainfall, mm per hour">
          {data.rainfall_trend_hourly.length === 0 ? (
            <DataStatus text="No rainfall observations in the last 72 h." />
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={data.rainfall_trend_hourly}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="time" tickFormatter={fmtHour} fontSize={11} />
                <YAxis unit=" mm" fontSize={11} />
                <Tooltip labelFormatter={v => fmtTime(String(v))} formatter={(v: unknown, n: unknown) => [`${v} mm`, String(n)]} />
                <Legend />
                <Line type="monotone" dataKey="avg_mm" name="Average rainfall" stroke="#2563eb" dot={false} />
                <Line type="monotone" dataKey="max_mm" name="Max rainfall (single station)" stroke="#dc2626" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title="Rainfall — last 14 days" subtitle="Daily totals across all monitored locations">
          {data.rainfall_trend_daily.length === 0 ? (
            <DataStatus text="No rainfall observations in the last 14 days." />
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={data.rainfall_trend_daily}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="time" tickFormatter={fmtDay} fontSize={11} />
                <YAxis unit=" mm" fontSize={11} />
                <Tooltip formatter={(v: unknown, n: unknown) => [`${v} mm`, String(n)]} />
                <Legend />
                <Bar dataKey="avg_mm" name="Avg daily rainfall" fill="#2563eb" />
                <Bar dataKey="max_mm" name="Max daily rainfall" fill="#93c5fd" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title="River levels vs official safety marks" subtitle="Live river level with the official CWC warning and danger marks per station">
          {data.river_trend.length === 0 ? (
            <DataStatus text="No river-level observations available." />
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={data.river_trend}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="time" tickFormatter={fmtHour} fontSize={11} />
                <YAxis unit=" m" fontSize={11} />
                <Tooltip labelFormatter={v => fmtTime(String(v))} />
                <Legend />
                {Array.from(new Set(data.river_trend.map(p => p.location))).map((loc, i) => (
                  <Line
                    key={loc}
                    type="monotone"
                    dataKey="level_m"
                    data={data.river_trend.filter(p => p.location === loc)}
                    name={loc}
                    dot={false}
                    stroke={["#2563eb", "#dc2626", "#16a34a", "#d97706", "#7c3aed", "#0891b2", "#be185d"][i % 7]}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          )}
          <div className="river-marks-note">
            {Array.from(new Set(data.river_trend.map(p => p.location))).map(loc => {
              const pt = data.river_trend.find(p => p.location === loc);
              return pt ? (
                <div key={loc} className="river-marks-row">
                  {loc}: latest river level {pt.level_m.toFixed(2)} m · warning {pt.warning_level_m ? pt.warning_level_m.toFixed(2) : '—'} · danger {pt.danger_level_m ? pt.danger_level_m.toFixed(2) : '—'} m
                </div>
              ) : null;
            })}
          </div>
        </ChartCard>

        <ChartCard title="Integrated risk by area" subtitle="Flood + landslide AI assessment across all monitored locations">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={data.risk_by_area} layout="vertical" margin={{ left: 130 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" domain={[0, 1]} fontSize={11} />
              <YAxis type="category" dataKey="location" fontSize={10} width={140} />
              <Tooltip
                formatter={(v: unknown, n: unknown) => [String(v), String(n)]}
                labelFormatter={(v) => {
                  const pt = data.risk_by_area.find((p: RiskByAreaPoint) => p.location === v);
                  return pt ? `${pt.location} · ${pt.district}, ${pt.state}` : String(v);
                }}
              />
              <Bar dataKey="score" name="Overall risk score">
                {data.risk_by_area.map(p => (
                  <Cell key={p.location} fill={p.score != null ? riskColor(p.score) : SEVERITY_COLORS.UNAVAILABLE} />
                ))}
              </Bar>
              <ReferenceLine x={0.80} stroke="#dc2626" strokeDasharray="4 4" label={{ value: 'CRITICAL', fontSize: 9, fill: '#dc2626', position: 'top' }} />
              <ReferenceLine x={0.55} stroke="#ea580c" strokeDasharray="4 4" label={{ value: 'HIGH', fontSize: 9, fill: '#ea580c', position: 'top' }} />
              <ReferenceLine x={0.30} stroke="#d97706" strokeDasharray="4 4" label={{ value: 'MODERATE', fontSize: 9, fill: '#d97706', position: 'top' }} />
            </BarChart>
          </ResponsiveContainer>
          <div className="river-marks-note">
            {data.risk_by_area.map(p => (
              <div key={p.location} className="river-marks-row">
                {p.location}: {p.risk_category} · flood {p.flood_category} · landslide {p.landslide_category} · {p.district}, {p.state}
              </div>
            ))}
          </div>
        </ChartCard>

        <ChartCard title="Alerts by severity" subtitle="Official (CWC/IMD-derived) vs AI-generated — AI stays PROPOSED until operator approves">
          {data.alerts_by_severity.length === 0 ? (
            <DataStatus text="No alerts in the window." />
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={data.alerts_by_severity}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="severity" fontSize={11} />
                <YAxis allowDecimals={false} fontSize={11} />
                <Tooltip />
                <Legend />
                <Bar dataKey="official" name="Official" fill="#1d4ed8" />
                <Bar dataKey="ai_generated" name="AI (PROPOSED)" fill="#f59e0b" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title="Citizen incidents (recent)" subtitle="Count by category — UNVERIFIED until operator review">
          {data.incidents_by_category.length === 0 ? (
            <DataStatus text="No citizen reports yet." />
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={data.incidents_by_category}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="category" fontSize={11} />
                <YAxis allowDecimals={false} fontSize={11} />
                <Tooltip />
                <Legend />
                <Bar dataKey="count" name="Reports" fill="#0f766e" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title="Rescue requests pipeline" subtitle="SUBMITTED → RECEIVED → ASSIGNED → EN_ROUTE → SERVED · never auto-dispatched">
          {data.rescue_by_status.length === 0 ? (
            <DataStatus text="No rescue requests yet." />
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={data.rescue_by_status}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="status" fontSize={11} />
                <YAxis allowDecimals={false} fontSize={11} />
                <Tooltip />
                <Legend />
                <Bar dataKey="count" name="Requests" fill="#b91c1c" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title="Documented extreme-rainfall events" subtitle="Published ARI rainfall from validated history (/validation/report endpoint workbook)">
          {data.historical_rainfall_comparison.length === 0 ? (
            <DataStatus text="Historical validation events not loaded." />
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={data.historical_rainfall_comparison} layout="vertical" margin={{ left: 150 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" unit=" mm" fontSize={11} />
                <YAxis type="category" dataKey="event" fontSize={10} width={160} />
                <Tooltip
                  formatter={(v: unknown) => [`${v} mm`, 'Documented rainfall']}
                  labelFormatter={(v) => {
                    const pt = data.historical_rainfall_comparison.find(p => p.event === v);
                    return pt ? `${pt.location} · ${pt.year ?? 'year n/a'}` : String(v);
                  }}
                />
                <Bar dataKey="documented_ari_mm" name="Documented 24 h rainfall" fill="#4f46e5" />
              </BarChart>
            </ResponsiveContainer>
          )}
          <div className="river-marks-note">
            These events are documented reference marker values for flood-engine validation — they are not a current forecast.
          </div>
        </ChartCard>

        <ChartCard title="Data source freshness" subtitle="Age of most recent successful pull from each live source">
          {data.source_freshness.length === 0 ? (
            <DataStatus text="No live sources configured." />
          ) : (
            <div className="freshness-table">
              <table>
                <thead>
                  <tr><th>Source</th><th>Type</th><th>Status</th><th>Age of last success</th></tr>
                </thead>
                <tbody>
                  {data.source_freshness.map(s => (
                    <tr key={s.source}>
                      <td>{s.source}</td>
                      <td>{s.type}</td>
                      <td className={s.status === 'UNAVAILABLE' ? 'fresh-stale' : 'fresh-ok'}>{s.status}</td>
                      <td>{s.age_hours_success != null ? `${s.age_hours_success.toFixed(1)} h` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </ChartCard>
      </div>
    </div>
  );
}

