import React, { useState } from 'react';
import { Play, AlertTriangle, ShieldCheck, Clock, FileWarning } from 'lucide-react';
import { api } from '../api/client';
import { Language } from '../types';
import { translations } from '../locales/translations';

interface DemoControllerProps {
  lang: Language;
  onScenarioLoaded: () => void;
}

export const DemoController: React.FC<DemoControllerProps> = ({ lang, onScenarioLoaded }) => {
  const t = translations[lang] || translations.en;
  const [activeScenario, setActiveScenario] = useState<string>('normal');
  const [loading, setLoading] = useState<boolean>(false);
  const [message, setMessage] = useState<string | null>(null);

  const scenarios = [
    { id: 'normal', label: '1. Baseline Calm', icon: ShieldCheck, color: 'hover:bg-emerald-50 text-emerald-700 border-emerald-200' },
    { id: 'extreme_flood', label: '2. Extreme Flood (June 2022)', icon: AlertTriangle, color: 'hover:bg-blue-50 text-blue-700 border-blue-200' },
    { id: 'landslide_hazard', label: '3. Cloudburst Landslide', icon: AlertTriangle, color: 'hover:bg-amber-50 text-amber-700 border-amber-200' },
    { id: 'stale_feed_failure', label: '4. Stale Feed (Rule R-02)', icon: Clock, color: 'hover:bg-slate-50 text-slate-700 border-slate-300' },
    { id: 'sensor_missing_fallback', label: '5. Missing Sensor (Rule R-03)', icon: FileWarning, color: 'hover:bg-purple-50 text-purple-700 border-purple-200' }
  ];

  const handleSelectScenario = async (id: string) => {
    try {
      setLoading(true);
      setActiveScenario(id);
      const res = await api.triggerScenario(id);
      setMessage(res.message || res.status || `Scenario '${id}' activated`);
      onScenarioLoaded();
      setTimeout(() => setMessage(null), 5000);
    } catch (e: any) {
      setMessage(`Failed: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-gradient-to-r from-slate-900 to-indigo-950 text-white rounded-xl p-3.5 mb-4 shadow-md border border-slate-800">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="p-1.5 rounded-lg bg-indigo-500/20 text-indigo-300">
            <Play className="w-4 h-4 fill-indigo-300" />
          </span>
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-indigo-300">{t.replayScenario}</h3>
            <p className="text-[11px] text-slate-300">Simulate historical disasters, elevated triggers, and safety failure modes.</p>
          </div>
        </div>

        {/* Buttons */}
        <div className="flex flex-wrap items-center gap-1.5 w-full sm:w-auto">
          {scenarios.map((sc) => {
            const Icon = sc.icon;
            const isSelected = activeScenario === sc.id;
            return (
              <button
                key={sc.id}
                onClick={() => handleSelectScenario(sc.id)}
                disabled={loading}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                  isSelected
                    ? 'bg-white text-slate-950 border-white shadow'
                    : 'bg-white/10 text-white border-white/20 hover:bg-white/20'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{sc.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {message && (
        <div className="mt-2 text-xs py-1 px-2.5 rounded bg-white/10 text-indigo-200 border border-white/15 animate-fade-in">
          {message}
        </div>
      )}
    </div>
  );
};
