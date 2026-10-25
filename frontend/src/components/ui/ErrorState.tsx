import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface ErrorStateProps {
  message?: string;
  onRetry?: () => void;
  className?: string;
}

export const ErrorState: React.FC<ErrorStateProps> = ({
  message = 'Something went wrong. Please try again.',
  onRetry,
  className = '',
}) => (
  <div className={`flex flex-col items-center justify-center py-12 px-6 text-center ${className}`}>
    <div className="w-12 h-12 rounded-full bg-red-50 flex items-center justify-center mb-4">
      <AlertTriangle className="w-6 h-6 text-red-500" aria-hidden="true" />
    </div>
    <p className="text-sm font-semibold text-red-700">Error</p>
    <p className="text-xs text-slate-500 mt-1 max-w-xs">{message}</p>
    {onRetry && (
      <button
        onClick={onRetry}
        className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-white border border-slate-200 rounded-lg text-slate-700 hover:bg-slate-50 transition"
      >
        <RefreshCw className="w-3.5 h-3.5" />
        Retry
      </button>
    )}
  </div>
);
