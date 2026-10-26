import React, { useState } from 'react';
import { FileText, Download, CheckCircle2, Loader2 } from 'lucide-react';
import { api } from '../../api/client';

export default function ReportsPage() {
  const [reportDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [downloading, setDownloading] = useState<'pdf' | 'csv' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const download = async (format: 'pdf' | 'csv') => {
    setDownloading(format);
    setError(null);
    setSuccess(null);
    try {
      const url = api.getReportUrl(format);
      const res = await fetch(url);
      if (!res.ok) {
        if (format === 'pdf') {
          // Fallback to CSV
          setError('PDF generation failed. Falling back to CSV download.');
          setDownloading('csv');
          return download('csv');
        }
        throw new Error(`Download failed: HTTP ${res.status}`);
      }
      const blob = await res.blob();
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
