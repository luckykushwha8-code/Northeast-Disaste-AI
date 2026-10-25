import React from 'react';
import { CheckCircle2, Clock, AlertTriangle } from 'lucide-react';

export type FreshnessState = 'FRESH' | 'STALE' | 'MISSING';

interface FreshnessBadgeProps {
  state?: FreshnessState;
  updatedAt?: string | null; // ISO timestamp
  className?: string;
}

function formatMinutesAgo(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (diff < 1) return 'just now';
  if (diff === 1) return '1 min ago';
  return `${diff} min ago`;
}

function toIST(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: true });
}

const STATE_CONFIG: Record<FreshnessState, {
  icon: React.ElementType;
  text: string;
  label: string;
}> = {
  FRESH: { icon: CheckCircle2, text: 'text-green-700', label: 'FRESH' },
  STALE: { icon: Clock, text: 'text-amber-600', label: 'STALE' },
  MISSING: { icon: AlertTriangle, text: 'text-red-600', label: 'MISSING' },
};

export const FreshnessBadge: React.FC<FreshnessBadgeProps> = ({
  state,
  updatedAt,
  className = '',
}) => {
  let resolvedState: FreshnessState = state || 'MISSING';
  if (!state) {
    if (!updatedAt) {
      resolvedState = 'MISSING';
    } else {
      const diffHours = (Date.now() - new Date(updatedAt).getTime()) / (1000 * 3600);
      resolvedState = diffHours > 3 ? 'STALE' : 'FRESH';
    }
  }

  const config = STATE_CONFIG[resolvedState];
  const Icon = config.icon;

  const relTime = updatedAt ? formatMinutesAgo(updatedAt) : null;
  const istTime = updatedAt ? toIST(updatedAt) : null;

  return (
    <span
      className={`inline-flex items-center gap-1 text-xs font-semibold ${config.text} ${className}`}
      title={istTime ? `Updated at ${istTime} IST` : undefined}
    >
      <Icon className="w-3 h-3" aria-hidden="true" />
      <span>{config.label}</span>
      {relTime && (
        <span className="font-normal text-slate-500">· {relTime}</span>
      )}
    </span>
  );
};
