import React, { useState, useMemo } from 'react';
import {
  RefreshCw, Moon, Sun, ChevronRight, Filter, Waves, Clock
} from 'lucide-react';
import {
  LocationItem, PredictionItem, AlertItem, ShelterItem,
  IncidentReportItem, DataSourceItem, UserRole, Language
} from '../../types';
import { SeverityBadge } from './SeverityBadge';
import { TruthBar } from './TruthBar';
import { MapView } from '../MapView';
import { LiveNewsFeed } from '../LiveNewsFeed';

interface CommandDashboardProps {
  locations: LocationItem[];
  predictions: PredictionItem[];
  alerts: AlertItem[];
  shelters: ShelterItem[];
  reports: IncidentReportItem[];
  dataSources: DataSourceItem[];
  lang: Language;
  userRole: UserRole;
  setUserRole: (role: UserRole) => void;
  nightOps: boolean;
  setNightOps: (on: boolean) => void;
  onSelectLocation: (loc: LocationItem) => void;
  onNavigateTab: (tab: string) => void;
  onRefresh: () => void;
}

export const CommandDashboard: React.FC<CommandDashboardProps> = ({
  locations,
  predictions,
  alerts,
  shelters,
  reports,
  dataSources,
  lang: _lang,
  setUserRole: _setUserRole,
  nightOps,
  setNightOps,
  onSelectLocation,
  onNavigateTab,
  onRefresh
}) => {
  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [stateFilter, setStateFilter] = useState('ALL');
  const [hazardFilter, setHazardFilter] = useState('ALL');
  const [severityFilter, setSeverityFilter] = useState('ALL');
  const [hideStale, setHideStale] = useState(false);
  const [rightTab, setRightTab] = useState<'RISKS' | 'ALERTS' | 'NEWS'>('RISKS');

  // Compute metrics
  const proposedAlerts = alerts.filter(a => a.lifecycle_status === 'PROPOSED');
  const criticalPredictions = predictions.filter(p => p.risk_category === 'CRITICAL');
  const highOrCriticalPredictions = predictions.filter(p => p.risk_category === 'HIGH' || p.risk_category === 'CRITICAL');
  const simulationActive = alerts.some(a => a.simulation_flag) || predictions.some(p => p.simulation_flag);

  // Ranked Top Risks list
  const rankedRisks = useMemo(() => {
    return locations
      .map(loc => {
        const flood = predictions.find(p => p.location_id === loc.id && p.hazard_type === 'FLOOD');
        const land = predictions.find(p => p.location_id === loc.id && p.hazard_type === 'LANDSLIDE');

        const floodProb = flood?.probability ?? null;
        const landProb = land?.probability ?? null;
        const availableProbabilities = [floodProb, landProb].filter((value): value is number => value != null);
        const maxProb = availableProbabilities.length ? Math.max(...availableProbabilities) : null;
        const score = maxProb == null ? null : Math.round(maxProb * 100);

        let severity: 'CRITICAL' | 'HIGH' | 'MODERATE' | 'LOW' | 'UNKNOWN' = 'UNKNOWN';
        const categories = [flood?.risk_category, land?.risk_category];
        if (categories.includes('CRITICAL') || (score != null && score >= 85)) severity = 'CRITICAL';
        else if (categories.includes('HIGH') || (score != null && score >= 65)) severity = 'HIGH';
        else if (categories.includes('MODERATE') || (score != null && score >= 40)) severity = 'MODERATE';
        else if (categories.includes('LOW') || score != null) severity = 'LOW';

        const isStale = (flood?.data_quality_status === 'STALE') || (land?.data_quality_status === 'STALE');
        const primary = floodProb == null && landProb == null ? 'Unknown' : (floodProb ?? -1) >= (landProb ?? -1) ? 'Flood' : 'Landslide';

        return {
          location: loc,
          score,
          severity,
          primary,
          isStale,
          flood,
          land
        };
      })
      .filter(item => {
        if (stateFilter !== 'ALL' && item.location.state !== stateFilter) return false;
        if (hazardFilter !== 'ALL' && item.primary.toUpperCase() !== hazardFilter) return false;
        if (severityFilter !== 'ALL' && item.severity !== severityFilter) return false;
        if (hideStale && item.isStale) return false;
        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase();
          const matchName = item.location.name.toLowerCase().includes(q);
          const matchDist = item.location.district.toLowerCase().includes(q);
          const matchState = item.location.state.toLowerCase().includes(q);
          if (!matchName && !matchDist && !matchState) return false;
        }
        return true;
      })
      .sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  }, [locations, predictions, stateFilter, hazardFilter, severityFilter, hideStale, searchQuery]);

  return (
    <div className="space-y-3 font-sans">
      {/* 1. Dashboard controls */}
      <div className="flex justify-end gap-3 text-[11px]">
        <div className="flex items-center gap-3 text-slate-600">
          <button onClick={onRefresh} className="flex items-center gap-1 rounded bg-white px-2 py-1 hover:bg-slate-100" aria-label="Refresh dashboard data">
            <RefreshCw className="w-3 h-3" /> Refresh data
          </button>
          <button
            onClick={() => setNightOps(!nightOps)}
            className="flex items-center gap-1 bg-white/10 hover:bg-white/20 px-2 py-0.5 rounded text-white transition cursor-pointer"
            title="Toggle Night Ops High Contrast Dark Mode"
          >
            {nightOps ? <Sun className="w-3 h-3 text-amber-300" /> : <Moon className="w-3 h-3 text-cyan-300" />}
            <span>{nightOps ? 'Day View' : 'Night Ops'}</span>
          </button>
        </div>
      </div>

      {/* 2. 4-Card KPI Strip: "What needs me right now?" */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
        {/* Metric 1: Critical Risks */}
        <div
          onClick={() => { setSeverityFilter('CRITICAL'); }}
          className="bg-white border-l-4 border-red-600 rounded-xl p-3 shadow-sm border border-slate-200 cursor-pointer hover:shadow transition"
        >
          <div className="flex justify-between items-start">
            <span className="text-[11px] font-bold text-slate-500 uppercase">Critical Risks</span>
            <span className="text-red-600 text-sm pulse-critical font-black">⬣</span>
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-2xl font-black font-reading text-slate-900">
              {criticalPredictions.length}
            </span>
            <span className="text-[10px] font-bold text-red-600 bg-red-50 px-1.5 py-0.5 rounded">
              URGENT
            </span>
          </div>
          <p className="text-[10.5px] text-slate-500 mt-1 truncate">
            From available assessments
          </p>
        </div>

        {/* Metric 2: Awaiting Review Timer */}
        <div
          onClick={() => onNavigateTab('alerts')}
          className="bg-white border-l-4 border-amber-500 rounded-xl p-3 shadow-sm border border-slate-200 cursor-pointer hover:shadow transition"
        >
          <div className="flex justify-between items-start">
            <span className="text-[11px] font-bold text-slate-500 uppercase">Awaiting Review</span>
            <Clock className="w-4 h-4 text-amber-500" />
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-2xl font-black font-reading text-slate-900">
              {proposedAlerts.length}
            </span>
            <span className="text-[10px] font-reading font-semibold text-amber-800 bg-amber-50 px-1.5 py-0.5 rounded">
              Review queue
            </span>
          </div>
          <p className="text-[10.5px] text-slate-500 mt-1 truncate">
            Review proposed notifications
          </p>
        </div>

        {/* Metric 3: Elevated High+ */}
        <div
          onClick={() => { setSeverityFilter('HIGH'); }}
          className="bg-white border-l-4 border-orange-500 rounded-xl p-3 shadow-sm border border-slate-200 cursor-pointer hover:shadow transition"
        >
          <div className="flex justify-between items-start">
            <span className="text-[11px] font-bold text-slate-500 uppercase">Elevated High+</span>
            <span className="text-orange-600 text-sm font-black">▲</span>
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-2xl font-black font-reading text-slate-900">
              {highOrCriticalPredictions.length}
            </span>
            <span className="text-[11px] text-slate-500">/ {locations.length} monitored</span>
          </div>
          <p className="text-[10.5px] text-slate-500 mt-1 truncate">
            From available assessments
          </p>
        </div>

        {/* Metric 4: CWC Stations */}
        <div
          onClick={() => onNavigateTab('mapboard')}
          className="bg-white border-l-4 border-teal-600 rounded-xl p-3 shadow-sm border border-slate-200 cursor-pointer hover:shadow transition"
        >
          <div className="flex justify-between items-start">
            <span className="text-[11px] font-bold text-slate-500 uppercase">CWC River Stages</span>
            <Waves className="w-4 h-4 text-teal-600" />
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-2xl font-black font-reading text-slate-900">{dataSources.filter(source => source.source_type === 'CWC' && source.status === 'OPERATIONAL').length}</span>
            <span className="text-[10px] font-bold text-teal-800 bg-teal-50 px-1.5 py-0.5 rounded">Feed status</span>
          </div>
          <p className="text-[10.5px] text-slate-500 mt-1 truncate">
            Operational CWC feeds; check station timestamps
          </p>
        </div>
      </div>

      {/* 3. Signature Feature: The Data Truth Bar */}
      <TruthBar dataSources={dataSources} simulationActive={simulationActive} />

      {/* 4. Operator Workspace: Left Filters + Center Map + Right Top Risks */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 items-start">
        {/* Left Floating/Collapsible Filters (3 cols) */}
        <div className="lg:col-span-3 space-y-2.5 transition-all">
          <div className="bg-white border border-slate-200 rounded-xl p-3.5 shadow-sm space-y-3">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <span className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                <Filter className="w-3.5 h-3.5 text-teal-700" />
                Operational Filters
              </span>
              <button
                onClick={() => { setStateFilter('ALL'); setHazardFilter('ALL'); setSeverityFilter('ALL'); setHideStale(false); setSearchQuery(''); }}
                className="text-[10px] font-bold text-teal-700 hover:underline"
              >
                Reset
              </button>
            </div>

            {/* State filter */}
            <div>
              <label className="text-[11px] font-bold text-slate-600 block mb-1">State Catchment</label>
              <select
                value={stateFilter}
                onChange={e => setStateFilter(e.target.value)}
                className="w-full text-xs font-medium p-2 rounded-lg border border-slate-200 bg-slate-50 focus:outline-none focus:ring-1 focus:ring-teal-600"
              >
                <option value="ALL">All 8 Northeast States (NER)</option>
                {["Assam", "Arunachal Pradesh", "Meghalaya", "Manipur", "Mizoram", "Nagaland", "Tripura", "Sikkim"].map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>

            {/* Hazard filter */}
            <div>
              <label className="text-[11px] font-bold text-slate-600 block mb-1">Hazard Type</label>
              <div className="grid grid-cols-3 gap-1">
                {(['ALL', 'FLOOD', 'LANDSLIDE'] as const).map(h => (
                  <button
                    key={h}
                    onClick={() => setHazardFilter(h)}
                    className={`py-1 text-[10px] font-bold rounded-md border transition ${
                      hazardFilter === h
                        ? 'bg-teal-700 text-white border-teal-700'
                        : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    {h === 'ALL' ? 'All' : h === 'FLOOD' ? '🌊 Flood' : '⛰ Land'}
                  </button>
                ))}
              </div>
            </div>

            {/* Severity filter */}
            <div>
              <label className="text-[11px] font-bold text-slate-600 block mb-1">Severity Level</label>
              <div className="grid grid-cols-2 gap-1">
                {[
                  { id: 'ALL', label: 'All Levels', shape: '' },
                  { id: 'CRITICAL', label: 'Critical', shape: '⬣' },
                  { id: 'HIGH', label: 'High', shape: '▲' },
                  { id: 'MODERATE', label: 'Moderate', shape: '◆' }
                ].map(s => (
                  <button
                    key={s.id}
                    onClick={() => setSeverityFilter(s.id)}
                    className={`py-1 px-1.5 text-[10px] font-bold rounded-md border text-left flex items-center gap-1 transition ${
                      severityFilter === s.id
                        ? 'bg-slate-800 text-white border-slate-800'
                        : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    {s.shape && <span className="text-[11px]">{s.shape}</span>}
                    <span>{s.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Hide Stale Toggle */}
            <div className="pt-2 border-t border-slate-100">
              <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={hideStale}
                  onChange={e => setHideStale(e.target.checked)}
                  className="rounded border-slate-300 text-teal-600 focus:ring-teal-500"
                />
                <span>Hide stale telemetry feeds</span>
              </label>
            </div>
          </div>
        </div>

        {/* Center Interactive Map (6 cols) */}
        <div className="lg:col-span-6 space-y-2">
          <MapView
            locations={locations}
            predictions={predictions}
            alerts={alerts}
            shelters={shelters}
            reports={reports}
            lang={_lang}
            onSelectLocation={onSelectLocation}
          />
        </div>

        {/* Right Top Risks & Live Feeds Panel (3 cols) */}
        <div className="lg:col-span-3 space-y-2.5">
          <div className="bg-white border border-slate-200 rounded-xl p-3.5 shadow-sm flex flex-col h-[640px]">
            {/* Header Tabs: Top Risks vs Alerts vs News */}
            <div className="flex items-center justify-between border-b border-slate-200 pb-2 mb-2.5">
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setRightTab('RISKS')}
                  className={`px-2 py-1 text-[11px] font-bold rounded-md transition ${
                    rightTab === 'RISKS'
                      ? 'bg-teal-700 text-white shadow-sm'
                      : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  Top Risks ({rankedRisks.length})
                </button>
                <button
                  onClick={() => setRightTab('ALERTS')}
                  className={`px-2 py-1 text-[11px] font-bold rounded-md transition ${
                    rightTab === 'ALERTS'
                      ? 'bg-teal-700 text-white shadow-sm'
                      : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  Alerts ({alerts.length})
                </button>
                <button
                  onClick={() => setRightTab('NEWS')}
                  className={`px-2 py-1 text-[11px] font-bold rounded-md transition ${
                    rightTab === 'NEWS'
                      ? 'bg-teal-700 text-white shadow-sm'
                      : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  News
                </button>
              </div>
            </div>

            {/* Tab 1: Top Risks List */}
            {rightTab === 'RISKS' && (
              <div className="flex-1 overflow-y-auto space-y-1.5 pr-0.5">
                {rankedRisks.map((item, idx) => (
                  <div
                    key={item.location.id}
                    onClick={() => onSelectLocation(item.location)}
                    className="p-2 rounded-lg border border-slate-100 hover:border-teal-300 hover:bg-teal-50/40 transition cursor-pointer flex items-center justify-between text-xs group"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-reading text-[10px] font-black text-slate-400 w-4">
                        {idx + 1}
                      </span>
                      <div className="min-w-0">
                        <div className="font-bold text-slate-900 group-hover:text-teal-900 truncate">
                          {item.location.name}
                        </div>
                        <div className="text-[10px] text-slate-500 truncate">
                          {item.location.district}, {item.location.state}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <SeverityBadge level={item.severity} score={item.score} size="sm" />
                      <ChevronRight className="w-3.5 h-3.5 text-slate-300 group-hover:text-teal-600" />
                    </div>
                  </div>
                ))}

                {rankedRisks.length === 0 && (
                  <div className="text-center py-8 text-xs text-slate-400">
                    No locations match the active filters.
                  </div>
                )}
              </div>
            )}

            {/* Tab 2: Alerts Quick List */}
            {rightTab === 'ALERTS' && (
              <div className="flex-1 overflow-y-auto space-y-2 pr-0.5">
                {alerts.map(a => (
                  <div
                    key={a.id}
                    onClick={() => onNavigateTab('alerts')}
                    className="p-2.5 rounded-lg border border-slate-200 hover:border-blue-400 bg-slate-50 transition cursor-pointer text-xs space-y-1"
                  >
                    <div className="flex justify-between items-start">
                      <SeverityBadge level={a.severity} size="sm" />
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                        a.lifecycle_status === 'PROPOSED' ? 'bg-amber-100 text-amber-800' :
                        a.lifecycle_status === 'ISSUED' ? 'bg-red-100 text-red-800' : 'bg-slate-200 text-slate-700'
                      }`}>
                        {a.lifecycle_status}
                      </span>
                    </div>
                    <div className="font-bold text-slate-900 mt-1">{a.title}</div>
                    <div className="text-[11px] text-slate-600 line-clamp-2">{a.description}</div>
                  </div>
                ))}
              </div>
            )}

            {/* Tab 3: Official News Feed */}
            {rightTab === 'NEWS' && (
              <div className="flex-1 overflow-y-auto">
                <LiveNewsFeed />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
