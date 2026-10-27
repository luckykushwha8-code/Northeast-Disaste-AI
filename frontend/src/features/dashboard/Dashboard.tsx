import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, CloudRain, RefreshCw, ShieldAlert, Waves } from 'lucide-react';
import { api } from '../../api/client';
import { useVisibleRefresh } from '../../hooks/useVisibleRefresh';
import { DistrictRiskMap, type DistrictSummary } from './DistrictRiskMap';
import { LiveWeatherCard } from '../../components/LiveWeatherCard';

type Feed = { name: string; status: string; last_success_at?: string | null };
type Overview = { engine: string; generated_at: string; districts: DistrictSummary[] };

function riskRank(value: string) {
  return ({ CRITICAL: 4, HIGH: 3, MODERATE: 2, LOW: 1 } as Record<string, number>)[value] ?? 0;
}

function readableTime(value?: string | null) {
  if (!value) return 'No recent successful sync';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Time unavailable' : date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

function selectedRisk(district: DistrictSummary | null) {
  if (!district) return 'UNKNOWN';
  const flood = district.flood_risk?.risk_category ?? 'UNKNOWN';
  const landslide = district.landslide_risk?.risk_category ?? 'UNKNOWN';
  return riskRank(flood) >= riskRank(landslide) ? flood : landslide;
}

export default function Dashboard() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [apiOnline, setApiOnline] = useState(false);
  const [lastChecked, setLastChecked] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState('ALL');
  const [districtId, setDistrictId] = useState('');

  const refresh = useCallback(async () => {
    const [health, summary, status] = await Promise.allSettled([
      api.getHealth(), api.getMapDistricts(), api.getDataStatus()
    ]);
    const healthOk = health.status === 'fulfilled';
    setApiOnline(healthOk);
    setLastChecked(new Date().toISOString());
    if (summary.status === 'fulfilled') {
      const next = summary.value as Overview;
      setOverview(next);
      setError(null);
      setDistrictId(current => current && next.districts.some(item => `${item.state}:${item.district}` === current)
        ? current
        : next.districts[0] ? `${next.districts[0].state}:${next.districts[0].district}` : '');
    } else {
      setError(summary.reason instanceof Error ? summary.reason.message : 'District data is unavailable');
    }
    if (status.status === 'fulfilled') setFeeds(status.value as Feed[]);
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);
  useVisibleRefresh(refresh, 60_000);

  const states = useMemo(() => [...new Set((overview?.districts ?? []).map(item => item.state).filter((item): item is string => Boolean(item)))].sort(), [overview]);
  const visibleDistricts = useMemo(() => (overview?.districts ?? [])
    .filter(item => state === 'ALL' || item.state === state)
    .sort((a, b) => a.district.localeCompare(b.district)), [overview, state]);
  const selected = overview?.districts.find(item => `${item.state}:${item.district}` === districtId) ?? visibleDistricts[0] ?? null;
  const activeWarnings = overview?.districts.reduce((total, item) => total + (item.official_warning_count ?? 0), 0) ?? 0;
  const freshRainfall = overview?.districts.filter(item => item.rainfall_status === 'FRESH').length ?? 0;
  const connectedFeeds = feeds.filter(item => item.status === 'OPERATIONAL').length;

  return (
    <section className="mx-auto max-w-[1500px] space-y-5" aria-label="Northeast India district dashboard">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          <p className="mb-1 text-[11px] font-bold uppercase tracking-[0.16em] text-[#806047]">Geo Shield · Situation monitor</p>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">District overview</h1>
          <p className="mt-1 text-sm text-slate-500">Live API data and district level rainfall and risk summaries across Northeast India.</p>
        </div>
        <button onClick={() => { setLoading(true); void refresh(); }} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-teal-600 hover:text-teal-800" aria-label="Refresh live dashboard">
          <RefreshCw className="h-4 w-4" /> Refresh data
        </button>
      </header>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-slate-600" role="status">
        <span className={`inline-flex items-center gap-2 font-semibold ${apiOnline ? 'text-emerald-700' : 'text-rose-700'}`}>
          <span className={`h-2 w-2 rounded-full ${apiOnline ? 'bg-emerald-500' : 'bg-rose-500'}`} />
          {apiOnline ? 'Backend connected' : 'Backend unavailable'}
        </span>
        <span>Last check: {readableTime(lastChecked)}</span>
        {overview?.generated_at && <span>District data: {readableTime(overview.generated_at)}</span>}
        <span>Page checks API every minute while visible</span>
      </div>

      {error && <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">{error}. The map only shows the latest data that loaded successfully.</div>}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric icon={<Activity className="h-4 w-4" />} label="Districts covered" value={overview?.districts.length ?? '—'} note="District summary records" tone="teal" />
        <Metric icon={<ShieldAlert className="h-4 w-4" />} label="Official warnings" value={activeWarnings} note="From district summaries" tone={activeWarnings ? 'amber' : 'slate'} />
        <Metric icon={<CloudRain className="h-4 w-4" />} label="Fresh rainfall" value={`${freshRainfall} / ${overview?.districts.length ?? '—'}`} note="District observations" tone="blue" />
        <Metric icon={<Waves className="h-4 w-4" />} label="Operational feeds" value={`${connectedFeeds} / ${feeds.length || '—'}`} note="Backend source status" tone="teal" />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm" aria-label="District risk map">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">District risk map</h2>
              <p className="mt-0.5 text-xs text-slate-500">Select a district on the map or from the list.</p>
            </div>
            <div className="flex gap-2">
              <label className="sr-only" htmlFor="district-state">State</label>
              <select id="district-state" value={state} onChange={event => setState(event.target.value)} className="max-w-44 rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-xs text-slate-700">
                <option value="ALL">All states</option>{states.map(item => <option key={item} value={item}>{item}</option>)}
              </select>
              <label className="sr-only" htmlFor="district-choice">District</label>
              <select id="district-choice" value={selected ? `${selected.state}:${selected.district}` : ''} onChange={event => setDistrictId(event.target.value)} className="max-w-52 rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-xs text-slate-700">
                {visibleDistricts.map(item => <option key={`${item.state}:${item.district}`} value={`${item.state}:${item.district}`}>{item.district}{item.state ? ` · ${item.state}` : ''}</option>)}
              </select>
            </div>
          </div>
          <DistrictRiskMap districts={overview?.districts ?? []} state={state} selected={selected} onSelect={item => { setDistrictId(`${item.state}:${item.district}`); setState('ALL'); }} />
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-slate-200 px-4 py-3 text-[11px] text-slate-600">
            <span className="font-semibold text-slate-700">Risk level</span>
            <Legend color="#10b981" label="Low" /><Legend color="#f59e0b" label="Moderate" /><Legend color="#f97316" label="High" /><Legend color="#dc2626" label="Critical" /><Legend color="#94a3b8" label="No district assessment" />
          </div>
        </section>

        <aside className="space-y-4">
          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Selected district</p>
            {selected ? <>
              <h2 className="mt-1 text-xl font-semibold text-slate-900">{selected.district}</h2>
              <p className="text-sm text-slate-500">{selected.state}</p>
              <div className="mt-4 flex items-center justify-between border-y border-slate-100 py-3">
                <span className="text-sm text-slate-600">Highest assessed risk</span>
                <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${riskTone(selectedRisk(selected))}`}>{selectedRisk(selected)}</span>
              </div>
              <Detail label="24h rainfall" value={selected.observed_rainfall_24h ? `${selected.observed_rainfall_24h.value} ${selected.observed_rainfall_24h.unit}` : 'No observation'} />
              <Detail label="Rainfall freshness" value={selected.rainfall_status ?? 'UNKNOWN'} />
              <Detail label="River readings" value={String(selected.river_level_all_locations?.length ?? 0)} />
              <Detail label="Official warnings" value={String(selected.official_warning_count ?? 0)} />
              {selected.data_quality?.missing_inputs?.length > 0 && <p className="mt-3 text-xs leading-relaxed text-slate-500">Missing: {selected.data_quality.missing_inputs.join(', ')}</p>}
            </> : <p className="mt-3 text-sm text-slate-500">{loading ? 'Loading district data…' : 'No district data available.'}</p>}
          </section>
          {selected?.monitored_locations?.[0] && <LiveWeatherCard
            location={`${selected.district}, ${selected.state}`}
            locationId={selected.monitored_locations[0].id}
          />}

          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-900">Data feeds</h2>
              <span className="text-[11px] text-slate-500">{connectedFeeds} operational</span>
            </div>
            <ul className="mt-3 divide-y divide-slate-100">
              {feeds.slice(0, 5).map((feed, index) => <li key={`${feed.name}-${index}`} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0"><p className="truncate text-xs font-medium text-slate-700">{feed.name}</p><p className="mt-0.5 text-[10px] text-slate-400">Last successful sync: {readableTime(feed.last_success_at)}</p></div>
                <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-semibold ${feed.status === 'OPERATIONAL' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>{feed.status}</span>
              </li>)}
              {!feeds.length && <li className="py-3 text-xs text-slate-500">Feed status is unavailable.</li>}
            </ul>
          </section>
          <p className="px-1 text-[11px] leading-relaxed text-slate-500">Risk shading is a prototype assessment. Grey areas have no matched district assessment. Always check official warnings and observation freshness.</p>
        </aside>
      </div>
    </section>
  );
}

function Metric({ icon, label, value, note, tone }: { icon: React.ReactNode; label: string; value: React.ReactNode; note: string; tone: 'teal' | 'amber' | 'blue' | 'slate' }) {
  const colors = { teal: 'text-teal-700 bg-teal-50', amber: 'text-amber-700 bg-amber-50', blue: 'text-blue-700 bg-blue-50', slate: 'text-slate-600 bg-slate-100' };
  return <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
    <div className="flex items-center gap-2 text-xs font-medium text-slate-500"><span className={`rounded-md p-1.5 ${colors[tone]}`}>{icon}</span>{label}</div>
    <div className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">{value}</div>
    <p className="mt-1 text-[11px] text-slate-500">{note}</p>
  </div>;
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div className="flex items-center justify-between gap-3 border-b border-slate-100 py-2.5 text-xs"><span className="text-slate-500">{label}</span><span className="text-right font-medium text-slate-800">{value}</span></div>;
}

function Legend({ color, label }: { color: string; label: string }) {
  return <span className="inline-flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: color }} />{label}</span>;
}

function riskTone(risk: string) {
  return ({ CRITICAL: 'bg-red-100 text-red-800', HIGH: 'bg-orange-100 text-orange-800', MODERATE: 'bg-amber-100 text-amber-800', LOW: 'bg-emerald-100 text-emerald-800' } as Record<string, string>)[risk] ?? 'bg-slate-100 text-slate-600';
}
