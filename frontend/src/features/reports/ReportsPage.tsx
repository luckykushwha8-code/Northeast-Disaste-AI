import React, { useState } from 'react';
import { FileText, Download, CheckCircle2, Loader2 } from 'lucide-react';
import { api } from '../../api/client';
import type { UserRole } from '../../types';

export default function ReportsPage({ userRole, onRequestLogin }: { userRole: UserRole; onRequestLogin: () => void }) {
  const [reportDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [downloading, setDownloading] = useState<'pdf' | 'csv' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [summary, setSummary] = useState<any>(null);
  const [summarizing, setSummarizing] = useState(false);
  const [summaryError, setSummaryError] = useState('');
  const canSummarize = ['OPERATOR', 'ANALYST', 'ADMIN'].includes(userRole);

  const summarize = async () => {
    if (summarizing) return;
    setSummarizing(true); setSummaryError(''); setSummary(null);
    try { setSummary(await api.summarizeSituationReport()); }
    catch (e) { setSummaryError(e instanceof Error ? e.message : 'Could not summarize report'); }
    finally { setSummarizing(false); }
  };

  const download = async (format: 'pdf' | 'csv') => {
    setDownloading(format);
    setError(null);
    setSuccess(null);
    try {
      let blob: Blob;
      try {
        blob = await api.downloadSituationReport(format);
      } catch (e) {
        if (format !== 'pdf') throw e;
        setError('PDF generation failed. Falling back to CSV download.');
        setDownloading('csv');
        return await download('csv');
      }
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = `ne-safe-situation-report-${reportDate}.${format}`;
      a.click();
      URL.revokeObjectURL(blobUrl);
      setSuccess(`${format.toUpperCase()} report downloaded.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDownloading(null);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <FileText className="w-5 h-5 text-teal-700" />
            <div>
              <h2 className="text-base font-bold text-slate-900">Situation Reports</h2>
              <p className="text-xs text-slate-500 mt-0.5">Export the latest information currently available to the service.</p>
            </div>
          </div>
        </div>
      </div>

      {/* Download Section */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
        <div className="mb-4 rounded-lg border border-teal-200 bg-teal-50 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><h3 className="text-sm font-bold text-slate-900">AI situation summary</h3>
              <p className="mt-1 text-xs text-slate-600">Summarizes stored observations and assessments. Only operators and analysts can request it.</p></div>
            {canSummarize ? <button onClick={summarize} disabled={summarizing} className="rounded-lg bg-teal-700 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">
              {summarizing ? 'Summarizing…' : 'Summarize report'}
            </button> : <button onClick={onRequestLogin} className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700">Staff login for AI summary</button>}
          </div>
          {summaryError && <p role="alert" className="mt-2 text-xs text-red-700">{summaryError}</p>}
          {summary && <div className="mt-3 space-y-2 border-t border-teal-200 pt-3 text-xs text-slate-700">
            <p className="font-semibold">AI-generated summary · {reportDate}</p><p>{summary.summary}</p>
            {summary.supporting_observations?.length > 0 && <ul className="list-disc pl-4">{summary.supporting_observations.map((item: string, i: number) => <li key={i}>{item}</li>)}</ul>}
            {summary.uncertainties?.length > 0 && <p className="text-amber-900">Data limitations: {summary.uncertainties.join(' · ')}</p>}
            {summary.preparedness_actions?.length > 0 && <p>Follow-up checks: {summary.preparedness_actions.join(' · ')}</p>}
            <p className="text-[10px] text-slate-500">AI-generated text; report measurements, records and warning statuses remain from the source database.</p>
          </div>}
        </div>
        <h3 className="text-sm font-bold text-slate-900 mb-3">Download Situation Report</h3>

        <div className="flex gap-3 flex-wrap mb-4">
          <button
            onClick={() => download('pdf')}
            disabled={downloading !== null}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-teal-700 text-white text-sm font-bold hover:bg-teal-800 disabled:opacity-50 transition"
          >
            {downloading === 'pdf' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            Download PDF Report
          </button>
          <button
            onClick={() => download('csv')}
            disabled={downloading !== null}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-slate-300 text-slate-700 text-sm font-bold hover:bg-slate-50 disabled:opacity-50 transition"
          >
            {downloading === 'csv' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            Download CSV Data
          </button>
        </div>

        {error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700 mb-3">
            {error}
          </div>
        )}
        {success && (
          <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-700 mb-3 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4" />
            {success}
          </div>
        )}
      </div>

      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        Reports are generated from records currently stored by the backend. Source freshness and coverage can vary;
        check System Health and record provenance before relying on exported values. These reports are not official warnings.
      </div>
    </div>
  );
}
