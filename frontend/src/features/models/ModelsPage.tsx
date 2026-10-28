import React, { useEffect, useState } from 'react';
import { api } from '../../api/client';
import type { LocationItem, ModelVersionItem, ModelValidationReport, UserRole } from '../../types';
import { Skeleton } from '../../components/ui/Skeleton';
import { ErrorState } from '../../components/ui/ErrorState';
import { LiveWeatherCard } from '../../components/LiveWeatherCard';
import { FlaskConical, AlertCircle, Shield } from 'lucide-react';

export default function ModelsPage({ userRole: _userRole, onRequestLogin: _onRequestLogin }: { userRole: UserRole; onRequestLogin: () => void }) {
  const [models, setModels] = useState<ModelVersionItem[]>([]);
  const [validation, setValidation] = useState<ModelValidationReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [weatherLocation, setWeatherLocation] = useState<LocationItem | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    Promise.allSettled([api.getModels(), api.getModelValidation(), api.getLocations()])
      .then(([modelsResult, validationResult, locationsResult]) => {
        if (modelsResult.status === 'rejected') throw modelsResult.reason;
        if (validationResult.status === 'rejected') throw validationResult.reason;
        setModels(modelsResult.value);
        setValidation(validationResult.value);
        if (locationsResult.status === 'fulfilled') {
          const location = locationsResult.value.find(item => item.district === 'Kamrup Metropolitan' && item.location_type === 'URBAN_CATCHMENT')
            ?? locationsResult.value.find(item => item.district === 'Kamrup Metropolitan');
          setWeatherLocation(location ?? null);
        }
      })
      .catch(e => setError(e instanceof Error ? e.message : 'Could not load model data'))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  if (loading) return (
    <div className="space-y-4">
      {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-48" />)}
    </div>
  );
  if (error) return <ErrorState message={error} onRetry={load} />;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
        <div className="flex items-center gap-2 mb-1">
          <FlaskConical className="w-5 h-5 text-indigo-600" />
          <h2 className="text-base font-bold text-slate-900">AI Models & Validation</h2>
        </div>
        <p className="text-xs text-slate-500">
          Advisory prototypes only. Current feed data and official warnings remain separate; verified model performance is unavailable.
          <strong className="text-amber-700 ml-1">AI cannot override CWC/IMD official thresholds.</strong>
        </p>
      </div>

      {weatherLocation && <LiveWeatherCard location="Guwahati" locationId={weatherLocation.id} />}

      {/* Validation Summary */}
      {validation && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Shield className="w-4 h-4 text-teal-700" />
              <span className="text-sm font-bold text-slate-900">Overall Validation Summary</span>
            </div>
              <span className="text-xs font-bold text-amber-700">{validation.total_cases > 0 ? validation.verdict : 'NOT VALIDATED'}</span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            {[
              { label: 'Total Cases', value: validation.total_cases, unit: '', color: '#0F766E' },
              { label: 'Pass Count', value: validation.overall_pass_count, unit: '', color: '#16A34A' },
              { label: 'Historical Hit Rate', value: validation.historical_hit_rate !== null ? `${(validation.historical_hit_rate * 100).toFixed(1)}%` : 'N/A', unit: '', color: '#2563EB', raw: true },
              { label: 'Safety Rule Pass', value: validation.safety_rule_pass_rate !== null ? `${(validation.safety_rule_pass_rate * 100).toFixed(1)}%` : 'N/A', unit: '', color: '#16A34A', raw: true },
            ].map(({ label, value, color, raw }) => (
              <div key={label} className="p-3 bg-slate-50 rounded-lg border border-slate-100 text-center">
                <div className="text-xs text-slate-500 font-medium">{label}</div>
                <div className="text-lg font-black mt-1" style={{ color }}>{raw ? value : value}</div>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-slate-400 mt-2">{validation.method_note}</p>
        </div>
      )}

      {/* Model Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {models.map(m => {
          const metrics = m.evaluation_metrics ?? {};
          return (
            <div key={m.id} className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 space-y-3">
              <div className="flex items-start justify-between">
                <div>
                  <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded bg-indigo-100 text-indigo-800">
                    {m.hazard_type} Model
                  </span>
                  <h3 className="text-sm font-bold text-slate-900 mt-1">{m.id}</h3>
                  <p className="text-[11px] text-slate-500">v{m.version} · Dataset: {m.training_data_version}</p>
                </div>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${m.approval_status === 'APPROVED' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                  {m.approval_status}
                </span>
              </div>

              <div className="grid grid-cols-3 gap-2 text-center">
                {[
                  { k: 'precision', label: 'Precision', color: '#0F766E' },
                  { k: 'recall', label: 'Recall', color: '#2563EB' },
                  { k: 'lead_time_hours_mean', label: 'Lead Time', color: '#7C3AED', isHours: true },
                ].map(({ k, label, color, isHours }) => {
                  const raw = metrics[k];
                  const display = raw != null
                    ? (isHours ? `${raw}h` : `${(Number(raw) * 100).toFixed(0)}%`)
                    : 'Not verified';
                  return (
                    <div key={k} className="p-2 bg-slate-50 rounded-lg border border-slate-100">
                      <div className="text-[10px] text-slate-500 font-semibold">{label}</div>
                      <div className="text-base font-black mt-0.5" style={{ color }}>{display}</div>
                    </div>
                  );
                })}
              </div>

              <div className="space-y-1.5 text-xs">
                {metrics.false_alarm_rate != null && (
                  <div className="flex justify-between">
                    <span className="text-slate-500">False Alarm Rate:</span>
                    <span className="font-semibold text-amber-700">{(Number(metrics.false_alarm_rate) * 100).toFixed(1)}%</span>
                  </div>
                )}
                {metrics.missed_event_rate != null && (
                  <div className="flex justify-between">
                    <span className="text-slate-500">Missed Event Rate:</span>
                    <span className="font-semibold text-red-700">{(Number(metrics.missed_event_rate) * 100).toFixed(1)}%</span>
                  </div>
                )}
              </div>

              {m.known_limitations && (
                <div className="p-2.5 bg-amber-50 rounded-lg border border-amber-100 text-[11px] text-amber-900">
                  <AlertCircle className="w-3 h-3 inline mr-1 text-amber-600" />
                  {m.known_limitations}
                </div>
              )}
            </div>
          );
        })}
      </div>

    </div>
  );
}
