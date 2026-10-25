import React from 'react';
import { Circle, Diamond, Triangle, Octagon } from 'lucide-react';
import type { SeverityLevel } from '../../types';

interface SeverityPillProps {
  severity: SeverityLevel;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const SEVERITY_CONFIG: Record<SeverityLevel, {
  label: string;
  icon: React.ElementType;
  bg: string;
  text: string;
  border: string;
}> = {
  LOW: {
    label: 'LOW',
    icon: Circle,
    bg: 'bg-green-50',
    text: 'text-green-700',
    border: 'border-green-300',
  },
  MODERATE: {
    label: 'MODERATE',
    icon: Diamond,
    bg: 'bg-yellow-50',
    text: 'text-yellow-700',
    border: 'border-yellow-300',
  },
  HIGH: {
    label: 'HIGH',
    icon: Triangle,
    bg: 'bg-orange-50',
    text: 'text-orange-700',
    border: 'border-orange-300',
  },
  CRITICAL: {
    label: 'CRITICAL',
    icon: Octagon,
    bg: 'bg-red-50',
    text: 'text-red-700',
    border: 'border-red-300',
  },
  UNAVAILABLE: {
    label: 'N/A',
    icon: Circle,
    bg: 'bg-slate-50',
    text: 'text-slate-500',
    border: 'border-slate-200',
  },
};

const SIZE_CONFIG = {
  sm: { pill: 'px-1.5 py-0.5 text-[10px] gap-1', icon: 'w-2.5 h-2.5' },
  md: { pill: 'px-2 py-1 text-xs gap-1.5', icon: 'w-3 h-3' },
  lg: { pill: 'px-3 py-1.5 text-sm gap-2', icon: 'w-4 h-4' },
};

export const SeverityPill: React.FC<SeverityPillProps> = ({
  severity,
  size = 'md',
  className = '',
}) => {
  const config = SEVERITY_CONFIG[severity] ?? SEVERITY_CONFIG.UNAVAILABLE;
  const sizeClass = SIZE_CONFIG[size];
  const Icon = config.icon;

  return (
    <span
      className={`inline-flex items-center font-bold rounded-full border ${config.bg} ${config.text} ${config.border} ${sizeClass.pill} ${className}`}
      aria-label={`Severity: ${config.label}`}
    >
      <Icon className={sizeClass.icon} aria-hidden="true" />
      {config.label}
    </span>
  );
};
