import React, { useState, useRef } from 'react';
import { Info } from 'lucide-react';
import { DataModeBadge, DataMode } from './DataModeBadge';

export interface ProvenanceInfo {
  source_id: string;
  simulation_flag: boolean;
  fetched_at?: string | null;
  threshold_origin?: string;
  rules_version?: string;
}

interface StatCardProps {
  value: string | number;
  label: string;
  delta?: string;
  deltaPositive?: boolean;
  dataMode?: DataMode;
  provenance?: ProvenanceInfo;
  className?: string;
}

export const StatCard: React.FC<StatCardProps> = ({
  value,
  label,
  delta,
  deltaPositive,
  dataMode = 'UNAVAILABLE',
  provenance,
  className = '',
}) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  return (
    <div
      ref={ref}
      className={`relative bg-white rounded-xl border border-slate-200 shadow-sm p-4 ${className}`}
    >
      <div className="flex items-start justify-between">
        <div>
          <p className="text-2xl font-black text-slate-900">{value}</p>
          <p className="text-xs text-slate-500 mt-1 font-medium">{label}</p>
          {delta && (
            <span
              className={`text-xs font-semibold ${deltaPositive ? 'text-green-600' : 'text-red-600'}`}
            >
              {deltaPositive ? '▲' : '▼'} {delta}
            </span>
          )}
        </div>
        <div className="flex flex-col items-end gap-1">
          <DataModeBadge mode={dataMode} size="sm" />
          {provenance && (
            <button
              onClick={() => setOpen(o => !o)}
              className="p-1 rounded-md text-slate-400 hover:text-teal-700 hover:bg-slate-100 transition"
              title="View provenance"
            >
              <Info className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {open && provenance && (
        <div className="absolute top-full right-0 z-50 mt-1 w-72 bg-white border border-slate-200 rounded-xl shadow-xl p-3 text-xs space-y-1.5">
          <p className="font-bold text-slate-900 border-b border-slate-100 pb-1 mb-1">Provenance</p>
          <div className="flex justify-between">
            <span className="text-slate-500">Source</span>
            <span className="font-mono text-slate-800">{provenance.source_id}</span>
          </div>
          {provenance.fetched_at && (
            <div className="flex justify-between">
              <span className="text-slate-500">Fetched</span>
              <span className="text-slate-700">{new Date(provenance.fetched_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST</span>
            </div>
          )}
          {provenance.threshold_origin && (
            <div className="flex justify-between">
              <span className="text-slate-500">Threshold</span>
              <span className="text-slate-700">{provenance.threshold_origin}</span>
            </div>
          )}
          {provenance.rules_version && (
            <div className="flex justify-between">
              <span className="text-slate-500">Rules</span>
              <span className="font-mono text-slate-700">{provenance.rules_version}</span>
            </div>
          )}
          <div className="flex justify-between">
            <span className="text-slate-500">Simulation</span>
            <span className={provenance.simulation_flag ? 'text-purple-700 font-bold' : 'text-green-700 font-bold'}>
              {provenance.simulation_flag ? 'YES' : 'NO'}
            </span>
          </div>
          <button
            onClick={() => setOpen(false)}
            className="mt-1 text-[10px] text-slate-400 hover:text-slate-600"
          >
            Close
          </button>
        </div>
      )}
    </div>
  );
};
