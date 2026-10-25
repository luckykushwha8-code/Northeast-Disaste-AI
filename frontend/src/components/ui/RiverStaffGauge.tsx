import React from 'react';

interface RiverStaffGaugeProps {
  currentLevel: number;
  warningLevel: number;
  dangerLevel: number;
  stationName?: string;
  unit?: string;
  className?: string;
}

export const RiverStaffGauge: React.FC<RiverStaffGaugeProps> = ({
  currentLevel,
  warningLevel,
  dangerLevel,
  stationName,
  unit = 'm',
  className = '',
}) => {
  // Determine scale range with safety margins
  const minVal = Math.min(currentLevel, warningLevel, dangerLevel) - 1.5;
  const maxVal = Math.max(currentLevel, warningLevel, dangerLevel) + 1.2;
  const H = 220;

  const getY = (val: number) => {
    const clamped = Math.max(minVal, Math.min(maxVal, val));
    return H - ((clamped - minVal) / (maxVal - minVal)) * H + 12;
  };

  const yCurrent = getY(currentLevel);
  const yWarning = getY(warningLevel);
  const yDanger = getY(dangerLevel);

  const isAboveDanger = currentLevel >= dangerLevel;
  const isAboveWarning = currentLevel >= warningLevel;

  const statusColor = isAboveDanger ? 'var(--crit, #DC2626)' : isAboveWarning ? 'var(--high, #F97316)' : 'var(--low, #16A34A)';

  return (
    <div className={`flex flex-col items-center bg-slate-50 border border-slate-200 rounded-xl p-3 shadow-inner ${className}`}>
      {stationName && (
        <span className="text-[11px] font-bold text-slate-600 mb-1 truncate max-w-[120px]">
          {stationName}
        </span>
      )}
      <svg
        className="gauge w-28 h-64"
        viewBox="0 0 110 248"
        role="img"
        aria-label={`River staff gauge: now ${currentLevel} ${unit}, warning ${warningLevel} ${unit}, danger ${dangerLevel} ${unit}`}
      >
        {/* Background Channel Staff */}
        <rect x="8" y="12" width="24" height={H} fill="#E2E8F0" rx="2" stroke="#CBD5E1" strokeWidth="1" />

        {/* River Water Column */}
        <rect
          x="8"
          y={yCurrent}
          width="24"
          height={Math.max(0, H + 12 - yCurrent)}
          fill="#0EA5E9"
          opacity="0.85"
          rx="1"
        />

        {/* Warning Threshold Line */}
        <line
          x1="4"
          x2="106"
          y1={yWarning}
          y2={yWarning}
          stroke="#D97706"
          strokeWidth="1.75"
          strokeDasharray="4 3"
        />
        <text x="36" y={yWarning + 12} fontSize="10.5" fontWeight="600" fill="#B45309" fontFamily="Public Sans, sans-serif">
          Warning {warningLevel} {unit}
        </text>

        {/* Danger Threshold Line */}
        <line
          x1="4"
          x2="106"
          y1={yDanger}
          y2={yDanger}
          stroke="#DC2626"
          strokeWidth="1.75"
          strokeDasharray="4 3"
        />
        <text x="36" y={yDanger - 4} fontSize="10.5" fontWeight="700" fill="#DC2626" fontFamily="Public Sans, sans-serif">
          Danger {dangerLevel} {unit}
        </text>

        {/* Current Reading Arrow Pointer */}
        <path d={`M34 ${yCurrent} L26 ${yCurrent - 5} L26 ${yCurrent + 5} Z`} fill="#0F172A" />
        <text
          x="36"
          y={yCurrent + 4}
          fontSize="12.5"
          fontWeight="800"
          fill={statusColor}
          fontFamily="JetBrains Mono, monospace"
        >
          Now {currentLevel} {unit}
        </text>
      </svg>
    </div>
  );
};
