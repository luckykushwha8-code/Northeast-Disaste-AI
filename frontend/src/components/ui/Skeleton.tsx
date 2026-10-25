import React from 'react';

interface SkeletonProps {
  className?: string;
  lines?: number;
}

export const Skeleton: React.FC<SkeletonProps> = ({ className = '', lines = 1 }) => {
  if (lines === 1) {
    return (
      <div
        className={`bg-slate-200 rounded animate-pulse ${className}`}
        aria-hidden="true"
      />
    );
  }

  return (
    <div className={`space-y-2 ${className}`} aria-hidden="true">
      {Array.from({ length: lines }).map((_, i) => (
        <div
          key={i}
          className={`h-3 bg-slate-200 rounded animate-pulse ${i === lines - 1 ? 'w-2/3' : 'w-full'}`}
        />
      ))}
    </div>
  );
};

export const SkeletonCard: React.FC<{ className?: string }> = ({ className = '' }) => (
  <div className={`bg-white rounded-xl border border-slate-200 shadow-sm p-4 space-y-3 ${className}`}>
    <div className="flex items-center gap-2">
      <div className="w-8 h-8 bg-slate-200 rounded-full animate-pulse" />
      <div className="flex-1 h-3 bg-slate-200 rounded animate-pulse" />
    </div>
    <Skeleton lines={3} />
  </div>
);
