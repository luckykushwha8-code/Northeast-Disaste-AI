import React, { useState } from 'react';
import { FileText, Download, CheckCircle2, Loader2 } from 'lucide-react';
import { DataModeBadge } from '../../components/ui/DataModeBadge';
import { api } from '../../api/client';

export default function ReportsPage() {
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
      a.download = `ne-safe-situation-report-${new Date().toISOString().slice(0,10)}.${format}`;
      a.click();
      URL.revokeObjectURL(blobUrl);
      setSuccess(`${format.toUpperCase()} report downloaded.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDownloading(null);
    }
  };

  const now = new Date();
  const istTime = now.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false });

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
          <DataModeBadge mode="BASELINE" size="sm" />
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

      {/* Live Report Preview */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-bold text-slate-900">Live Situation Report Preview</h3>
          <span className="text-[11px] text-slate-400 font-mono">{istTime} IST</span>
        </div>

        {/* Report Header */}
        <div className="border border-slate-300 rounded-lg p-4 bg-slate-50 space-y-4">
          <div className="border-b border-slate-200 pb-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-black text-slate-900 uppercase tracking-wide">NE-SAFE AI — Situation Report</div>
                <div className="text-xs text-slate-500 mt-0.5">Northeast India Flood & Landslide Early Warning Platform</div>
              </div>
              <div className="text-right text-[11px] text-slate-500">
                <div>Report Date: {now.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })}</div>
                <div>Time: {istTime} IST</div>
                <div>Coverage: 8 NE States · 19 Monitored Locations</div>
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <div className="p-3 bg-white rounded-lg border border-amber-200">
              <div className="text-xs font-bold text-amber-800 mb-1">⚠ IMPORTANT — Data Provenance & Limitations</div>
              <ul className="text-[11px] text-amber-700 space-y-0.5 list-disc list-inside">
                <li>AI risk assessments in this report are PROPOSED and require operator review</li>
                <li>River threshold data sourced from CWC (ffs.india-water.gov.in) — official thresholds</li>
                <li>Rainfall data: IMD AWS telemetry with Open-Meteo gap-fill (clearly labeled)</li>
                <li>Landslide susceptibility: GSI NLSM 2022 (static geological baseline)</li>
                <li>This report does NOT constitute an official government warning</li>
              </ul>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 bg-white rounded-lg border border-slate-200">
                <div className="text-xs font-bold text-slate-700 mb-2">Data Source Status</div>
                <div className="space-y-1">
                  {[
                    { source: 'CWC River Stations', mode: 'LIVE' as const },
                    { source: 'IMD Rainfall (AWS)', mode: 'LIVE' as const },
                    { source: 'Open-Meteo Forecast', mode: 'LIVE' as const },
                    { source: 'GSI Terrain Baseline', mode: 'BASELINE' as const },
                    { source: 'IMD REST API', mode: 'UNAVAILABLE' as const },
                  ].map(s => (
                    <div key={s.source} className="flex items-center justify-between text-[11px]">
                      <span className="text-slate-600">{s.source}</span>
                      <DataModeBadge mode={s.mode} size="xs" />
                    </div>
                  ))}
                </div>
              </div>
              <div className="p-3 bg-white rounded-lg border border-slate-200">
                <div className="text-xs font-bold text-slate-700 mb-2">Coverage Summary</div>
                <div className="space-y-1 text-[11px] text-slate-600">
                  <div className="flex justify-between"><span>States monitored:</span><span className="font-bold text-slate-800">8</span></div>
                  <div className="flex justify-between"><span>Districts covered:</span><span className="font-bold text-slate-800">78</span></div>
                  <div className="flex justify-between"><span>River stations (CWC):</span><span className="font-bold text-slate-800">7</span></div>
                  <div className="flex justify-between"><span>Slope zones (GSI):</span><span className="font-bold text-slate-800">12</span></div>
                </div>
              </div>
            </div>

            <div className="p-3 bg-white rounded-lg border border-slate-200">
              <div className="text-xs font-bold text-slate-700 mb-2">Full Report Contents</div>
              <div className="text-[11px] text-slate-500 space-y-0.5">
                <div>• Section 1: Executive Summary — Active alerts, critical locations, freshness status</div>
                <div>• Section 2: River Hydrology — CWC station readings vs Warning/Danger marks (metres, IST)</div>
                <div>• Section 3: Rainfall Analysis — 24h observed + 72h forecast (mm, accumulation window noted)</div>
                <div>• Section 4: Landslide Risk — GSI susceptibility zones with ARI trigger assessment</div>
                <div>• Section 5: Alert Audit Trail — All PROPOSED/APPROVED alerts with rule IDs and confidence</div>
                <div>• Section 6: Rescue Operations — Open rescue requests and responder assignments</div>
                <div>• Appendix: Data provenance, model version, threshold sources, known limitations</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
