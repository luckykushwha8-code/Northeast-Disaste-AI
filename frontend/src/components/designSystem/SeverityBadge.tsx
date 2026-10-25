import React from 'react';

export type SeverityLevel = 'LOW' | 'MODERATE' | 'HIGH' | 'CRITICAL' | string;

interface SeverityBadgeProps {
  level: SeverityLevel;
  score?: number | null;
  size?: 'sm' | 'md' | 'lg';
  showLabel?: boolean;
  className?: string;
}

export const SeverityBadge: React.FC<SeverityBadgeProps> = ({
  level,
  score,
  size = 'md',
  showLabel = true,
  className = ''
}) => {
  const norm = (level || 'LOW').toUpperCase();

  const getShape = () => {
    switch (norm) {
      case 'CRITICAL':
        return {
          symbol: '⬣',
          label: 'Critical',
          badgeClass: 'bg-red-50 text-red-700 border-red-200',
          iconClass: 'text-red-600 pulse-critical font-black'
        };
      case 'HIGH':
        return {
          symbol: '▲',
          label: 'High',
          badgeClass: 'bg-orange-50 text-orange-700 border-orange-200',
          iconClass: 'text-orange-600 font-bold'
        };
      case 'MODERATE':
        return {
          symbol: '◆',
          label: 'Moderate',
          badgeClass: 'bg-amber-50 text-amber-700 border-amber-200',
          iconClass: 'text-amber-600 font-bold'
        };
      case 'LOW':
        return {
          symbol: '●',
          label: 'Low',
          badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200',
          iconClass: 'text-emerald-600 font-bold'
        };
      default:
        return {
          symbol: '—',
          label: 'Unknown',
          badgeClass: 'bg-slate-50 text-slate-600 border-slate-200',
          iconClass: 'text-slate-500 font-bold'
        };
    }
  };

  const info = getShape();
  const sizeClasses = {
    sm: 'text-[10px] px-1.5 py-0.5 gap-1',
    md: 'text-xs px-2.5 py-1 gap-1.5',
    lg: 'text-sm px-3 py-1.5 gap-2'
  }[size];

  return (
    <span
      className={`inline-flex items-center font-semibold rounded-md border ${info.badgeClass} ${sizeClasses} ${className}`}
      title={`${info.label} severity level`}
    >
      <span className={info.iconClass} aria-hidden="true">{info.symbol}</span>
      {showLabel && <span>{info.label}</span>}
      {score !== undefined && score !== null && (
        <span className="font-reading text-[11px] font-bold opacity-80">
          {score}/100
        </span>
      )}
    </span>
  );
};

export type DataMode = 'LIVE' | 'CACHED' | 'BASELINE' | 'SIMULATED' | 'UNAVAILABLE' | string;

export const DataModeBadge: React.FC<{ mode: DataMode; timestamp?: string | null; className?: string }> = ({
  mode,
  timestamp,
  className = ''
}) => {
  const norm = (mode || 'LIVE').toUpperCase();

  const getStyle = () => {
    switch (norm) {
      case 'LIVE':
        return {
          dot: 'bg-emerald-500',
          label: 'LIVE',
          style: 'bg-emerald-50 text-emerald-800 border-emerald-200'
        };
      case 'CACHED':
        return {
          dot: 'bg-blue-500',
          label: 'CACHED',
          style: 'bg-blue-50 text-blue-800 border-blue-200'
        };
      case 'BASELINE':
        return {
          dot: 'bg-amber-500',
          label: 'BASELINE',
          style: 'bg-amber-50 text-amber-800 border-amber-200'
        };
      case 'SIMULATED':
        return {
          dot: 'bg-purple-600',
          label: 'SIMULATED',
          style: 'badge-simulated'
        };
      case 'UNAVAILABLE':
      default:
        return {
          dot: 'bg-slate-400',
          label: 'UNAVAILABLE',
          style: 'bg-slate-100 text-slate-600 border-slate-200'
        };
    }
  };

  const info = getStyle();

  return (
    <span
      className={`inline-flex items-center gap-1.5 text-[10px] font-bold px-2 py-0.5 rounded-full border ${info.style} ${className}`}
      title={`Data mode: ${info.label}${timestamp ? ` · Updated ${timestamp}` : ''}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${info.dot}`} />
      <span>{info.label}</span>
      {timestamp && (
        <span className="font-reading opacity-75 font-normal">· {timestamp}</span>
      )}
    </span>
  );
};
