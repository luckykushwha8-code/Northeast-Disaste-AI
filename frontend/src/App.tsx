import React, { useState, useEffect, useCallback } from 'react';
import { BrowserRouter, Routes, Route, NavLink, useLocation, Navigate } from 'react-router-dom';
import {
  LayoutDashboard, Map, Bell, LifeBuoy, BarChart2, FlaskConical,
  FileText, Mail, Activity, ChevronLeft, ChevronRight, Moon, Sun,
  AlignJustify, Layers, LogIn, LogOut
} from 'lucide-react';

import { RoleBadge } from './components/ui/RoleBadge';
import { OfflineBanner } from './components/ui/OfflineBanner';
import { ToastProvider } from './components/ui/Toast';
import { AuthDialog } from './components/AuthDialog';
import { api } from './api/client';
import { useVisibleRefresh } from './hooks/useVisibleRefresh';
import type { UserRole, Language, AlertItem, PredictionItem, AuthenticatedUser } from './types';

// Lazy-load pages
import { lazy, Suspense } from 'react';
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

type NavItem = {
  path: string;
  label: string;
  icon: React.ElementType;
};

const NAV_ITEMS: NavItem[] = [
  { path: '/', label: 'Dashboard', icon: LayoutDashboard },
  { path: '/map', label: 'District Map', icon: Map },
  { path: '/layers', label: 'Layers & legend', icon: Layers },
  { path: '/alerts', label: 'Alert Queue', icon: Bell },
  { path: '/rescue', label: 'Rescue', icon: LifeBuoy },
  { path: '/analytics', label: 'Analytics', icon: BarChart2 },
  { path: '/models', label: 'Models', icon: FlaskConical },
  { path: '/reports', label: 'Reports', icon: FileText },
  { path: '/subscriptions', label: 'Subscriptions', icon: Mail },
  { path: '/system', label: 'System Health', icon: Activity },
];

const MOBILE_NAV: NavItem[] = [
  { path: '/', label: 'Dashboard', icon: LayoutDashboard },
  { path: '/map', label: 'District Map', icon: Map },
  { path: '/layers', label: 'Layers', icon: Layers },
  { path: '/alerts', label: 'Alerts', icon: Bell },
  { path: '/rescue', label: 'Rescue', icon: LifeBuoy },
  { path: '/analytics', label: 'Analytics', icon: BarChart2 },
  { path: '/models', label: 'Models', icon: FlaskConical },
  { path: '/reports', label: 'Reports', icon: FileText },
  { path: '/system', label: 'System', icon: Activity },
  { path: '/subscriptions', label: 'Subscribe', icon: Mail },
];

const LANGUAGES: { code: Language; label: string }[] = [
  { code: 'en', label: 'EN' },
  { code: 'as', label: 'অস' },
  { code: 'bn', label: 'বাং' },
  { code: 'hi', label: 'हिं' },
];

function LoadingFallback() {
  return (
    <div className="flex items-center justify-center h-64 text-slate-400 text-sm animate-pulse">
      Loading…
    </div>
  );
}

function AppShell() {
  const [collapsed, setCollapsed] = useState(false);
  const [darkMode, setDarkMode] = useState(false);
  const [authenticatedUser, setAuthenticatedUser] = useState<AuthenticatedUser | null>(null);
  const [loginOpen, setLoginOpen] = useState(false);
  const userRole: UserRole = authenticatedUser?.role ?? 'RESIDENT';
  const [lang, setLang] = useState<Language>('en');
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [predictions, setPredictions] = useState<PredictionItem[]>([]);
  const [locations, setLocations] = useState<any[]>([]);
  const [shelters, setShelters] = useState<any[]>([]);
  const [reports, setReports] = useState<any[]>([]);
  const location = useLocation();


  useEffect(() => {
    api.getCurrentUser().then(setAuthenticatedUser).catch(() => setAuthenticatedUser(null));
    const onExpired = () => setAuthenticatedUser(null);
    window.addEventListener('nesafe:auth-expired', onExpired);
    return () => window.removeEventListener('nesafe:auth-expired', onExpired);
  }, []);

  // Public views use sanitized, verified data. Staff see the full alert queue after login.
  const refreshAppData = useCallback(async () => {
    const results = await Promise.allSettled([
      authenticatedUser ? api.getAlerts() : api.getPublicAlerts(),
      api.getPredictions(),
      api.getLocations(),
      api.getShelters(),
      api.getReports(),
    ]);
    if (results[0].status === 'fulfilled') setAlerts(results[0].value);
    if (results[1].status === 'fulfilled') setPredictions(results[1].value);
    if (results[2].status === 'fulfilled') setLocations(results[2].value);
    if (results[3].status === 'fulfilled') setShelters(results[3].value);
    if (results[4].status === 'fulfilled') setReports(results[4].value);
  }, [authenticatedUser]);

  useEffect(() => { void refreshAppData(); }, [refreshAppData]);
  useVisibleRefresh(refreshAppData, 5 * 60 * 1000);


  // Dark mode
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', darkMode ? 'dark' : 'light');
    document.documentElement.classList.toggle('dark', darkMode);
  }, [darkMode]);

  const isSimulationActive = alerts.some(a => a.simulation_flag) || predictions.some(p => p.simulation_flag);
  const proposedCount = alerts.filter(a => a.lifecycle_status === 'PROPOSED').length;
  const activeCount = alerts.filter(a => a.lifecycle_status === 'ISSUED').length;
  const bellCount = proposedCount + activeCount;


  return (
    <div className={`h-dvh min-h-0 overflow-hidden flex flex-col font-sans ${darkMode ? 'bg-slate-900 text-slate-100' : 'bg-slate-50 text-slate-900'}`}>
      <OfflineBanner />

      {/* Sticky Top Header */}
      <header className={`sticky top-0 z-50 h-14 flex items-center justify-between px-2 sm:px-4 gap-1 sm:gap-3 border-b shadow-sm ${darkMode ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-200'}`}>
        {/* Logo + hamburger */}
        <div className="flex items-center gap-3 flex-shrink-0">
          <button
            onClick={() => setCollapsed(c => !c)}
            className="p-1.5 rounded-lg text-slate-400 hover:text-teal-700 hover:bg-slate-100 transition hidden md:flex"
            aria-label="Toggle sidebar"
          >
            <AlignJustify className="w-4 h-4" />
          </button>
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-teal-700 flex items-center justify-center text-white font-black text-xs">NE</div>
            <span className="font-black text-teal-700 text-sm hidden sm:inline">NE-SAFE AI</span>
            {isSimulationActive && <span className="rounded-full border border-amber-300 bg-amber-50 px-1.5 sm:px-2 py-0.5 text-[10px] font-semibold text-amber-800"><span className="sm:hidden">Demo</span><span className="hidden sm:inline">Demo records present</span></span>}
          </div>
        </div>

        {/* Right controls */}
        <div className="flex items-center gap-2 ml-auto">
          {authenticatedUser ? (
            <>
              <span className="hidden sm:inline-flex"><RoleBadge role={authenticatedUser.role} /></span>
              <button onClick={() => { api.logout(); setAuthenticatedUser(null); }} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1.5 text-[11px] font-semibold text-slate-600 hover:bg-slate-50" aria-label={`Sign out ${authenticatedUser.username}`}>
                <LogOut className="h-3.5 w-3.5" /><span className="hidden sm:inline">Sign out</span>
              </button>
            </>
          ) : (
            <button onClick={() => setLoginOpen(true)} className="inline-flex items-center gap-1 rounded-lg bg-teal-700 px-2.5 py-1.5 text-[11px] font-bold text-white hover:bg-teal-800">
              <LogIn className="h-3.5 w-3.5" /> Staff login
            </button>
          )}

          {/* Language */}
          <select
            value={lang}
            onChange={e => setLang(e.target.value as Language)}
            className={`text-xs px-1 sm:px-2 py-1 rounded-lg border ${darkMode ? 'bg-slate-700 border-slate-600 text-slate-100' : 'bg-slate-50 border-slate-200 text-slate-700'} focus:outline-none`}
            aria-label="Language"
          >
            {LANGUAGES.map(l => (
              <option key={l.code} value={l.code}>{l.label}</option>
            ))}
          </select>

          {/* Theme toggle */}
          <button
            onClick={() => setDarkMode(d => !d)}
            className={`p-1.5 rounded-lg transition ${darkMode ? 'text-yellow-400 hover:bg-slate-700' : 'text-slate-500 hover:bg-slate-100'}`}
            aria-label={darkMode ? 'Switch to light mode' : 'Switch to dark (Night Ops) mode'}
          >
            {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>

          {/* Bell */}
          <button className="relative p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 transition" aria-label="Notifications">
            <Bell className="w-4 h-4" />
            {bellCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center">
                {bellCount > 99 ? '99+' : bellCount}
              </span>
            )}
          </button>
        </div>
      </header>

      {/* Body: Sidebar + Main */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Left Sidebar (desktop) */}
        <aside
          className={`hidden md:flex flex-col border-r shadow-sm transition-all duration-200 flex-shrink-0 ${darkMode ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-200'} ${collapsed ? 'w-16' : 'w-56'}`}
        >
          <nav className="flex-1 py-3 space-y-0.5">
            {NAV_ITEMS.map(item => {
              const Icon = item.icon;
              const isActive = location.pathname === item.path || (item.path !== '/' && location.pathname.startsWith(item.path));

              return (
                <NavLink
                  key={item.path}
                  to={item.path}
                  className={({ isActive: navActive }) =>
                    `flex items-center gap-3 px-3 py-2.5 mx-2 rounded-lg text-sm font-medium transition ${
                      (navActive || isActive)
                        ? 'bg-teal-50 text-teal-700 font-semibold'
                        : (darkMode ? 'text-slate-300 hover:bg-slate-700 hover:text-slate-100' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900')
                    }`
                  }
                  title={item.label}
                >
                  <Icon className="w-4 h-4 flex-shrink-0" />
                  {!collapsed && <span>{item.label}</span>}
                </NavLink>
              );
            })}
          </nav>

          {/* Collapse toggle */}
          <button
            onClick={() => setCollapsed(c => !c)}
            className={`m-2 p-2 rounded-lg flex items-center justify-center transition ${darkMode ? 'text-slate-400 hover:bg-slate-700' : 'text-slate-400 hover:bg-slate-100'}`}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronLeft className="w-3.5 h-3.5" />}
          </button>
        </aside>

        {/* Main Content */}
        <main className={`flex-1 min-h-0 p-4 md:p-6 ${location.pathname === '/map' ? 'overflow-hidden pb-16 md:pb-6' : 'overflow-y-auto'}`}>
          <Suspense fallback={<LoadingFallback />}>
            <Routes>
              <Route path="/" element={<Dashboard userRole={userRole} lang={lang} />} />
              <Route path="/map" element={<MapBoardPage locations={locations} alerts={alerts} shelters={shelters} reports={reports} />} />
              <Route path="/layers" element={<LayersGuidePage />} />
              <Route
                path="/alerts"
                element={<AlertQueuePage alerts={alerts} predictions={predictions} userRole={userRole} lang={lang} onRequestLogin={() => setLoginOpen(true)} onRefresh={() => (authenticatedUser ? api.getAlerts() : api.getPublicAlerts()).then(setAlerts)} />}
              />
              <Route path="/rescue" element={<RescuePage userRole={userRole} onRequestLogin={() => setLoginOpen(true)} />} />
              <Route path="/analytics" element={<AnalyticsPage />} />
              <Route path="/models" element={<ModelsPage userRole={userRole} onRequestLogin={() => setLoginOpen(true)} />} />
              <Route path="/reports" element={<ReportsPage userRole={userRole} onRequestLogin={() => setLoginOpen(true)} />} />
              <Route path="/subscriptions" element={<SubscriptionsPage />} />
              <Route path="/system" element={<SystemHealthPage userRole={userRole} onRequestLogin={() => setLoginOpen(true)} onRefresh={() => { void api.getPublicAlerts().then(setAlerts); }} />} />
              <Route path="/dev/components" element={<ComponentShowcase />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </main>
      </div>

      {/* Mobile Bottom Tab Bar */}
      <nav className={`md:hidden fixed bottom-0 left-0 right-0 z-50 flex overflow-x-auto border-t ${darkMode ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-200'}`} aria-label="Main navigation">
        {MOBILE_NAV.map(item => {
          const Icon = item.icon;
          const isActive = location.pathname === item.path;
          return (
            <NavLink
              key={item.path}
              to={item.path}
              className={`min-w-[4.5rem] flex flex-col items-center justify-center py-2 text-[10px] font-medium transition ${
                isActive ? 'text-teal-700' : (darkMode ? 'text-slate-400' : 'text-slate-500')
              }`}
            >
              <Icon className="w-5 h-5" />
              <span>{item.label}</span>
            </NavLink>
          );
        })}
      </nav>

      {loginOpen && <AuthDialog onClose={() => setLoginOpen(false)} onLogin={setAuthenticatedUser} />}
    </div>
  );
}

export const App: React.FC = () => (
  <BrowserRouter>
    <ToastProvider>
      <AppShell />
    </ToastProvider>
  </BrowserRouter>
);

export default App;
