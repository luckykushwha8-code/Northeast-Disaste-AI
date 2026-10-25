import React, { useEffect, useState, Suspense, lazy } from 'react';
import { useSearchParams } from 'react-router-dom';
import { RefreshCw, List, Map as MapIcon, Filter, X } from 'lucide-react';

import { api } from '../../api/client';
import { StatCard } from '../../components/ui/StatCard';
import { DataModeBadge } from '../../components/ui/DataModeBadge';
import { Skeleton, SkeletonCard } from '../../components/ui/Skeleton';
import { ErrorState } from '../../components/ui/ErrorState';
import { EmptyState } from '../../components/ui/EmptyState';
import { TruthBar } from '../../components/designSystem/TruthBar';
import type {
  LocationItem, PredictionItem, AlertItem, ShelterItem,
  DataSourceItem, UserRole, Language
} from '../../types';

const MapView = lazy(() => import('../../components/MapView').then(m => ({ default: m.MapView })));
const LocationDetailModal = lazy(() => import('../../components/LocationDetailModal').then(m => ({ default: m.LocationDetailModal })));
const LiveNewsFeed = lazy(() => import('../../components/LiveNewsFeed').then(m => ({ default: m.LiveNewsFeed })));

const NE_STATES = [
  'ALL', 'Assam', 'Arunachal Pradesh', 'Meghalaya', 'Manipur',
  'Mizoram', 'Nagaland', 'Tripura', 'Sikkim',
];

const HAZARD_OPTIONS = ['BOTH', 'FLOOD', 'LANDSLIDE'] as const;
const SEVERITY_OPTIONS = ['ALL', 'CRITICAL', 'HIGH', 'MODERATE', 'LOW'] as const;
const MODE_OPTIONS = ['ALL', 'LIVE', 'CACHED', 'BASELINE', 'SIMULATED'] as const;

interface DashboardProps {
  userRole?: UserRole;
  lang?: Language;
}

export default function Dashboard({ userRole = 'OPERATOR', lang = 'en' }: DashboardProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<'map' | 'list'>('map');
  const [filtersOpen, setFiltersOpen] = useState(false);

  const [locations, setLocations] = useState<LocationItem[]>([]);
  const [predictions, setPredictions] = useState<PredictionItem[]>([]);
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [shelters, setShelters] = useState<ShelterItem[]>([]);
  const [dataSources, setDataSources] = useState<DataSourceItem[]>([]);
  const [rescueRequestCount, setRescueRequestCount] = useState<number | null>(null);
  const [selectedLocation, setSelectedLocation] = useState<LocationItem | null>(null);

  // Filters from URL
  const filterState = searchParams.get('state') ?? 'ALL';
  const filterHazard = searchParams.get('hazard') ?? 'BOTH';
  const filterSeverity = searchParams.get('severity') ?? 'ALL';
  const filterMode = searchParams.get('mode') ?? 'ALL';
  const hideStale = searchParams.get('hideStale') === '1';
  const showSimulated = searchParams.get('showSim') === '1';

  function updateFilter(key: string, value: string) {
    setSearchParams(prev => {
      const n = new URLSearchParams(prev);
      n.set(key, value);
      return n;
    });
  }

  function resetFilters() {
    setSearchParams({});
  }

  async function loadData() {
    setLoading(true);
    setError(null);
    try {
      const [locs, preds, alts, shels, sources] = await Promise.all([
        api.getLocations(),
        api.getPredictions(),
        api.getAlerts(),
        api.getShelters(),
        api.getDataStatus(),
      ]);
      setLocations(locs);
      setPredictions(preds);
      setAlerts(alts);
      setShelters(shels);
      setDataSources(sources);
      try {
        const requests = await api.listRescueRequests();
        setRescueRequestCount(requests.filter(r => !['CLOSED', 'SERVED', 'UNREACHABLE'].includes(r.status)).length);
      } catch {
        setRescueRequestCount(null);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load dashboard data');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadData(); }, []);

  // KPI computations
  const isSimulationActive = alerts.some(a => a.simulation_flag) || predictions.some(p => p.simulation_flag);

  const criticalAlerts = alerts.filter(a =>
    a.severity === 'CRITICAL' &&
    (showSimulated || !a.simulation_flag) &&
    (a.lifecycle_status === 'ISSUED' || a.lifecycle_status === 'PROPOSED')
  );

  const proposedAlerts = alerts.filter(a =>
    a.lifecycle_status === 'PROPOSED' && (showSimulated || !a.simulation_flag)
  );

  const proposedIssuedTimes = proposedAlerts
    .map(alert => alert.issued_at ? new Date(alert.issued_at).getTime() : NaN)
    .filter(Number.isFinite);
  const oldestProposedMin = proposedIssuedTimes.length > 0
    ? Math.max(0, Math.floor((Date.now() - Math.min(...proposedIssuedTimes)) / 60000))
    : null;

  const usablePredictions = predictions.filter(p => showSimulated || !p.simulation_flag);
  const highPlusLocations = usablePredictions.filter(p =>
    p.risk_category === 'HIGH' || p.risk_category === 'CRITICAL'
  );

  const highPlusFloodAssessments = usablePredictions.filter(p =>
    p.hazard_type === 'FLOOD' &&
    (p.risk_category === 'HIGH' || p.risk_category === 'CRITICAL')
  );

  const liveCount = dataSources.filter(d => d.status === 'OPERATIONAL').length;
  const feedHealthLabel = dataSources.length > 0 ? `${liveCount}/${dataSources.length}` : 'N/A';

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  if (error) {
    return <ErrorState message={error} onRetry={loadData} />;
  }

  return (
    <div className="space-y-4">
      {/* Editorial Title & Sync Badge */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-200 pb-3">
        <div>
          <h1 className="font-serif text-2xl sm:text-3xl font-medium text-slate-900 tracking-tight">
            Northeast hazard overview
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Source-labelled rainfall, flood and landslide information across the eight Northeast states.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={loadData} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50" aria-label="Refresh dashboard data">
            <RefreshCw className="h-3.5 w-3.5" /> Refresh data
          </button>
        </div>
      </div>

      {/* KPI Cards Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard
          value={criticalAlerts.length}
          label="Critical Alerts"
          dataMode="UNAVAILABLE"
          className="border-red-200"
        />
        <StatCard
          value={proposedAlerts.length}
          label={`Proposed Alerts${oldestProposedMin != null ? ` (oldest ${oldestProposedMin}m)` : ''}`}
          dataMode="UNAVAILABLE"
          className={proposedAlerts.length > 0 ? 'border-amber-300' : ''}
        />
        <StatCard
          value={highPlusLocations.length}
          label="High+ risk assessments"
          dataMode="BASELINE"
        />
        <StatCard
          value={highPlusFloodAssessments.length}
          label="High+ flood assessments"
          dataMode="BASELINE"
        />
        <StatCard
          value={rescueRequestCount ?? 'N/A'}
          label="Open Rescue Requests"
          dataMode={rescueRequestCount == null ? 'UNAVAILABLE' : 'BASELINE'}
        />
        <StatCard
          value={feedHealthLabel}
          label="Feeds operational"
          dataMode={dataSources.length > 0 ? 'BASELINE' : 'UNAVAILABLE'}
        />
      </div>

      {/* TruthBar */}
      <TruthBar dataSources={dataSources} simulationActive={isSimulationActive} />

      {/* Filter Panel + View Toggle */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <button
          onClick={() => setFiltersOpen(o => !o)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-white border border-slate-200 rounded-lg text-slate-700 hover:bg-slate-50 transition shadow-sm"
        >
          <Filter className="w-3.5 h-3.5" />
          Filters
          {(filterState !== 'ALL' || filterHazard !== 'BOTH' || filterSeverity !== 'ALL') && (
            <span className="ml-1 w-4 h-4 bg-teal-600 text-white text-[9px] font-bold rounded-full flex items-center justify-center">!</span>
          )}
        </button>

        <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-lg p-0.5 shadow-sm">
          <button
            onClick={() => setView('map')}
            className={`p-1.5 rounded-md transition text-xs ${view === 'map' ? 'bg-teal-600 text-white' : 'text-slate-500 hover:bg-slate-50'}`}
            aria-label="Map view"
          >
            <MapIcon className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setView('list')}
            className={`p-1.5 rounded-md transition text-xs ${view === 'list' ? 'bg-teal-600 text-white' : 'text-slate-500 hover:bg-slate-50'}`}
            aria-label="List view"
          >
            <List className="w-3.5 h-3.5" />
          </button>
        </div>

        <button
          onClick={loadData}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-white border border-slate-200 rounded-lg text-slate-700 hover:bg-slate-50 transition shadow-sm"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Refresh
        </button>
      </div>

      {/* Expanded Filters */}
      {filtersOpen && (
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-700">Filters</span>
            <button onClick={() => { resetFilters(); setFiltersOpen(false); }} className="text-xs text-teal-700 hover:underline flex items-center gap-1">
              <X className="w-3 h-3" /> Reset all
            </button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
            <div>
              <label className="block text-[10px] font-semibold text-slate-500 mb-1">State</label>
              <select value={filterState} onChange={e => updateFilter('state', e.target.value)} className="w-full text-xs border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none">
                {NE_STATES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-slate-500 mb-1">Hazard</label>
              <select value={filterHazard} onChange={e => updateFilter('hazard', e.target.value)} className="w-full text-xs border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none">
                {HAZARD_OPTIONS.map(h => <option key={h} value={h}>{h}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-slate-500 mb-1">Severity</label>
              <select value={filterSeverity} onChange={e => updateFilter('severity', e.target.value)} className="w-full text-xs border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none">
                {SEVERITY_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-slate-500 mb-1">Data Mode</label>
              <select value={filterMode} onChange={e => updateFilter('mode', e.target.value)} className="w-full text-xs border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none">
                {MODE_OPTIONS.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-2">
              <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer">
                <input type="checkbox" checked={hideStale} onChange={e => updateFilter('hideStale', e.target.checked ? '1' : '0')} className="rounded" />
                Hide Stale
              </label>
              <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer">
                <input type="checkbox" checked={showSimulated} onChange={e => updateFilter('showSim', e.target.checked ? '1' : '0')} className="rounded" />
                Show Simulated
              </label>
            </div>
          </div>
        </div>
      )}

      {/* Map / List View */}
      <div className="flex gap-4">
        <div className="flex-1 min-w-0">
          {view === 'map' ? (
            <Suspense fallback={<Skeleton className="h-96 w-full rounded-xl" />}>
              <MapView
                locations={locations}
                predictions={predictions}
                alerts={alerts}
                shelters={shelters}
                reports={[]}
                lang={lang}
                onSelectLocation={setSelectedLocation}
              />
            </Suspense>
          ) : (
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              {predictions.length === 0 ? (
                <EmptyState title="No risk data" description="No predictions available for the selected filters." />
              ) : (
                <div className="divide-y divide-slate-100">
                  {predictions.slice(0, 30).map(p => {
                    const loc = locations.find(l => l.id === p.location_id);
                    return (
                      <div key={p.id} className="flex items-center justify-between px-4 py-2.5 hover:bg-slate-50 transition">
                        <div>
                          <span className="text-xs font-semibold text-slate-800">{p.location_name ?? loc?.name ?? p.location_id}</span>
                          <span className="text-[10px] text-slate-500 ml-2">{p.hazard_type}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <DataModeBadge
                            mode={
                              p.data_quality_status === 'VALID' ? 'LIVE' :
                              p.data_quality_status === 'STALE' || p.data_quality_status === 'DELAYED' ? 'CACHED' :
                              p.data_quality_status === 'SIMULATED' ? 'SIMULATED' : 'BASELINE'
                            }
                            size="sm"
                          />
                          <span className={`text-xs font-bold ${
                            p.risk_category === 'CRITICAL' ? 'text-red-700' :
                            p.risk_category === 'HIGH' ? 'text-orange-700' :
                            p.risk_category === 'MODERATE' ? 'text-yellow-700' : 'text-green-700'
                          }`}>
                            {p.risk_category}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right Panel: Tabs */}
        <div className="hidden xl:block w-80 flex-shrink-0 space-y-4">
          <RightPanel alerts={alerts} predictions={predictions} showSimulated={showSimulated} />
        </div>
      </div>

      {/* Operator Awaiting Decision Triage Table */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-3">
        <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
          <h3 className="font-serif text-lg font-medium text-slate-900">
            Awaiting your decision
          </h3>
          <span className="text-xs font-semibold text-slate-500">
            {proposedAlerts.length} AI proposals pending review
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500 text-xs text-left">
                <th className="py-2 px-3">Place</th>
                <th className="py-2 px-3">Hazard</th>
                <th className="py-2 px-3">Source</th>
                <th className="py-2 px-3">Waiting</th>
                <th className="py-2 px-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {proposedAlerts.slice(0, 5).map(a => (
                <tr key={a.id} className="hover:bg-slate-50 transition">
                  <td className="py-2.5 px-3 font-semibold text-slate-800">{a.location_name}</td>
                  <td className="py-2.5 px-3">
                    <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">
                      {a.hazard_type}
                    </span>
                  </td>
                  <td className="py-2.5 px-3 text-xs text-slate-600">
                    {a.official_source_reference ? `Official (${a.official_source_reference})` : 'AI Proposal, awaiting review'}
                  </td>
                  <td className="py-2.5 px-3 text-xs text-slate-500 font-mono">
                    {a.issued_at && Number.isFinite(new Date(a.issued_at).getTime()) ? `${Math.max(0, Math.floor((Date.now() - new Date(a.issued_at).getTime()) / 60000))} min` : 'Time unavailable'}
                  </td>
                  <td className="py-2.5 px-3 text-right">
                    <button
                      onClick={() => {
                        const loc = locations.find(l => l.id === a.location_id);
                        if (loc) setSelectedLocation(loc);
                      }}
                      className="px-3 py-1 rounded-md border border-slate-300 text-xs font-semibold text-slate-800 hover:bg-slate-100 transition"
                    >
                      Review
                    </button>
                  </td>
                </tr>
              ))}
              {proposedAlerts.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-6 text-center text-xs text-slate-400">
                    No proposals currently awaiting review. All alerts verified.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Live News */}
      <Suspense fallback={null}>
        <LiveNewsFeed />
      </Suspense>

      {/* Location Detail Modal */}
      {selectedLocation && (
        <Suspense fallback={null}>
          <LocationDetailModal
            location={selectedLocation}
            onClose={() => setSelectedLocation(null)}
            lang={lang}
          />
        </Suspense>
      )}
    </div>
  );
}

// Right panel: Top Risks | Latest Alerts | Live News tabs
function RightPanel({
  alerts,
  predictions,
  showSimulated,
}: {
  alerts: AlertItem[];
  predictions: PredictionItem[];
  showSimulated: boolean;
}) {
  const [tab, setTab] = useState<'risks' | 'alerts'>('risks');

  const topRisks = predictions
    .filter(p => showSimulated || !p.simulation_flag)
    .sort((a, b) => {
      const order = { CRITICAL: 4, HIGH: 3, MODERATE: 2, LOW: 1, UNAVAILABLE: 0 };
      return (order[b.risk_category] ?? 0) - (order[a.risk_category] ?? 0);
    })
    .slice(0, 10);

  const latestAlerts = alerts
    .filter(a => showSimulated || !a.simulation_flag)
    .sort((a, b) => new Date(b.issued_at ?? 0).getTime() - new Date(a.issued_at ?? 0).getTime())
    .slice(0, 10);

  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
      <div className="flex border-b border-slate-100">
        {(['risks', 'alerts'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-2.5 text-xs font-semibold transition ${tab === t ? 'text-teal-700 border-b-2 border-teal-600 bg-teal-50/50' : 'text-slate-500 hover:text-slate-700'}`}
          >
            {t === 'risks' ? 'Top Risks' : 'Latest Alerts'}
          </button>
        ))}
      </div>

      <div className="max-h-96 overflow-y-auto divide-y divide-slate-100">
        {tab === 'risks' && (
          topRisks.length === 0
            ? <EmptyState title="No risk data" />
            : topRisks.map(p => (
              <div key={p.id} className="px-3 py-2 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-slate-800 truncate">{p.location_name ?? p.location_id}</p>
                  <p className="text-[10px] text-slate-400">{p.hazard_type}</p>
                </div>
                <span className={`text-xs font-bold flex-shrink-0 ${
                  p.risk_category === 'CRITICAL' ? 'text-red-700' :
                  p.risk_category === 'HIGH' ? 'text-orange-700' :
                  p.risk_category === 'MODERATE' ? 'text-yellow-700' : 'text-green-700'
                }`}>{p.risk_category}</span>
              </div>
            ))
        )}
        {tab === 'alerts' && (
          latestAlerts.length === 0
            ? <EmptyState title="No alerts" />
            : latestAlerts.map(a => (
              <div key={a.id} className="px-3 py-2">
                <p className="text-xs font-semibold text-slate-800 truncate">{a.title}</p>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className={`text-[10px] font-bold ${
                    a.severity === 'CRITICAL' ? 'text-red-700' :
                    a.severity === 'HIGH' ? 'text-orange-700' :
                    a.severity === 'MODERATE' ? 'text-yellow-700' : 'text-green-700'
                  }`}>{a.severity}</span>
                  <span className="text-[10px] text-slate-400">{a.lifecycle_status}</span>
                </div>
              </div>
            ))
        )}
      </div>
    </div>
  );
}
