import React from 'react';
import { Search } from 'lucide-react';

interface EmptyStateProps {
  icon?: React.ElementType;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon: Icon = Search,
  title,
  description,
  action,
  className = '',
}) => (
  <div className={`flex flex-col items-center justify-center py-12 px-6 text-center ${className}`}>
    <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center mb-4">
      <Icon className="w-6 h-6 text-slate-400" aria-hidden="true" />
    </div>
    <h3 className="text-sm font-semibold text-slate-700">{title}</h3>
    {description && (
      <p className="text-xs text-slate-400 mt-1 max-w-xs">{description}</p>
    )}
    {action && <div className="mt-4">{action}</div>}
  </div>
);
