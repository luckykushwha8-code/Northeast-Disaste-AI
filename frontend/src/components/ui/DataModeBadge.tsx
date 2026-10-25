import React from 'react';
import { CheckCircle2, Clock, Archive, FlaskConical, WifiOff } from 'lucide-react';

export type DataMode = 'LIVE' | 'CACHED' | 'BASELINE' | 'SIMULATED' | 'UNAVAILABLE';

interface DataModeBadgeProps {
  mode: DataMode;
  size?: 'xs' | 'sm' | 'md';
  className?: string;
}

const MODE_CONFIG: Record<DataMode, {
  label: string;
  icon: React.ElementType;
  bg: string;
  text: string;
  border: string;
}> = {
  LIVE: {
    label: 'LIVE',
    icon: CheckCircle2,
    bg: 'bg-green-50',
    text: 'text-green-700',
    border: 'border-green-300',
  },
  CACHED: {
    label: 'CACHED',
    icon: Clock,
    bg: 'bg-blue-50',
    text: 'text-blue-700',
    border: 'border-blue-300',
  },
  BASELINE: {
    label: 'BASELINE',
    icon: Archive,
    bg: 'bg-amber-50',
    text: 'text-amber-700',
    border: 'border-amber-300',
  },
  SIMULATED: {
    label: 'SIMULATED',
    icon: FlaskConical,
    bg: 'bg-purple-50',
    text: 'text-purple-700',
    border: 'border-purple-300',
  },
  UNAVAILABLE: {
    label: 'UNAVAILABLE',
    icon: WifiOff,
    bg: 'bg-slate-50',
    text: 'text-slate-500',
    border: 'border-slate-200',
  },
};

export const DataModeBadge: React.FC<DataModeBadgeProps> = ({
  mode,
  size = 'md',
  className = '',
}) => {
  const config = MODE_CONFIG[mode] ?? MODE_CONFIG.UNAVAILABLE;
  const Icon = config.icon;

  const sizeClass = size === 'xs'
    ? 'px-1 py-0.5 text-[9px] gap-0.5'
    : size === 'sm'
    ? 'px-1.5 py-0.5 text-[10px] gap-1'
    : 'px-2 py-0.5 text-xs gap-1.5';

  const iconClass = size === 'xs' ? 'w-2 h-2' : size === 'sm' ? 'w-2.5 h-2.5' : 'w-3 h-3';

  return (
    <span
      className={`inline-flex items-center font-bold rounded-full border ${config.bg} ${config.text} ${config.border} ${sizeClass} ${className}`}
      title={`Data mode: ${config.label}`}
    >
      <Icon className={iconClass} aria-hidden="true" />
      {config.label}
    </span>
  );
};
