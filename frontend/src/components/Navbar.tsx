import React from 'react';
import { ShieldAlert, Globe, UserCheck, AlertTriangle, RefreshCw } from 'lucide-react';
import { UserRole, Language } from '../types';
import { translations } from '../locales/translations';

interface NavbarProps {
  currentTab: string;
  setCurrentTab: (tab: string) => void;
  userRole: UserRole;
  setUserRole: (role: UserRole) => void;
  lang: Language;
  setLang: (lang: Language) => void;
  isSimulationActive: boolean;
  alertCount: number;
  onRefresh: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  currentTab,
  setCurrentTab,
  userRole,
  setUserRole,
  lang,
  setLang,
  isSimulationActive,
  alertCount,
  onRefresh
}) => {
  const t = translations[lang] || translations.en;

const tabs = [
{ id: 'mapboard', label: 'Map Board' },
{ id: 'dashboard', label: t.dashboard },
    { id: 'resident', label: t.residentPortal },
    { id: 'alerts', label: `${t.alertQueue} ${alertCount > 0 ? `(${alertCount})` : ''}` },
    { id: 'incidents', label: t.incidents },
    { id: 'shelters', label: t.shelters },
    { id: 'analytics', label: 'Analytics' },
    { id: 'health', label: t.systemHealth },
    { id: 'models', label: t.modelEvaluation }
  ];

  return (
    <header className="sticky top-0 z-50 bg-white border-b border-slate-200 shadow-sm">
      {/* Simulation Watermark Notice Banner (Rule R-13, FR-DATA-09) */}
      {isSimulationActive && (
        <div className="simulation-watermark border-b border-purple-300 py-1.5 px-4 text-center text-xs font-semibold text-purple-950 flex items-center justify-center gap-2">
          <AlertTriangle className="w-4 h-4 text-purple-700 animate-pulse" />
          <span>{t.simulationWarning}</span>
        </div>
      )}

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          {/* Logo & Region Info */}
          <div className="flex items-center gap-3 cursor-pointer" onClick={() => setCurrentTab('dashboard')}>
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-600 to-indigo-700 flex items-center justify-center text-white shadow-md">
              <ShieldAlert className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-lg text-slate-900 tracking-tight">{t.appTitle}</span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-800 uppercase tracking-wide">SIH Pilot</span>
              </div>
              <p className="text-xs text-slate-500 font-medium">{t.studyArea}</p>
            </div>
          </div>

          {/* Controls: Language, Role Switcher, Refresh */}
          <div className="flex items-center gap-3">
            {/* Language Selector */}
            <div className="flex items-center gap-1.5 bg-slate-100 px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs font-medium text-slate-700">
              <Globe className="w-3.5 h-3.5 text-slate-500" />
              <select
                value={lang}
                onChange={(e) => setLang(e.target.value as Language)}
                className="bg-transparent border-none text-xs font-semibold text-slate-800 focus:outline-none cursor-pointer"
              >
                <option value="en">English (EN)</option>
                <option value="as">অসমীয়া (AS)</option>
                <option value="bn">বাংলা (BN)</option>
                <option value="hi">हिन्दी (HI)</option>
              </select>
            </div>

            {/* Role Switcher (SIH Interactive Testing) */}
            <div className="flex items-center gap-1.5 bg-indigo-50 px-2.5 py-1.5 rounded-lg border border-indigo-200 text-xs font-medium text-indigo-900">
              <UserCheck className="w-3.5 h-3.5 text-indigo-600" />
              <span className="text-[11px] text-indigo-500 hidden sm:inline">Role:</span>
              <select
                value={userRole}
                onChange={(e) => setUserRole(e.target.value as UserRole)}
                className="bg-transparent border-none text-xs font-bold text-indigo-900 focus:outline-none cursor-pointer"
              >
                <option value="RESIDENT">{t.rolePublic}</option>
                <option value="RESPONDER">{t.roleResponder}</option>
                <option value="OPERATOR">{t.roleOperator}</option>
                <option value="ANALYST">{t.roleAnalyst}</option>
                <option value="ADMIN">{t.roleAdmin}</option>
              </select>
            </div>

            {/* Refresh Button */}
            <button
              onClick={onRefresh}
              className="p-2 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition-colors"
              title="Refresh Telemetry & Predictions"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Tab Navigation */}
        <nav className="flex space-x-1 sm:space-x-3 overflow-x-auto py-2 border-t border-slate-100 scrollbar-none text-xs font-semibold">
          {tabs.map((tab) => {
            const isActive = currentTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setCurrentTab(tab.id)}
                className={`px-3 py-1.5 rounded-md transition-colors whitespace-nowrap ${
                  isActive
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </nav>
      </div>
    </header>
  );
};
