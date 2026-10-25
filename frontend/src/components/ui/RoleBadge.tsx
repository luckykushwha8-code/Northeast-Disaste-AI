import React from 'react';
import type { UserRole } from '../../types';

interface RoleBadgeProps {
  role: UserRole;
  className?: string;
}

const ROLE_CONFIG: Record<UserRole, { label: string; bg: string; text: string; border: string }> = {
  RESIDENT: { label: 'Resident', bg: 'bg-slate-100', text: 'text-slate-700', border: 'border-slate-300' },
  RESPONDER: { label: 'Responder', bg: 'bg-blue-100', text: 'text-blue-700', border: 'border-blue-300' },
  OPERATOR: { label: 'Operator', bg: 'bg-teal-100', text: 'text-teal-700', border: 'border-teal-400' },
  ANALYST: { label: 'Analyst', bg: 'bg-indigo-100', text: 'text-indigo-700', border: 'border-indigo-300' },
  ADMIN: { label: 'Admin', bg: 'bg-red-100', text: 'text-red-700', border: 'border-red-400' },
};

export const RoleBadge: React.FC<RoleBadgeProps> = ({ role, className = '' }) => {
  const config = ROLE_CONFIG[role] ?? ROLE_CONFIG.RESIDENT;

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold border ${config.bg} ${config.text} ${config.border} ${className}`}
      title={`Current role: ${config.label}`}
    >
      {config.label}
    </span>
  );
};
