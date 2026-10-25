import React from 'react';
import { Sparkles } from 'lucide-react';

interface ProposedBadgeProps {
  className?: string;
}

export const ProposedBadge: React.FC<ProposedBadgeProps> = ({ className = '' }) => (
  <span
    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-purple-50 text-purple-700 border border-purple-300 ${className}`}
    title="AI-generated — awaiting human review before any public action"
  >
    <Sparkles className="w-3 h-3" aria-hidden="true" />
    PROPOSED · AI-generated · awaiting human review
  </span>
);
