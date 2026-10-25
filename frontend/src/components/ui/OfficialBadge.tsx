import React from 'react';
import { Shield } from 'lucide-react';

interface OfficialBadgeProps {
  agency?: string;
  className?: string;
}

export const OfficialBadge: React.FC<OfficialBadgeProps> = ({
  agency,
  className = '',
}) => (
  <span
    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-blue-700 text-white border border-blue-800 ${className}`}
    title="Officially issued by a government agency"
  >
    <Shield className="w-3 h-3" aria-hidden="true" />
    OFFICIAL{agency ? ` · ${agency}` : ''}
  </span>
);
