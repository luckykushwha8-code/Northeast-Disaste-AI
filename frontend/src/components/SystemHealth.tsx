import React, { useEffect, useState } from 'react';
import { DataSourceItem, AuditLogItem, LiveDataSyncItem, TinyFishStatus } from '../types';
import { api } from '../api/client';
import { Database, Globe, History, RefreshCw, Rss } from 'lucide-react';
import { TinyFishPanel } from './TinyFishPanel';
import type { UserRole } from '../types';
import { useVisibleRefresh } from '../hooks/useVisibleRefresh';

interface SystemHealthProps {
  dataSources?: DataSourceItem[];
  onRefresh: () => void;
  userRole: UserRole;
  onRequestLogin: () => void;
}

export const SystemHealth: React.FC<SystemHealthProps> = ({ dataSources: initialDataSources, onRefresh, userRole, onRequestLogin }) => {
  const canManage = ['OPERATOR', 'ADMIN'].includes(userRole);
  const loginAction = userRole === 'RESIDENT' ? 'Staff login' : 'Switch staff account';
  const [dataSources, setDataSources] = useState<DataSourceItem[]>(initialDataSources ?? []);
  const [auditLogs, setAuditLogs] = useState<AuditLogItem[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<LiveDataSyncItem | null>(null);
  const [tinyFishStatus, setTinyFishStatus] = useState<TinyFishStatus | null>(null);

  const refreshFeedStatus = async () => {
    const [sources, tinyFish] = await Promise.allSettled([api.getDataStatus(), api.getTinyFishStatus()]);
    if (sources.status === 'fulfilled') setDataSources(sources.value);
    if (tinyFish.status === 'fulfilled') setTinyFishStatus(tinyFish.value);
  };

  useEffect(() => {
    void refreshFeedStatus();
    const fetchLogs = async () => {
      if (!canManage) {
        setAuditLogs([]);
        return;
      }
      try {
        const logs = await api.getAuditLogs();
        setAuditLogs(logs);
      } catch (e) {
        console.error("Failed to fetch audit logs", e);
      }
    };
    fetchLogs();
  }, [canManage]);
  useVisibleRefresh(refreshFeedStatus, 60 * 1000);

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

  return (
    <div className="space-y-6">
      {/* Live Data Sync Control */}
      {canManage ? <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm">
        <div className="flex items-center gap-2 mb-3">
          <Rss className="w-5 h-5 text-emerald-600" />
          <h3 className="text-sm font-bold text-slate-900">Live Government Data Sync</h3>
        </div>
        <p className="text-xs text-slate-500 mb-4">
          Refreshes CWC station telemetry, IMD and GSI public pages through TinyFish, and
          regional news. Only dated source data is shown as current; Gemini summaries are
          labeled as AI summaries and never create official warnings.
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
      </div> : <div className="rounded-xl border border-slate-200 bg-white p-4 text-xs text-slate-600">Feed status and freshness are public. Operator or administrator access is required to trigger manual source refreshes. <button onClick={onRequestLogin} className="ml-1 font-semibold text-teal-700 underline">{loginAction}</button></div>}

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
                  : ['STALE', 'DELAYED', 'NOT_CHECKED', 'AUTH_REQUIRED', 'AUTH_ERROR', 'VIA_TINYFISH'].includes(ds.status) ? 'bg-amber-100 text-amber-800'
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

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
        <div className="flex items-center gap-2">
          <Globe className="h-4 w-4 text-teal-700" />
          <div>
            <div className="text-xs font-bold text-slate-800">TinyFish scheduled extraction</div>
            <div className="text-[11px] text-slate-500">
              Backend sync {tinyFishStatus?.scheduled_sync_enabled ? `every ${tinyFishStatus.scheduled_sync_interval_minutes} minutes` : 'disabled'}
              {' · '}Last attempt {tinyFishStatus?.last_retrieval_at ? new Date(tinyFishStatus.last_retrieval_at).toLocaleString() : 'not recorded'}
              {' · '}{tinyFishStatus?.total_retrievals_count ?? 0} retrieval records
            </div>
          </div>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${tinyFishStatus?.configured ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>
          {tinyFishStatus?.configured ? 'LIVE KEY CONFIGURED' : 'LIVE KEY MISSING'}
        </span>
      </div>

      {/* TinyFish Web Extraction Service & Published Disaster Bulletins */}
      {canManage ? <TinyFishPanel /> : <div className="rounded-xl border border-slate-200 bg-white p-4 text-xs text-slate-600">Source retrieval controls are available to authorized operators. <button onClick={onRequestLogin} className="font-semibold text-teal-700 underline">{loginAction}</button></div>}

      {/* Immutable Audit Log Records (FR-ADMIN-04) */}
      {canManage ? <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm">
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
      </div> : <div className="rounded-xl border border-slate-200 bg-white p-4 text-xs text-slate-600">The audit trail contains staff and operational details. Operator or administrator access is required. <button onClick={onRequestLogin} className="font-semibold text-teal-700 underline">{loginAction}</button></div>}
    </div>
  );
};
