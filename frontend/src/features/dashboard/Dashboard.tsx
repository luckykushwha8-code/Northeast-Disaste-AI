import React, { lazy, Suspense, useEffect, useState } from 'react';
import type { UserRole, LocationItem, AlertItem, ShelterItem, IncidentReportItem } from '../../types';
import { api } from '../../api/client';
import { ErrorState } from '../../components/ui/ErrorState';
import { Skeleton } from '../../components/ui/Skeleton';
import { PreparednessAssistant } from '../../components/PreparednessAssistant';
import { useVisibleRefresh } from '../../hooks/useVisibleRefresh';

const DistrictMap = lazy(() => import('../../components/MapBoard').then(module => ({ default: module.MapBoard })));

interface DashboardProps {
  userRole?: UserRole;
  lang?: 'en' | 'as' | 'bn' | 'hi';
}

export default function Dashboard({ userRole: _userRole = 'OPERATOR' }: DashboardProps) {
  const [locations, setLocations] = useState<LocationItem[]>([]);
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [shelters, setShelters] = useState<ShelterItem[]>([]);
  const [reports, setReports] = useState<IncidentReportItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function loadMapData() {
    setError(null);
    try {
      const [nextLocations, nextAlerts, nextShelters, nextReports] = await Promise.all([
        api.getLocations(), api.getPublicAlerts(), api.getShelters(), api.getReports()
      ]);
      setLocations(nextLocations);
      setAlerts(nextAlerts);
      setShelters(nextShelters);
      setReports(nextReports);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load map data');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadMapData(); }, 0);
    return () => window.clearTimeout(timer);
  }, []);
  useVisibleRefresh(loadMapData, 5 * 60 * 1000);

  if (loading) return <div className="w-full rounded-xl" style={{ height: 'calc(100vh - 10rem)', minHeight: 620 }}><Skeleton className="h-full w-full" /></div>;
  if (error) return <ErrorState message={error} onRetry={() => { setLoading(true); void loadMapData(); }} />;

  return (
    <main className="space-y-3" aria-label="Northeast India district risk map">
      <div style={{ height: 'calc(100vh - 10rem)', minHeight: 620 }}>
        <Suspense fallback={<Skeleton className="h-full w-full rounded-xl" />}>
          <DistrictMap locations={locations} alerts={alerts} shelters={shelters} reports={reports} />
        </Suspense>
      </div>
      <div className="max-w-2xl">
        <PreparednessAssistant />
      </div>
    </main>
  );
}
