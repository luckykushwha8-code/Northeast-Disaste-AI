import React from 'react';
import type { SeverityLevel } from '../../types';

interface RiskGaugeProps {
  riskLevel?: SeverityLevel;
  category?: SeverityLevel;
  probability?: number | null;
  factors?: Array<{ label: string; weight?: number; value?: string }>;
  className?: string;
}

const SEVERITY_ORDER: Record<SeverityLevel, number> = {
  LOW: 1,
  MODERATE: 2,
  HIGH: 3,
  CRITICAL: 4,
  UNAVAILABLE: 0,
};

const SEVERITY_COLOR: Record<SeverityLevel, string> = {
  LOW: '#16A34A',
  MODERATE: '#F59E0B',
  HIGH: '#F97316',
  CRITICAL: '#EF4444',
  UNAVAILABLE: '#94A3B8',
};

const SEVERITY_LABEL: Record<SeverityLevel, string> = {
  LOW: 'Low Risk',
  MODERATE: 'Moderate Risk',
  HIGH: 'High Risk',
  CRITICAL: 'Critical Risk',
  UNAVAILABLE: 'Unavailable',
};

export const RiskGauge: React.FC<RiskGaugeProps> = ({
  riskLevel,
  category,
  probability,
  factors = [],
  className = '',
}) => {
  const effectiveLevel = riskLevel ?? category ?? 'UNAVAILABLE';
  const score = SEVERITY_ORDER[effectiveLevel] ?? 0;
  const maxScore = 4;
  const pct = score / maxScore;
  const color = SEVERITY_COLOR[effectiveLevel] ?? '#94A3B8';

  // Arc SVG parameters
  const r = 40;
  const cx = 60;
  const cy = 60;
  const startAngle = -210;
  const sweepAngle = 240;

  function polarToXY(angle: number, radius: number) {
    const rad = ((angle - 90) * Math.PI) / 180;
    return {
      x: cx + radius * Math.cos(rad),
      y: cy + radius * Math.sin(rad),
    };
  }

  function describeArc(start: number, sweep: number) {
    const end = start + sweep;
    const s = polarToXY(start, r);
    const e = polarToXY(end, r);
    const largeArc = sweep > 180 ? 1 : 0;
    return `M ${s.x} ${s.y} A ${r} ${r} 0 ${largeArc} 1 ${e.x} ${e.y}`;
  }

  const validProbability = typeof probability === 'number' && Number.isFinite(probability)
    && probability >= 0 && probability <= 1
    ? probability
    : null;
  const displayPct = validProbability != null ? Math.round(validProbability * 100) : null;

  return (
    <div className={`flex flex-col items-center gap-3 ${className}`}>
      <div className="relative w-32 h-20 overflow-hidden">
        <svg viewBox="0 0 120 75" className="w-full h-full">
          {/* Track */}
          <path
            d={describeArc(startAngle, sweepAngle)}
            fill="none"
            stroke="#E2E8F0"
            strokeWidth="10"
            strokeLinecap="round"
          />
          {/* Fill */}
          {pct > 0 && (
            <path
              d={describeArc(startAngle, sweepAngle * pct)}
              fill="none"
              stroke={color}
              strokeWidth="10"
              strokeLinecap="round"
            />
          )}
          {/* Label */}
          <text x={cx} y={cy + 12} textAnchor="middle" fontSize="11" fontWeight="bold" fill={color}>
            {SEVERITY_LABEL[effectiveLevel]}
          </text>
          {displayPct != null && (
            <text x={cx} y={cy + 24} textAnchor="middle" fontSize="9" fill="#64748B">
              {displayPct}% estimated probability
            </text>
          )}
        </svg>
      </div>

      {factors.length > 0 && (
        <ul className="w-full space-y-1 text-xs">
          {factors.map((f, i) => (
            <li key={i} className="flex items-center justify-between gap-2">
              <span className="text-slate-600">{f.label}</span>
              <span className="flex items-center gap-1">
                {f.value && <span className="font-semibold text-slate-800">{f.value}</span>}
                {f.weight != null && (
                  <div className="w-16 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${Math.min(f.weight * 100, 100)}%`, backgroundColor: color }}
                    />
                  </div>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
