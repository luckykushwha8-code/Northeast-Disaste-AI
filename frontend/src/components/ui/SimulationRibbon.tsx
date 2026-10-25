import React from 'react';
import { FlaskConical } from 'lucide-react';

interface SimulationRibbonProps {
  label?: string;
  compact?: boolean;
  className?: string;
}

export const SimulationRibbon: React.FC<SimulationRibbonProps> = ({
  label = 'Demo records present',
  compact = false,
  className = '',
}) => (
  <div
    className={`w-full flex items-center justify-center gap-1.5 ${compact ? 'py-0.5 px-2 text-[10px]' : 'py-1.5 px-4 text-xs'} text-white font-bold tracking-wide ${className}`}
    style={{
      background: 'repeating-linear-gradient(-45deg, #7C3AED, #7C3AED 10px, #5B21B6 10px, #5B21B6 20px)',
    }}
    role="status"
    aria-label="Demo records are present"
  >
    <FlaskConical className={`${compact ? 'w-3 h-3' : 'w-3.5 h-3.5'} flex-shrink-0`} aria-hidden="true" />
    <span>{label}</span>
  </div>
);
