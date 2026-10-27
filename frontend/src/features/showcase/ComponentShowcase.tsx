import React from 'react';
import { SeverityPill } from '../../components/ui/SeverityPill';
import { DataModeBadge } from '../../components/ui/DataModeBadge';
import { FreshnessBadge } from '../../components/ui/FreshnessBadge';
import { OfficialBadge } from '../../components/ui/OfficialBadge';
import { ProposedBadge } from '../../components/ui/ProposedBadge';
import { SimulationRibbon } from '../../components/ui/SimulationRibbon';
import { StatusStepper } from '../../components/ui/StatusStepper';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState } from '../../components/ui/ErrorState';
import { Skeleton } from '../../components/ui/Skeleton';
import { EmergencyContactsCard } from '../../components/ui/EmergencyContactsCard';
import { RoleBadge } from '../../components/ui/RoleBadge';
import { RiskGauge } from '../../components/ui/RiskGauge';
import { StatCard } from '../../components/ui/StatCard';
import { FlaskConical, WifiOff, Shield } from 'lucide-react';

const SHOWCASE_RECENT_UPDATE = new Date(Date.now() - 5 * 60000).toISOString();
const SHOWCASE_OLD_UPDATE = new Date(Date.now() - 200 * 60000).toISOString();

export default function ComponentShowcase() {
  return (
    <div className="space-y-8 max-w-5xl">
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
        <h1 className="text-lg font-black text-slate-900 flex items-center gap-2">
          <FlaskConical className="w-5 h-5 text-indigo-600" />
          Geo Shield — Component Showcase
        </h1>
        <p className="text-xs text-slate-500 mt-1">All UI components from the design system. Route: /dev/components</p>
      </div>

      {/* SeverityPill */}
      <Section title="SeverityPill">
        <div className="flex flex-wrap gap-3">
          {(['LOW','MODERATE','HIGH','CRITICAL','UNAVAILABLE'] as const).map(s => (
            <SeverityPill key={s} severity={s} />
          ))}
        </div>
      </Section>

      {/* DataModeBadge */}
      <Section title="DataModeBadge">
        <div className="flex flex-wrap gap-3">
          {(['LIVE','CACHED','BASELINE','SIMULATED','UNAVAILABLE'] as const).map(m => (
            <div key={m} className="flex flex-col items-center gap-1">
              <DataModeBadge mode={m} />
              <DataModeBadge mode={m} size="xs" />
            </div>
          ))}
        </div>
      </Section>

      {/* FreshnessBadge */}
      <Section title="FreshnessBadge">
        <div className="flex flex-wrap gap-3">
          <FreshnessBadge updatedAt={SHOWCASE_RECENT_UPDATE} />
          <FreshnessBadge updatedAt={SHOWCASE_OLD_UPDATE} />
          <FreshnessBadge updatedAt={null} />
        </div>
      </Section>

      {/* OfficialBadge & ProposedBadge */}
      <Section title="OfficialBadge & ProposedBadge">
        <div className="flex flex-wrap gap-3 items-center">
          <OfficialBadge agency="CWC" />
          <OfficialBadge agency="IMD" />
          <OfficialBadge agency="NDMA" />
          <ProposedBadge />
        </div>
      </Section>

      {/* SimulationRibbon */}
      <Section title="SimulationRibbon">
        <div className="relative border border-purple-200 rounded-lg overflow-hidden">
          <SimulationRibbon />
          <p className="flex items-center justify-center h-10 text-xs text-purple-900 font-semibold">Content below ribbon</p>
        </div>
      </Section>

      {/* StatusStepper */}
      <Section title="StatusStepper (Rescue States)">
        <StatusStepper currentStatus="ASSIGNED" />
        <StatusStepper currentStatus="EN_ROUTE" className="mt-4" />
        <StatusStepper currentStatus="SERVED" className="mt-4" />
      </Section>

      {/* RiskGauge */}
      <Section title="RiskGauge">
        <div className="flex flex-wrap gap-6">
          <RiskGauge category="LOW" probability={0.2} />
          <RiskGauge category="MODERATE" probability={0.5} />
          <RiskGauge category="HIGH" probability={0.75} />
          <RiskGauge category="CRITICAL" probability={0.95} />
        </div>
      </Section>

      {/* StatCard */}
      <Section title="StatCard">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard label="Critical Alerts" value={3} dataMode="LIVE" />
          <StatCard label="LIVE Sources" value="62%" dataMode="LIVE" />
          <StatCard label="Open Rescue" value={7} dataMode="CACHED" />
          <StatCard label="Districts" value={78} dataMode="BASELINE" />
        </div>
      </Section>
      {/* RoleBadge */}
      <Section title="RoleBadge">
        <div className="flex flex-wrap gap-3">
          {(['RESIDENT','RESPONDER','OPERATOR','ANALYST','ADMIN'] as const).map(r => (
            <RoleBadge key={r} role={r} />
          ))}
        </div>
      </Section>

      {/* EmptyState */}
      <Section title="EmptyState">
        <EmptyState icon={Shield} title="No alerts" description="No alerts match the current filters." />
      </Section>

      {/* ErrorState */}
      <Section title="ErrorState">
        <ErrorState message="Failed to load data: HTTP 503" onRetry={() => alert('Retry!')} />
      </Section>

      {/* Skeleton */}
      <Section title="Skeleton">
        <div className="space-y-2">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-32 w-full" />
        </div>
      </Section>

      {/* OfflineBanner (always shown in showcase) */}
      <Section title="OfflineBanner (forced show)">
        <div className="bg-slate-900 text-white flex items-center gap-2 px-4 py-2.5 text-xs font-semibold rounded-lg">
          <WifiOff className="w-4 h-4 text-amber-400" />
          <span>You are offline. Showing cached data. Rescue form submissions will queue locally and retry when reconnected.</span>
        </div>
      </Section>

      {/* EmergencyContactsCard */}
      <Section title="EmergencyContactsCard">
        <EmergencyContactsCard />
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
      <h2 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-3">{title}</h2>
      {children}
    </div>
  );
}
