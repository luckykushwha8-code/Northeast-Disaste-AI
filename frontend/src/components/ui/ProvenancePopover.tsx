import React, { useState, useRef, useEffect } from 'react';
import { Info, X } from 'lucide-react';

export interface ProvenanceData {
  source_id: string;
  simulation_flag: boolean;
  fetched_at?: string | null;
  threshold_origin?: string;
  rules_version?: string;
}

interface ProvenancePopoverProps {
  data: ProvenanceData;
  trigger?: React.ReactNode;
}

export const ProvenancePopover: React.FC<ProvenancePopoverProps> = ({ data, trigger }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  return (
    <div className="relative inline-block" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        className="inline-flex items-center gap-1 text-xs text-teal-700 hover:text-teal-900 font-medium"
        title="View data provenance"
      >
        {trigger ?? <><Info className="w-3 h-3" /> Provenance</>}
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-80 bg-white border border-slate-200 rounded-xl shadow-xl p-4 text-xs">
          <div className="flex items-center justify-between mb-2 border-b border-slate-100 pb-2">
            <span className="font-bold text-slate-900">Data Provenance</span>
            <button onClick={() => setOpen(false)}>
              <X className="w-3.5 h-3.5 text-slate-400 hover:text-slate-700" />
            </button>
          </div>
          <div className="space-y-2">
            <Row label="Source ID" value={<code className="font-mono bg-slate-100 px-1 rounded">{data.source_id}</code>} />
            <Row
              label="Simulation"
              value={
                <span className={data.simulation_flag ? 'text-purple-700 font-bold' : 'text-green-700 font-bold'}>
                  {data.simulation_flag ? 'YES — synthetic data' : 'NO'}
                </span>
              }
            />
            {data.fetched_at && (
              <Row
                label="Fetched at"
                value={new Date(data.fetched_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) + ' IST'}
              />
            )}
            {data.threshold_origin && (
              <Row label="Threshold origin" value={data.threshold_origin} />
            )}
            {data.rules_version && (
              <Row label="Rules version" value={<code className="font-mono bg-slate-100 px-1 rounded">{data.rules_version}</code>} />
            )}
          </div>
        </div>
      )}
    </div>
  );
};

const Row: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div className="flex justify-between items-start gap-2">
    <span className="text-slate-500 flex-shrink-0">{label}</span>
    <span className="text-slate-800 text-right">{value}</span>
  </div>
);
