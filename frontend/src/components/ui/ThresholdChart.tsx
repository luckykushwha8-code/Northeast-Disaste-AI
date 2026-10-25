import React from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, ResponsiveContainer, Legend
} from 'recharts';

export interface ThresholdLine {
  value: number;
  label: string;
  color: string;
}

export interface ChartDataPoint {
  time: string;
  [key: string]: number | string;
}

interface ThresholdChartProps {
  data: ChartDataPoint[];
  lines: Array<{ key: string; label: string; color: string }>;
  thresholds?: ThresholdLine[];
  yLabel?: string;
  xKey?: string;
  height?: number;
  className?: string;
}

export const ThresholdChart: React.FC<ThresholdChartProps> = ({
  data,
  lines,
  thresholds = [],
  yLabel,
  xKey = 'time',
  height = 200,
  className = '',
}) => {
  return (
    <div className={className} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
          <XAxis
            dataKey={xKey}
            tick={{ fontSize: 10, fill: '#64748B' }}
            tickLine={false}
          />
          <YAxis
            tick={{ fontSize: 10, fill: '#64748B' }}
            axisLine={false}
            tickLine={false}
            label={yLabel ? { value: yLabel, angle: -90, position: 'insideLeft', offset: 10, style: { fontSize: 10, fill: '#64748B' } } : undefined}
          />
          <Tooltip
            contentStyle={{ fontSize: 11, border: '1px solid #E2E8F0', borderRadius: 8 }}
          />
          <Legend wrapperStyle={{ fontSize: 10 }} />
          {lines.map(l => (
            <Line
              key={l.key}
              type="monotone"
              dataKey={l.key}
              name={l.label}
              stroke={l.color}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
            />
          ))}
          {thresholds.map(t => (
            <ReferenceLine
              key={t.label}
              y={t.value}
              stroke={t.color}
              strokeDasharray="5 3"
              strokeWidth={1.5}
              label={{ value: t.label, position: 'right', fontSize: 9, fill: t.color }}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
};
