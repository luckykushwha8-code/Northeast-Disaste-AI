import React from 'react';
import { AlertTriangle, Waves, Mountain, Clock } from 'lucide-react';
import { AlertItem, PredictionItem, DataSourceItem, Language } from '../types';
import { translations } from '../locales/translations';

interface KPISummaryProps {
  alerts: AlertItem[];
  predictions: PredictionItem[];
  dataSources: DataSourceItem[];
  lang: Language;
  onFilterHazard?: (hazard: string) => void;
}

export const KPISummary: React.FC<KPISummaryProps> = ({
  alerts,
  predictions,
  dataSources,
  lang,
  onFilterHazard
}) => {
  const t = translations[lang] || translations.en;

  // Compute counts
  const officialWarnings = alerts.filter(a => !a.simulation_flag && a.source_type.includes('OFFICIAL') && a.lifecycle_status === 'ISSUED');
  const elevatedFlood = predictions.filter(p => !p.simulation_flag && p.hazard_type === 'FLOOD' && (p.risk_category === 'HIGH' || p.risk_category === 'CRITICAL'));
  const elevatedLandslide = predictions.filter(p => !p.simulation_flag && p.hazard_type === 'LANDSLIDE' && (p.risk_category === 'HIGH' || p.risk_category === 'CRITICAL'));
  const staleSources = dataSources.filter(d => d.status !== 'OPERATIONAL');

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
      {/* 1. Official Warnings */}
      <div 
        onClick={() => onFilterHazard && onFilterHazard('OFFICIAL')}
        className="bg-white border-l-4 border-red-500 rounded-lg p-3.5 shadow-sm border border-slate-200 cursor-pointer hover:shadow-md transition-shadow"
      >
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{t.officialWarnings}</span>
          <span className="p-1.5 rounded-md bg-red-50 text-red-600">
            <AlertTriangle className="w-4 h-4" />
          </span>
        </div>
        <div className="mt-2 flex items-baseline gap-2">
          <span className="text-2xl font-bold text-slate-900">{officialWarnings.length}</span>
          <span className="text-[11px] text-slate-500 font-medium">Active Bulletins</span>
        </div>
        <p className="mt-1 text-[11px] text-red-600 font-medium truncate">CWC & IMD Preserved</p>
      </div>

      {/* 2. Elevated Flood Risk */}
      <div 
        onClick={() => onFilterHazard && onFilterHazard('FLOOD')}
        className="bg-white border-l-4 border-blue-500 rounded-lg p-3.5 shadow-sm border border-slate-200 cursor-pointer hover:shadow-md transition-shadow"
      >
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{t.floodHazard}</span>
          <span className="p-1.5 rounded-md bg-blue-50 text-blue-600">
            <Waves className="w-4 h-4" />
          </span>
        </div>
        <div className="mt-2 flex items-baseline gap-2">
          <span className="text-2xl font-bold text-slate-900">{elevatedFlood.length}</span>
          <span className="text-[11px] text-slate-500 font-medium">Elevated Zones</span>
        </div>
        <p className="mt-1 text-[11px] text-blue-600 font-medium truncate">Brahmaputra / Urban Inundation</p>
      </div>

      {/* 3. Elevated Landslide Risk */}
      <div 
        onClick={() => onFilterHazard && onFilterHazard('LANDSLIDE')}
        className="bg-white border-l-4 border-amber-500 rounded-lg p-3.5 shadow-sm border border-slate-200 cursor-pointer hover:shadow-md transition-shadow"
      >
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{t.landslideHazard}</span>
          <span className="p-1.5 rounded-md bg-amber-50 text-amber-600">
            <Mountain className="w-4 h-4" />
          </span>
        </div>
        <div className="mt-2 flex items-baseline gap-2">
          <span className="text-2xl font-bold text-slate-900">{elevatedLandslide.length}</span>
          <span className="text-[11px] text-slate-500 font-medium">Vulnerable Slopes</span>
        </div>
        <p className="mt-1 text-[11px] text-amber-600 font-medium truncate">Kharghuli, Nilachal, Narakasur</p>
      </div>

      {/* 4. Data Freshness / Stale Status */}
      <div className="bg-white border-l-4 border-slate-400 rounded-lg p-3.5 shadow-sm border border-slate-200">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{t.staleFeeds}</span>
          <span className="p-1.5 rounded-md bg-slate-100 text-slate-600">
            <Clock className="w-4 h-4" />
          </span>
        </div>
        <div className="mt-2 flex items-baseline gap-2">
          <span className="text-2xl font-bold text-slate-900">{staleSources.length}</span>
          <span className="text-[11px] text-slate-500 font-medium">of {dataSources.length} Feeds</span>
        </div>
        <p className={`mt-1 text-[11px] font-medium truncate ${staleSources.length > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>
          {staleSources.length > 0 ? 'Feed data unavailable or unverified' : 'Feeds responding'}
        </p>
      </div>
    </div>
  );
};
