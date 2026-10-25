import React, { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, NavLink, useLocation, Navigate } from 'react-router-dom';
import {
  LayoutDashboard, Map, Bell, LifeBuoy, BarChart2, FlaskConical,
  FileText, Mail, Activity, ChevronLeft, ChevronRight, Moon, Sun,
  Globe, AlignJustify, Lock, Layers
} from 'lucide-react';

import { RoleBadge } from './components/ui/RoleBadge';
import { OfflineBanner } from './components/ui/OfflineBanner';
import { ToastProvider } from './components/ui/Toast';
import { api } from './api/client';
import type { UserRole, Language, AlertItem, PredictionItem } from './types';
import { translations } from './locales/translations';

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
  roles?: UserRole[];
};

const NAV_ITEMS: NavItem[] = [
  { path: '/', label: 'Dashboard', icon: LayoutDashboard },
  { path: '/map', label: 'District Map', icon: Map },
  { path: '/layers', label: 'Layers & legend', icon: Layers },
  { path: '/alerts', label: 'Alert Queue', icon: Bell, roles: ['OPERATOR', 'ANALYST', 'ADMIN', 'RESPONDER'] },
  { path: '/rescue', label: 'Rescue', icon: LifeBuoy },
  { path: '/analytics', label: 'Analytics', icon: BarChart2, roles: ['OPERATOR', 'ANALYST', 'ADMIN'] },
  { path: '/models', label: 'Models', icon: FlaskConical, roles: ['OPERATOR', 'ANALYST', 'ADMIN'] },
  { path: '/reports', label: 'Reports', icon: FileText, roles: ['OPERATOR', 'ANALYST', 'ADMIN'] },
  { path: '/subscriptions', label: 'Subscriptions', icon: Mail },
  { path: '/system', label: 'System Health', icon: Activity, roles: ['OPERATOR', 'ADMIN'] },
];

const MOBILE_NAV: NavItem[] = [
  { path: '/', label: 'Map', icon: LayoutDashboard },
  { path: '/map', label: 'Map', icon: Map },
  { path: '/layers', label: 'Layers', icon: Layers },
  { path: '/alerts', label: 'Alerts', icon: Bell },
  { path: '/rescue', label: 'Rescue', icon: LifeBuoy },
  { path: '/subscriptions', label: 'Subscribe', icon: Mail },
];

const LANGUAGES: { code: Language; label: string }[] = [
  { code: 'en', label: 'EN' },
  { code: 'as', label: 'অস' },
  { code: 'bn', label: 'বাং' },
  { code: 'hi', label: 'हिं' },
];

const ROLES: UserRole[] = ['RESIDENT', 'RESPONDER', 'OPERATOR', 'ANALYST', 'ADMIN'];

function canAccess(role: UserRole, item: NavItem): boolean {
  if (!item.roles) return true;
  return item.roles.includes(role);
}

function navItemFor(path: string): NavItem {
  return NAV_ITEMS.find(item => item.path === path)!;
}

function LoadingFallback() {
  return (
    <div className="flex items-center justify-center h-64 text-slate-400 text-sm animate-pulse">
      Loading…
    </div>
  );
}

function LockedPage({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-64 gap-4 text-center">
      <div className="w-14 h-14 rounded-full bg-slate-100 flex items-center justify-center">
        <Lock className="w-7 h-7 text-slate-400" />
      </div>
      <div>
        <h2 className="text-base font-bold text-slate-700">{label}</h2>
        <p className="text-sm text-slate-400 mt-1">
          Access to this page requires a higher role. Contact your administrator.
        </p>
      </div>
    </div>
  );
}

function AppShell() {
  const [collapsed, setCollapsed] = useState(false);
  const [darkMode, setDarkMode] = useState(false);
  const [userRole, setUserRole] = useState<UserRole>('OPERATOR');
  const [lang, setLang] = useState<Language>('en');
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [predictions, setPredictions] = useState<PredictionItem[]>([]);
  const [locations, setLocations] = useState<any[]>([]);
  const [shelters, setShelters] = useState<any[]>([]);
  const [reports, setReports] = useState<any[]>([]);
  const location = useLocation();

  const t = translations[lang] || translations.en;

  // Load app data
  useEffect(() => {
    api.getAlerts().then(setAlerts).catch(() => {});
    api.getPredictions().then(setPredictions).catch(() => {});
    api.getLocations().then(setLocations).catch(() => {});
    api.getShelters().then(setShelters).catch(() => {});
    api.getReports().then(setReports).catch(() => {});
  }, []);


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
          {/* Role selector */}
          <select
            value={userRole}
            onChange={e => setUserRole(e.target.value as UserRole)}
            className={`text-xs font-semibold px-1 sm:px-2 py-1 rounded-lg border max-w-[5.5rem] sm:max-w-none ${darkMode ? 'bg-slate-700 border-slate-600 text-slate-100' : 'bg-slate-50 border-slate-200 text-slate-700'} focus:outline-none`}
            aria-label="Select role"
          >
            {ROLES.map(r => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>

          <span className="hidden sm:inline-flex"><RoleBadge role={userRole} /></span>

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
              const accessible = canAccess(userRole, item);
              const isActive = location.pathname === item.path || (item.path !== '/' && location.pathname.startsWith(item.path));

              return (
                <NavLink
                  key={item.path}
                  to={accessible ? item.path : '#'}
                  onClick={e => !accessible && e.preventDefault()}
                  className={({ isActive: navActive }) =>
                    `flex items-center gap-3 px-3 py-2.5 mx-2 rounded-lg text-sm font-medium transition ${
                      (navActive || isActive)
                        ? 'bg-teal-50 text-teal-700 font-semibold'
                        : accessible
                        ? (darkMode ? 'text-slate-300 hover:bg-slate-700 hover:text-slate-100' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900')
                        : 'text-slate-300 cursor-not-allowed opacity-60'
                    }`
                  }
                  title={!accessible ? 'Insufficient role' : item.label}
                >
                  <Icon className="w-4 h-4 flex-shrink-0" />
                  {!collapsed && <span>{item.label}</span>}
                  {!collapsed && !accessible && <Lock className="w-3 h-3 ml-auto text-slate-400" />}
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
                element={
                  canAccess(userRole, navItemFor('/alerts'))
                    ? <AlertQueuePage alerts={alerts} predictions={predictions} userRole={userRole} lang={lang} onRefresh={() => api.getAlerts().then(setAlerts)} />
                    : <LockedPage label="Alert Queue" />
                }
              />
              <Route path="/rescue" element={<RescuePage userRole={userRole} />} />
              <Route
                path="/analytics"
                element={
                  canAccess(userRole, navItemFor('/analytics'))
                    ? <AnalyticsPage />
                    : <LockedPage label="Analytics" />
                }
              />
              <Route
                path="/models"
                element={
                  canAccess(userRole, navItemFor('/models'))
                    ? <ModelsPage />
                    : <LockedPage label="Models & Validation" />
                }
              />
              <Route
                path="/reports"
                element={
                  canAccess(userRole, navItemFor('/reports'))
                    ? <ReportsPage />
                    : <LockedPage label="Reports" />
                }
              />
              <Route path="/subscriptions" element={<SubscriptionsPage />} />
              <Route
                path="/system"
                element={
                  canAccess(userRole, navItemFor('/system'))
                    ? <SystemHealthPage dataSources={[]} onRefresh={() => {}} />
                    : <LockedPage label="System Health" />
                }
              />
              <Route path="/dev/components" element={<ComponentShowcase />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </main>
      </div>

      {/* Mobile Bottom Tab Bar */}
      <nav className={`md:hidden fixed bottom-0 left-0 right-0 z-50 flex border-t ${darkMode ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-200'}`}>
        {MOBILE_NAV.map(item => {
          const Icon = item.icon;
          const isActive = location.pathname === item.path;
          return (
            <NavLink
              key={item.path}
              to={item.path}
              className={`flex-1 flex flex-col items-center justify-center py-2 text-[10px] font-medium transition ${
                isActive ? 'text-teal-700' : (darkMode ? 'text-slate-400' : 'text-slate-500')
              }`}
            >
              <Icon className="w-5 h-5" />
              <span>{item.label}</span>
            </NavLink>
          );
        })}
      </nav>
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
