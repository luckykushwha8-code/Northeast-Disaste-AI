import React, { useEffect, useState } from 'react';
import { DataSourceItem, AuditLogItem, LiveDataSyncItem, ImdApiStatus } from '../types';
import { api } from '../api/client';
import { Database, History, RefreshCw, Rss } from 'lucide-react';
import { TinyFishPanel } from './TinyFishPanel';

interface SystemHealthProps {
  dataSources?: DataSourceItem[];
  onRefresh: () => void;
}

export const SystemHealth: React.FC<SystemHealthProps> = ({ dataSources: initialDataSources, onRefresh }) => {
  const [dataSources, setDataSources] = useState<DataSourceItem[]>(initialDataSources ?? []);
  const [auditLogs, setAuditLogs] = useState<AuditLogItem[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<LiveDataSyncItem | null>(null);
  const [imdStatus, setImdStatus] = useState<ImdApiStatus | null>(null);
  const [imdSyncing, setImdSyncing] = useState(false);
  const [imdSyncNote, setImdSyncNote] = useState<string | null>(null);

  useEffect(() => {
    api.getDataStatus().then(setDataSources).catch((e) => console.error('Failed to fetch data source status', e));
    const fetchLogs = async () => {
      try {
        const logs = await api.getAuditLogs();
        setAuditLogs(logs);
      } catch (e) {
        console.error("Failed to fetch audit logs", e);
      }
    };
    fetchLogs();
    api.getImdApiStatus().then(setImdStatus).catch(() => setImdStatus(null));
  }, []);

  const runSync = async () => {
    setSyncing(true);
    try {
      const result = await api.syncLiveData();
      setSyncResult(result);
      onRefresh();
      const sources = await api.getDataStatus();
      setDataSources(sources);
      const logs = await api.getAuditLogs();
      setAuditLogs(logs);
    } catch (e) {
      console.error("Live data sync failed", e);
    } finally {
      setSyncing(false);
    }
  };

  const runImdRefresh = async () => {
    setImdSyncing(true);
    setImdSyncNote(null);
    try {
      const result = await api.runImdSync();
      const sources = await api.getDataStatus();
      setDataSources(sources);
      const rf = result?.rainfall ?? {};
      const of = result?.official_warnings ?? {};
      setImdSyncNote(
        `rainfall: ${rf.ingested ?? 0} ingested (${rf.data_mode})` +
        (rf.unmatched_districts?.length ? `, unmatched: ${rf.unmatched_districts.join(', ')}` : '') +
        ` · official warnings: ${of.alerts_created ?? 0} imported (${of.data_mode})`
      );
      api.getImdApiStatus().then(setImdStatus).catch(() => {});
      onRefresh();
    } catch (e) {
      setImdSyncNote(String(e instanceof Error ? e.message : e));
    } finally {
      setImdSyncing(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Live Data Sync Control */}
      <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm">
        <div className="flex items-center gap-2 mb-3">
          <Rss className="w-5 h-5 text-emerald-600" />
          <h3 className="text-sm font-bold text-slate-900">Live Government Data Sync</h3>
        </div>
        <p className="text-xs text-slate-500 mb-4">
          Pulls REAL data from official sources: CWC Flood Forecasting System telemetry
          (ffs.india-water.gov.in), IMD live bulletins (mausam.imd.gov.in), GSI Bhusanket
          landslide advisories, and verified Northeast news outlets. Ingested river levels
          feed the prediction engines.
        </p>

        <button
          onClick={runSync}
          disabled={syncing}
          className="flex items-center gap-2 text-xs font-bold px-4 py-2 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 transition"
        >
          <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
          {syncing ? 'Syncing live sources...' : 'Sync Live Government Data Now'}
        </button>

        {syncResult && (
          <div className="mt-4 text-xs bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-1">
            <div className="font-bold text-slate-800">Last sync: {new Date(syncResult.sync_completed_at).toLocaleTimeString()}</div>
            {Object.entries(syncResult.sources).map(([k, v]) => (
              <div key={k} className="flex items-center justify-between max-w-md">
                <span className="text-slate-600 font-medium">{k.replace(/_/g, ' ')}</span>
                <span className={`font-bold px-2 py-0.5 rounded ${
                  String(v).startsWith('ERROR') || v === 'UNAVAILABLE' ? 'bg-red-100 text-red-700' :
                  v === 'LIVE' ? 'bg-emerald-100 text-emerald-800' :
                  'bg-amber-100 text-amber-800'
                }`}>{String(v)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Environmental Feeds & Freshness Policy Table (FR-DATA-06) */}
      <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm">
        <div className="flex items-center gap-2 mb-3">
          <Database className="w-5 h-5 text-blue-600" />
          <h3 className="text-sm font-bold text-slate-900">Environmental Data Feeds & Freshness Status</h3>
        </div>
        <p className="text-xs text-slate-500 mb-4">
          Strict Policy (Rule R-02 & FR-DATA-05): Data feeds exceeding their expected refresh intervals are flagged as STALE or FAILED. Stale data is never represented as live data.
        </p>

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-xs">
            <thead className="bg-slate-50 text-slate-700 font-bold">
              <tr>
                <th className="py-2.5 px-3 text-left">Data Source / Agency</th>
                <th className="py-2.5 px-3 text-left">Connection</th>
                <th className="py-2.5 px-3 text-left">Last successful fetch</th>
                <th className="py-2.5 px-3 text-left">Latest observed value</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {dataSources.map((ds) => {
                const statusStyle = ds.status === 'OPERATIONAL' ? 'bg-emerald-100 text-emerald-800'
                  : ds.status === 'SIMULATED' ? 'bg-purple-100 text-purple-800'
                  : ['STALE', 'DELAYED', 'NOT_CHECKED', 'AUTH_REQUIRED', 'AUTH_ERROR'].includes(ds.status) ? 'bg-amber-100 text-amber-800'
                  : 'bg-red-100 text-red-800';

                return (
                  <tr key={ds.id} className="hover:bg-slate-50 transition">
                    <td className="py-2.5 px-3 font-semibold text-slate-900">
                      <div>{ds.name}</div>
                      <div className="text-[10px] text-slate-400 font-normal">{ds.configuration_reference}</div>
                    </td>
                    <td className="py-2.5 px-3 text-slate-600">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${statusStyle}`}>{ds.status}</span>
                      <div className="mt-1 text-[10px] text-slate-400">Expected interval: {ds.expected_update_interval_hours}h · {ds.source_type}</div>
                    </td>
                    <td className="py-2.5 px-3 text-slate-600">
                      <div>{ds.last_success_at ? new Date(ds.last_success_at).toLocaleString() : 'No successful fetch recorded'}</div>
                      <div className="mt-1 text-[10px] text-slate-400">Last attempt: {ds.last_fetch_attempt_at ? new Date(ds.last_fetch_attempt_at).toLocaleString() : 'not checked'}</div>
                    </td>
                    <td className="py-2.5 px-3 text-slate-600">
                      {ds.latest_observation_at ? (
                        <>
                          <div className="font-semibold">{ds.latest_value ?? '—'} {ds.latest_unit ?? ''} · {ds.latest_variable?.replaceAll('_', ' ')}</div>
                          <div className="mt-1 text-[10px] text-slate-400">Observed {new Date(ds.latest_observation_at).toLocaleString()} · {ds.latest_observation_status ?? 'UNKNOWN'}</div>
                          {ds.latest_observation_simulated && <div className="mt-1 text-[10px] font-bold text-purple-700">SIMULATED — not a live observation</div>}
                        </>
                      ) : <div className="text-slate-400">No observation recorded</div>}
                      {ds.latest_forecast_24h_mm != null && (
                        <div className="mt-1.5 border-t border-slate-100 pt-1 text-[10px] text-blue-700">
                          Forecast: {ds.latest_forecast_24h_mm} mm / 24h · {ds.latest_forecast_status ?? 'UNKNOWN'}
                          {ds.latest_forecast_fetched_at ? ` · fetched ${new Date(ds.latest_forecast_fetched_at).toLocaleString()}` : ''}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Official IMD REST feeds (api.imd.gov.in) — distinct from TinyFish bulletin scrape */}
      <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 mb-3">
          <div className="flex items-center gap-2">
            <Rss className="w-5 h-5 text-rose-600" />
            <h3 className="text-sm font-bold text-slate-900">Official IMD REST Feeds (api.imd.gov.in)</h3>
          </div>
          <div className="flex items-center gap-2">
            {imdStatus && (
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                imdStatus.api_key_configured ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
              }`}>
                IMD_API_KEY {imdStatus.api_key_configured ? 'configured' : 'not configured'}
              </span>
            )}
            <button
              onClick={runImdRefresh}
              disabled={imdSyncing}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-600 text-white rounded-lg text-xs font-bold hover:bg-rose-700 disabled:opacity-50 transition"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${imdSyncing ? 'animate-spin' : ''}`} />
              {imdSyncing ? 'Refreshing…' : 'Refresh IMD feeds'}
            </button>
          </div>
        </div>
        <p className="text-xs text-slate-500 mb-3">
          District rainfall / district warnings (verbatim official) / nowcast / river-basin QPF / AWS
          stations. Official warnings are imported as source-type OFFICIAL_AGENCY alerts — never
          converted into model estimates.
        </p>
        {imdSyncNote && <div className="text-[11px] text-slate-700 bg-slate-50 border border-slate-200 rounded-lg p-2 mb-3">{imdSyncNote}</div>}
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-xs">
            <thead className="bg-slate-50 text-slate-700 font-bold">
              <tr>
                <th className="py-2 px-3 text-left">Feed</th>
                <th className="py-2 px-3 text-left">Path</th>
                <th className="py-2 px-3 text-left">Last mode</th>
                <th className="py-2 px-3 text-left">Fetched</th>
                <th className="py-2 px-3 text-left">Rows</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {(imdStatus?.endpoints ?? []).map(ep => (
                <tr key={ep.endpoint}>
                  <td className="py-2 px-3 font-semibold text-slate-900">{ep.endpoint}</td>
                  <td className="py-2 px-3 font-mono text-[10px] text-slate-500">{ep.path}</td>
                  <td className="py-2 px-3">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                      ep.last_mode === 'LIVE' ? 'bg-emerald-100 text-emerald-800' :
                      ep.last_mode === 'CACHED' ? 'bg-blue-100 text-blue-800' :
                      'bg-amber-100 text-amber-800'
                    }`}>{ep.last_mode}</span>
                  </td>
                  <td className="py-2 px-3">{ep.fetched_at ? new Date(ep.fetched_at).toLocaleTimeString() : '—'}</td>
                  <td className="py-2 px-3">{ep.row_count}</td>
                </tr>
              ))}
              {!imdStatus && (
                <tr><td colSpan={5} className="py-3 px-3 text-slate-500">IMD status unavailable.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* TinyFish Web Extraction Service & Published Disaster Bulletins */}
      <TinyFishPanel />

      {/* Immutable Audit Log Records (FR-ADMIN-04) */}
      <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm">
        <div className="flex items-center gap-2 mb-3">
          <History className="w-5 h-5 text-indigo-600" />
          <h3 className="text-sm font-bold text-slate-900">Immutable Compliance & Action Audit Trail</h3>
        </div>
        <p className="text-xs text-slate-500 mb-4">
          All alert lifecycle state transitions, operator decisions, and manual overrides are cryptographically logged with actor IDs and justification.
        </p>

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-xs">
            <thead className="bg-slate-50 text-slate-700 font-bold">
              <tr>
                <th className="py-2.5 px-3 text-left">Timestamp (UTC)</th>
                <th className="py-2.5 px-3 text-left">Actor ID</th>
                <th className="py-2.5 px-3 text-left">Action</th>
                <th className="py-2.5 px-3 text-left">Resource Target</th>
                <th className="py-2.5 px-3 text-left">Documented Reason</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {auditLogs.map((log) => (
                <tr key={log.id} className="hover:bg-slate-50 transition">
                  <td className="py-2 px-3 text-slate-500 whitespace-nowrap">{new Date(log.timestamp).toLocaleString()}</td>
                  <td className="py-2 px-3 font-bold text-slate-800">{log.actor_id}</td>
                  <td className="py-2 px-3 font-semibold text-blue-700">{log.action}</td>
                  <td className="py-2 px-3 text-slate-600">{log.resource_type} ({log.resource_id.substring(0, 8)}...)</td>
                  <td className="py-2 px-3 text-slate-600 max-w-xs truncate">{log.reason || 'Automated trigger'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
