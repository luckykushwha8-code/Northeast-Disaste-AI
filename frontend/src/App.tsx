import React, { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { BrowserRouter, Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import {
  Activity, BarChart2, Bell, Bot, FileText, FlaskConical, Layers,
  LayoutDashboard, LifeBuoy, Mail, Map, MapPinned, X
} from 'lucide-react';

import { OfflineBanner } from './components/ui/OfflineBanner';
import { ToastProvider, useToast } from './components/ui/Toast';
import { PreparednessAssistant } from './components/PreparednessAssistant';
import { api } from './api/client';
import { useVisibleRefresh } from './hooks/useVisibleRefresh';
import type { AlertItem, Language, PredictionItem, UserRole } from './types';

const Dashboard = lazy(() => import('./features/dashboard/Dashboard'));
const AlertQueuePage = lazy(() => import('./components/AlertQueue').then(m => ({ default: m.AlertQueue })));
const RescuePage = lazy(() => import('./features/rescue/RescuePage'));
const AnalyticsPage = lazy(() => import('./features/analytics/Analytics'));
const ModelsPage = lazy(() => import('./features/models/ModelsPage'));
const ReportsPage = lazy(() => import('./features/reports/ReportsPage'));
const SubscriptionsPage = lazy(() => import('./features/subscriptions/SubscriptionsPage'));
const SystemHealthPage = lazy(() => import('./components/SystemHealth').then(m => ({ default: m.SystemHealth })));
const ComponentShowcase = lazy(() => import('./features/showcase/ComponentShowcase'));
const MapBoardPage = lazy(() => import('./components/MapBoard').then(m => ({ default: m.MapBoard })));
const LayersGuidePage = lazy(() => import('./features/map/LayersGuidePage'));

const NAV_ITEMS = [
  { path: '/', label: 'Overview', icon: LayoutDashboard },
  { path: '/map', label: 'District map', icon: Map },
  { path: '/alerts', label: 'Alerts', icon: Bell },
  { path: '/rescue', label: 'Response', icon: LifeBuoy },
  { path: '/analytics', label: 'Analytics', icon: BarChart2 },
  { path: '/models', label: 'Models', icon: FlaskConical },
  { path: '/reports', label: 'Reports', icon: FileText },
  { path: '/subscriptions', label: 'Subscriptions', icon: Mail },
  { path: '/system', label: 'System', icon: Activity },
  { path: '/layers', label: 'Map layers', icon: Layers },
];

const LANGUAGES: { code: Language; label: string }[] = [
  { code: 'en', label: 'EN' }, { code: 'as', label: 'অস' },
  { code: 'bn', label: 'বাং' }, { code: 'hi', label: 'हिं' },
];

function LoadingFallback() {
  return <div className="flex h-64 items-center justify-center text-sm text-slate-400">Loading…</div>;
}

function AppShell() {
  const { addToast } = useToast();
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [lang, setLang] = useState<Language>('en');
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [predictions, setPredictions] = useState<PredictionItem[]>([]);
  const [locations, setLocations] = useState<any[]>([]);
  const [shelters, setShelters] = useState<any[]>([]);
  const [reports, setReports] = useState<any[]>([]);
  const location = useLocation();
  const userRole: UserRole = 'RESIDENT';

  useEffect(() => {
    // The public dashboard has no staff sign-in surface. Clear any old browser session
    // so staff-only controls remain unavailable here; backend authorization stays intact.
    api.logout();
  }, []);

  const refreshAppData = useCallback(async () => {
    const results = await Promise.allSettled([
      api.getPublicAlerts(),
      api.getPredictions(), api.getLocations(), api.getShelters(), api.getReports(),
    ]);
    if (results[0].status === 'fulfilled') setAlerts(results[0].value);
    if (results[1].status === 'fulfilled') setPredictions(results[1].value);
    if (results[2].status === 'fulfilled') setLocations(results[2].value);
    if (results[3].status === 'fulfilled') setShelters(results[3].value);
    if (results[4].status === 'fulfilled') setReports(results[4].value);
  }, []);

  const explainStaffAccess = useCallback(() => addToast({
    type: 'info',
    title: 'Staff access is restricted',
    message: 'Staff login was removed from the public interface. Protected actions still require server-side staff authorization.',
  }), [addToast]);

  useEffect(() => { void refreshAppData(); }, [refreshAppData]);
  useVisibleRefresh(refreshAppData, 5 * 60 * 1000);

  const simulationActive = alerts.some(alert => alert.simulation_flag) || predictions.some(item => item.simulation_flag);
  const alertCount = alerts.filter(alert => ['PROPOSED', 'ISSUED'].includes(alert.lifecycle_status)).length;

  return (
    <div className="flex h-dvh min-h-0 flex-col overflow-hidden bg-[#f7f5f2] font-sans text-slate-900">
      <OfflineBanner />

      <header className="relative z-50 shrink-0 border-b border-[#e8e1d8] bg-white shadow-[0_2px_10px_rgba(60,45,30,0.04)]">
        <div className="mx-auto flex h-[68px] max-w-[1680px] items-center gap-4 px-4 sm:px-6 lg:px-8">
          <NavLink to="/" className="flex min-w-0 shrink-0 items-center gap-3" aria-label="Geo Shield home">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#6f513e] text-white shadow-sm"><MapPinned className="h-5 w-5" /></span>
            <span className="min-w-0">
              <span className="block truncate text-[15px] font-bold tracking-tight text-[#503b2d]">Geo Shield</span>
              <span className="hidden text-[10px] font-medium tracking-wide text-slate-500 sm:block">NORTHEAST INDIA · RISK MONITOR</span>
            </span>
          </NavLink>

          <div className="hidden h-8 w-px bg-[#e8e1d8] lg:block" />
          <div className="hidden min-w-0 items-center gap-2 text-xs text-slate-500 lg:flex">
            <span className="h-2 w-2 rounded-full bg-emerald-500" /> Regional monitoring workspace
          </div>

          <div className="ml-auto flex shrink-0 items-center gap-2">
            {simulationActive && <span className="hidden rounded-full border border-amber-300 bg-amber-50 px-2.5 py-1 text-[10px] font-semibold text-amber-800 sm:inline-flex">Demo records present</span>}
            <select value={lang} onChange={event => setLang(event.target.value as Language)} className="rounded-lg border border-[#e8e1d8] bg-white px-2 py-2 text-xs text-slate-700 outline-none transition focus:border-[#9b7b62]" aria-label="Language">
              {LANGUAGES.map(item => <option key={item.code} value={item.code}>{item.label}</option>)}
            </select>
            <NavLink to="/alerts" className="relative rounded-lg border border-[#e8e1d8] p-2 text-slate-500 transition hover:bg-[#f7f5f2] hover:text-[#6f513e]" aria-label={`Alerts${alertCount ? `, ${alertCount} active` : ''}`}>
              <Bell className="h-4 w-4" />
              {alertCount > 0 && <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[9px] font-bold text-white">{alertCount > 99 ? '99+' : alertCount}</span>}
            </NavLink>
          </div>
        </div>

        <nav className="border-t border-[#f0ebe5]" aria-label="Main navigation">
          <div className="mx-auto flex max-w-[1680px] items-center gap-1 overflow-x-auto px-3 py-2 sm:px-6 lg:px-8">
            {NAV_ITEMS.map(item => {
              const Icon = item.icon;
              const active = location.pathname === item.path || (item.path !== '/' && location.pathname.startsWith(item.path));
              return <NavLink key={item.path} to={item.path} title={item.label} className={`inline-flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium transition-colors ${active ? 'bg-[#f2ece5] text-[#5e4532]' : 'text-slate-600 hover:bg-[#faf8f6] hover:text-[#5e4532]'}`}>
                <Icon className={`h-4 w-4 ${active ? 'text-[#806047]' : 'text-slate-400'}`} />{item.label}
              </NavLink>;
            })}
          </div>
        </nav>
      </header>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <main className={`flex-1 min-h-0 p-4 md:p-6 ${location.pathname === '/map' ? 'overflow-hidden' : 'overflow-y-auto'}`}>
          <Suspense fallback={<LoadingFallback />}>
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/map" element={<MapBoardPage locations={locations} alerts={alerts} shelters={shelters} reports={reports} />} />
              <Route path="/layers" element={<LayersGuidePage />} />
              <Route path="/alerts" element={<AlertQueuePage alerts={alerts} predictions={predictions} userRole={userRole} lang={lang} onRequestLogin={explainStaffAccess} onRefresh={() => api.getPublicAlerts().then(setAlerts)} />} />
              <Route path="/rescue" element={<RescuePage userRole={userRole} onRequestLogin={explainStaffAccess} />} />
              <Route path="/analytics" element={<AnalyticsPage />} />
              <Route path="/models" element={<ModelsPage userRole={userRole} onRequestLogin={explainStaffAccess} />} />
              <Route path="/reports" element={<ReportsPage userRole={userRole} onRequestLogin={explainStaffAccess} />} />
              <Route path="/subscriptions" element={<SubscriptionsPage />} />
              <Route path="/system" element={<SystemHealthPage userRole={userRole} onRequestLogin={explainStaffAccess} onRefresh={() => { void api.getPublicAlerts().then(setAlerts); }} />} />
              <Route path="/dev/components" element={<ComponentShowcase />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </main>
      </div>

      <div className="fixed bottom-5 right-5 z-[1000] flex flex-col items-end gap-3">
        {assistantOpen && <div className="w-[min(23rem,calc(100vw-2rem))] rounded-2xl border border-[#e8e1d8] bg-white p-3 shadow-[0_18px_60px_rgba(50,35,20,0.2)]">
          <div className="mb-2 flex items-center justify-between px-1">
            <span className="inline-flex items-center gap-2 text-sm font-semibold text-[#503b2d]"><Bot className="h-4 w-4 text-[#806047]" /> Preparedness assistant</span>
            <button onClick={() => setAssistantOpen(false)} className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Close assistant"><X className="h-4 w-4" /></button>
          </div>
          <PreparednessAssistant />
        </div>}
        <button onClick={() => setAssistantOpen(open => !open)} className="inline-flex items-center gap-2 rounded-full bg-[#6f513e] px-4 py-3 text-sm font-semibold text-white shadow-lg transition hover:bg-[#59412f] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#9b7b62]" aria-expanded={assistantOpen} aria-label={assistantOpen ? 'Close preparedness assistant' : 'Open preparedness assistant'}>
          {assistantOpen ? <X className="h-4 w-4" /> : <Bot className="h-4 w-4" />}<span className="hidden sm:inline">AI assistant</span>
        </button>
      </div>

    </div>
  );
}

export const App: React.FC = () => <BrowserRouter><ToastProvider><AppShell /></ToastProvider></BrowserRouter>;
export default App;
