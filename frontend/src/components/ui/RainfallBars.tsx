import React, { useId } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell
} from 'recharts';

export interface RainfallBarPoint {
  time: string;
  observed_mm: number;
  gapfill_mm?: number; // Open-Meteo gap-filled
}

interface RainfallBarsProps {
  data: RainfallBarPoint[];
  height?: number;
  className?: string;
}

// Custom bar shape for hatched (gap-filled) bars
function HatchedBar(props: {
  x?: number; y?: number; width?: number; height?: number; value?: number
}) {
  const patternId = useId().replace(/:/g, '');
  const { x = 0, y = 0, width = 0, height = 0, value } = props;
  if (!value || value <= 0) return null;
  const id = `hatch-${patternId}`;
  return (
    <g>
      <defs>
        <pattern id={id} patternUnits="userSpaceOnUse" width="4" height="4" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="4" stroke="#2563EB" strokeWidth="1.5" />
        </pattern>
      </defs>
      <rect x={x} y={y} width={width} height={height} fill={`url(#${id})`} stroke="#2563EB" strokeWidth={1} />
    </g>
  );
}

export const RainfallBars: React.FC<RainfallBarsProps> = ({
  data,
  height = 180,
  className = '',
}) => {
  return (
    <div className={className} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 4 }} barCategoryGap="20%">
          <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
          <XAxis dataKey="time" tick={{ fontSize: 10, fill: '#64748B' }} tickLine={false} />
          <YAxis tick={{ fontSize: 10, fill: '#64748B' }} axisLine={false} tickLine={false} label={{ value: 'mm', angle: -90, position: 'insideLeft', offset: 10, style: { fontSize: 10, fill: '#64748B' } }} />
          <Tooltip
            contentStyle={{ fontSize: 11, border: '1px solid #E2E8F0', borderRadius: 8 }}
            formatter={(value, name) => [
              `${value ?? 0} mm`,
              name === 'observed_mm' ? 'Observed (IMD)' : 'Gap-filled (Open-Meteo)',
            ]}
          />
          {/* Observed bars (solid) */}
          <Bar dataKey="observed_mm" name="Observed (IMD)" fill="#0F766E" radius={[2, 2, 0, 0]} maxBarSize={24}>
            {data.map((entry, idx) => (
              <Cell key={idx} fill={entry.gapfill_mm ? '#94A3B8' : '#0F766E'} />
            ))}
          </Bar>
          {/* Gap-filled bars (hatched via custom shape) */}
          <Bar
            dataKey="gapfill_mm"
            name="Gap-filled (Open-Meteo)"
            shape={(props: object) => <HatchedBar {...(props as Parameters<typeof HatchedBar>[0])} />}
            radius={[2, 2, 0, 0]}
            maxBarSize={24}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
};
