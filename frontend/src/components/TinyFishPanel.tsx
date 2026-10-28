import React, { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useVisibleRefresh } from '../hooks/useVisibleRefresh';
import { TinyFishStatus, TinyFishRetrievalResult, TinyFishAISummary } from '../types';
import {
  Globe,
  ShieldCheck,
  AlertTriangle,
  RefreshCw,
  Search,
  ExternalLink,
  CheckCircle2,
  Clock,
  Sparkles,
  ChevronDown,
  ChevronUp
} from 'lucide-react';

export const TinyFishPanel: React.FC = () => {
  const [status, setStatus] = useState<TinyFishStatus | null>(null);
  const [loadingStatus, setLoadingStatus] = useState<boolean>(true);
  const [history, setHistory] = useState<TinyFishRetrievalResult[]>([]);
  const [loadingHistory, setLoadingHistory] = useState<boolean>(false);

  // Form state
  const [url, setUrl] = useState<string>('https://mausam.imd.gov.in/responsive/districtWiseWarningGIS.php');
  const [format, setFormat] = useState<'markdown' | 'html' | 'json'>('markdown');
  const [retrieving, setRetrieving] = useState<boolean>(false);
  const [activeResult, setActiveResult] = useState<TinyFishRetrievalResult | null>(null);
  const [aiSummary, setAiSummary] = useState<TinyFishAISummary | null>(null);
  const [summarizing, setSummarizing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [expandedContent, setExpandedContent] = useState<boolean>(true);

  const fetchStatus = async () => {
    setLoadingStatus(true);
    try {
      const data = await api.getTinyFishStatus();
      setStatus(data);
    } catch (e: any) {
      console.error('Failed to fetch TinyFish status', e);
    } finally {
      setLoadingStatus(false);
    }
  };

  const fetchHistory = async () => {
    setLoadingHistory(true);
    try {
      const records = await api.getTinyFishHistory(10);
      setHistory(records);
      if (records.length > 0 && !activeResult) {
        setActiveResult(records[0]);
      }
    } catch (e: any) {
      console.error('Failed to fetch TinyFish history', e);
    } finally {
      setLoadingHistory(false);
    }
  };

  const refreshStatusHistory = async () => {
    await Promise.allSettled([fetchStatus(), fetchHistory()]);
  };

  useEffect(() => {
    void refreshStatusHistory();
  }, []);
  useVisibleRefresh(refreshStatusHistory, 5 * 60 * 1000);

  const handleRetrieve = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!url.trim()) return;

    setRetrieving(true);
    setErrorMessage(null);

    try {
      const result = await api.requestTinyFishRetrieval({
        url: url.trim(),
        format,
        simulate_if_unavailable: false
      });
      setActiveResult(result);
      setAiSummary(null);
      fetchStatus();
      fetchHistory();
    } catch (err: any) {
      setErrorMessage(err.message || 'Retrieval failed. Please verify URL is from an approved government domain.');
    } finally {
      setRetrieving(false);
    }
  };

  const summarizeWithAI = async () => {
    if (!activeResult || activeResult.simulation_flag || activeResult.data_quality_status !== 'VALID') return;
    setSummarizing(true);
    setErrorMessage(null);
    try {
      setAiSummary(await api.summarizeTinyFishRecord(activeResult.id));
    } catch (err: any) {
      setErrorMessage(err.message || 'AI could not summarize this source record.');
    } finally {
      setSummarizing(false);
    }
  };

  const selectPreset = (presetUrl: string) => {
    setUrl(presetUrl);
    setErrorMessage(null);
  };

  const getClassificationBadge = (classification: string, isSimulated: boolean) => {
    if (isSimulated || classification === 'SYNTHETIC_DEMO_DATA') {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-300">
          <Sparkles className="w-3 h-3 text-amber-600" />
          SYNTHETIC DEMO DATA
        </span>
      );
    }
    if (classification === 'OFFICIAL_PUBLISHED_WARNING') {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
          <ShieldCheck className="w-3 h-3 text-emerald-600" />
          OFFICIAL PUBLISHED WARNING
        </span>
      );
    }
    if (classification === 'EXTRACTED_WEB_INFORMATION') {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-800 border border-blue-300">
          <Globe className="w-3 h-3 text-blue-600" />
          EXTRACTED WEB INFORMATION
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-purple-100 text-purple-800 border border-purple-300">
        EXPERIMENTAL AI ESTIMATE
      </span>
    );
  };

  const isDomainApproved = (testUrl: string): boolean => {
    if (!status?.approved_domains) return false;
    try {
      const parsed = new URL(testUrl);
      const host = parsed.hostname.toLowerCase();
      return status.approved_domains.some(d => host === d.toLowerCase() || host.endsWith('.' + d.toLowerCase()));
    } catch {
      return false;
    }
  };

  const validUrl = isDomainApproved(url);

  return (
    <div className="space-y-6">
      {/* TinyFish Integration Overview Card */}
      <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-teal-50 border border-teal-200 flex items-center justify-center text-teal-700">
              <Globe className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">TinyFish Web Extraction Service</h3>
              <p className="text-xs text-slate-500">Official government disaster advisory & hydro-telemetry extraction</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => { void refreshStatusHistory(); }}
              disabled={loadingStatus}
              className="p-1.5 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition"
              title="Refresh status"
            >
              <RefreshCw className={`w-4 h-4 ${loadingStatus ? 'animate-spin' : ''}`} />
            </button>
            {status ? (
              <span className={`px-2.5 py-1 rounded-full text-xs font-bold ${
                status.status === 'READY'
                  ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                  : status.status === 'RATE_LIMITED'
                  ? 'bg-orange-100 text-orange-800 border border-orange-300'
                  : 'bg-amber-100 text-amber-800 border border-amber-300'
              }`}>
                {status.status}
              </span>
            ) : (
              <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-slate-100 text-slate-600">
                CHECKING...
              </span>
            )}
          </div>
        </div>

        {/* Integration details grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 text-xs">
          <div className="bg-slate-50 p-3 rounded-lg border border-slate-200">
            <div className="text-slate-500 font-medium text-[11px]">API Key Status</div>
            <div className="font-semibold text-slate-900 mt-1 flex items-center gap-1.5">
              {status?.key_present ? (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                  <span>{status.key_preview || 'Configured'}</span>
                </>
              ) : (
                <>
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                  <span className="text-amber-700">Fallback Fixtures</span>
                </>
              )}
            </div>
          </div>

          <div className="bg-slate-50 p-3 rounded-lg border border-slate-200">
            <div className="text-slate-500 font-medium text-[11px]">Rate Limit Remaining</div>
            <div className="font-semibold text-slate-900 mt-1">
              {status ? `${status.rate_limit_remaining} / ${status.rate_limit_per_minute} req/min` : '—'}
            </div>
          </div>

          <div className="bg-slate-50 p-3 rounded-lg border border-slate-200">
            <div className="text-slate-500 font-medium text-[11px]">Total Extractions</div>
            <div className="font-semibold text-slate-900 mt-1">
              {status ? `${status.total_retrievals_count} recorded` : '0 recorded'}
            </div>
          </div>

          <div className="bg-slate-50 p-3 rounded-lg border border-slate-200">
            <div className="text-slate-500 font-medium text-[11px]">Security Guardrail</div>
            <div className="font-semibold text-teal-700 mt-1 flex items-center gap-1">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>SSRF & Domain Allowlist</span>
            </div>
          </div>
        </div>

        {/* Approved domains banner */}
        <div className="mt-3 text-[11px] bg-slate-50 p-2.5 rounded-lg border border-slate-200 text-slate-600">
          <span className="font-bold text-slate-800">Approved Target Domains: </span>
          <span>*.imd.gov.in, *.cwc.gov.in, *.india-water.gov.in, *.gsi.gov.in, *.nrsc.gov.in</span>
        </div>
      </div>

      {/* Retrieval Action Card */}
      <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm">
        <h4 className="text-sm font-bold text-slate-900 mb-2">Request Official Data Retrieval</h4>
          <p className="text-xs text-slate-500 mb-4">
          Retrieve current warnings, nowcasts, rainfall products, and forecasts from IMD’s public pages. TinyFish stores the original source text and retrieval time; Gemini can summarize only a valid, non-simulated retrieval.
        </p>

        {/* Preset buttons */}
        <div className="flex flex-wrap gap-2 mb-4">
          <button
            type="button"
            onClick={() => selectPreset('https://mausam.imd.gov.in/responsive/districtWiseWarningGIS.php')}
            className="text-xs px-2.5 py-1.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700 transition"
          >
            IMD District Warnings
          </button>
          <button
            type="button"
            onClick={() => selectPreset('https://mausam.imd.gov.in/responsive/districtWiseNowcastGIS.php')}
            className="text-xs px-2.5 py-1.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700 transition"
          >
            IMD District Nowcast
          </button>
          <button
            type="button"
            onClick={() => selectPreset('https://mausam.imd.gov.in/responsive/all_india_forcast_bulletin.php')}
            className="text-xs px-2.5 py-1.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700 transition"
          >
            IMD All India Forecast
          </button>
          <button
            type="button"
            onClick={() => selectPreset('https://mausam.imd.gov.in/responsive/rainfallinformation.php')}
            className="text-xs px-2.5 py-1.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700 transition"
          >
            IMD Rainfall Maps
          </button>
          <button
            type="button"
            onClick={() => selectPreset('https://ffs.india-water.gov.in/')}
            className="text-xs px-2.5 py-1.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700 transition"
          >
            CWC Flood Telemetry
          </button>
          <button
            type="button"
            onClick={() => selectPreset('https://bhusanket.gsi.gov.in/')}
            className="text-xs px-2.5 py-1.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700 transition"
          >
            GSI Bhusanket Advisory
          </button>
        </div>

        <form onSubmit={handleRetrieve} className="space-y-3">
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="relative flex-1">
              <input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://mausam.imd.gov.in/..."
                className={`w-full text-xs px-3 py-2.5 rounded-lg border ${
                  validUrl ? 'border-slate-300 focus:border-teal-500' : 'border-amber-400 bg-amber-50/30'
                } focus:outline-none`}
                required
              />
            </div>

            <select
              value={format}
              onChange={(e) => setFormat(e.target.value as any)}
              className="text-xs px-3 py-2.5 rounded-lg border border-slate-300 bg-white text-slate-700 focus:outline-none"
            >
              <option value="markdown">Markdown</option>
              <option value="html">Raw HTML</option>
              <option value="json">Structured JSON</option>
            </select>

            <button
              type="submit"
              disabled={retrieving || !validUrl || !status?.configured}
              className="flex items-center justify-center gap-1.5 px-4 py-2.5 bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white rounded-lg text-xs font-bold transition shadow-sm"
            >
              {retrieving ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>Extracting...</span>
                </>
              ) : (
                <>
                  <Search className="w-3.5 h-3.5" />
                  <span>Execute Retrieval</span>
                </>
              )}
            </button>
          </div>

          <div className="flex items-center justify-between text-xs text-slate-500 pt-1">
            {!status?.configured && <span className="text-amber-700">Live extraction disabled until TINYFISH_API_KEY is configured on the backend. Simulation is off.</span>}
            {!validUrl && url.length > 0 && (
              <span className="text-amber-700 font-medium">Domain not in approved government allowlist</span>
            )}
          </div>
        </form>

        {errorMessage && (
          <div className="mt-3 p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-xs flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}
      </div>

      {/* Latest Retrieval Result */}
      {activeResult && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-4 bg-slate-50 border-b border-slate-200 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="font-bold text-sm text-slate-900">
                  {activeResult.title || `${activeResult.source_agency} Observation`}
                </span>
                {getClassificationBadge(activeResult.data_classification, activeResult.simulation_flag)}
              </div>
              <div className="flex items-center gap-3 text-xs text-slate-500">
                <span className="flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  Retrieved: {new Date(activeResult.retrieval_timestamp).toLocaleString()}
                </span>
                <span className="font-medium text-slate-700">Agency: {activeResult.source_agency}</span>
                <span className="font-medium">Quality: {activeResult.data_quality_status}</span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <a
                href={activeResult.source_url}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-teal-700 hover:text-teal-900 flex items-center gap-1 font-medium bg-white px-2.5 py-1 rounded border border-slate-200"
              >
                <span>View Source</span>
                <ExternalLink className="w-3 h-3" />
              </a>
              <button
                type="button"
                onClick={() => setExpandedContent(!expandedContent)}
                className="p-1 text-slate-500 hover:text-slate-800 rounded transition"
              >
                {expandedContent ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {expandedContent && (
            <div className="p-4 text-xs font-mono bg-slate-950 text-slate-100 overflow-x-auto max-h-96 whitespace-pre-wrap leading-relaxed">
              {activeResult.extracted_text || '(No text extracted)'}
            </div>
          )}
        </div>
      )}

      {activeResult && activeResult.data_quality_status === 'VALID' && !activeResult.simulation_flag && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-bold text-slate-900">AI source summary</div>
              <div className="text-[11px] text-slate-500">Uses this retrieved agency text only. It does not create or upgrade warnings.</div>
            </div>
            <button type="button" onClick={() => void summarizeWithAI()} disabled={summarizing} className="inline-flex items-center gap-1.5 rounded-lg bg-[#806047] px-3 py-2 text-xs font-bold text-white hover:bg-[#654a36] disabled:opacity-50">
              <Sparkles className={`h-3.5 w-3.5 ${summarizing ? 'animate-pulse' : ''}`} />
              {summarizing ? 'Summarizing…' : 'Summarize with AI'}
            </button>
          </div>
          {aiSummary && <div className="mt-3 space-y-2 border-t border-slate-100 pt-3 text-xs text-slate-700">
            <div className={`inline-flex rounded-full px-2 py-1 text-[10px] font-bold ${aiSummary.source_freshness === 'CURRENT' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>
              Source freshness: {aiSummary.source_freshness ?? 'UNVERIFIED_DATE'}
            </div>
            <div className="font-semibold">{aiSummary.summary}</div>
            {aiSummary.supporting_observations.length > 0 && <ul className="list-disc pl-5">{aiSummary.supporting_observations.map((item, i) => <li key={i}>{item}</li>)}</ul>}
            {aiSummary.uncertainties.length > 0 && <div className="rounded-md bg-amber-50 p-2 text-amber-800"><b>Uncertainties:</b> {aiSummary.uncertainties.join(' · ')}</div>}
            <div className="text-[10px] text-slate-500">AI summary{aiSummary.model ? ` · model: ${aiSummary.model}` : ''} · source: {activeResult.source_agency} · published {aiSummary.publication_timestamp ? new Date(aiSummary.publication_timestamp).toLocaleString() : 'date not identified'} · retrieved {new Date(activeResult.retrieval_timestamp).toLocaleString()}</div>
          </div>}
        </div>
      )}

      {/* Past Retrieval History */}
      <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm">
        <div className="flex justify-between items-center mb-3">
          <h4 className="text-sm font-bold text-slate-900">Recent Web Extractions & Provenance</h4>
          <span className="text-xs text-slate-500">{history.length} records</span>
        </div>

        {loadingHistory ? (
          <div className="text-xs text-slate-500 py-4 text-center">Loading extraction records...</div>
        ) : history.length === 0 ? (
          <div className="text-xs text-slate-400 py-4 text-center">No extractions recorded yet. Click "Execute Retrieval" above to start.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-xs">
              <thead className="bg-slate-50 text-slate-700 font-bold">
                <tr>
                  <th className="py-2 px-3 text-left">Agency / Title</th>
                  <th className="py-2 px-3 text-left">Target Domain</th>
                  <th className="py-2 px-3 text-left">Classification</th>
                  <th className="py-2 px-3 text-left">Quality</th>
                  <th className="py-2 px-3 text-left">Retrieved At</th>
                  <th className="py-2 px-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {history.map((rec) => (
                  <tr key={rec.id} className="hover:bg-slate-50 transition">
                    <td className="py-2.5 px-3 font-semibold text-slate-900">
                      <div>{rec.title || rec.source_agency}</div>
                      <div className="text-[10px] text-slate-400 font-normal font-mono truncate max-w-xs">{rec.source_url}</div>
                    </td>
                    <td className="py-2.5 px-3 font-mono text-slate-600 text-[11px]">{rec.target_domain}</td>
                    <td className="py-2.5 px-3">{getClassificationBadge(rec.data_classification, rec.simulation_flag)}</td>
                    <td className="py-2.5 px-3">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                        rec.data_quality_status === 'VALID' ? 'bg-emerald-100 text-emerald-800' :
                        rec.data_quality_status === 'STALE' ? 'bg-amber-100 text-amber-800' :
                        'bg-slate-100 text-slate-700'
                      }`}>
                        {rec.data_quality_status}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-slate-500 whitespace-nowrap">
                      {new Date(rec.retrieval_timestamp).toLocaleTimeString()}
                    </td>
                    <td className="py-2.5 px-3 text-right">
                      <button
                        onClick={() => { setActiveResult(rec); setExpandedContent(true); }}
                        className="text-xs font-semibold text-teal-600 hover:text-teal-800"
                      >
                        Inspect
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
