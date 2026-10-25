import React, { useEffect, useState } from 'react';
import { X, Waves, Mountain, Info, ArrowUpRight, Database } from 'lucide-react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, ReferenceLine, CartesianGrid, Legend } from 'recharts';
import { LocationItem, PredictionItem, ObservationItem, Language } from '../types';
import { api } from '../api/client';
import { RiverStaffGauge } from './ui/RiverStaffGauge';

interface IntegratedRiskFeature {
  properties: {
    location_id: string;
    name: string;
    primary_hazard: string;
    flood_category: string;
    landslide_category: string;
    flood_probability: number | null;
    landslide_probability: number | null;
    confidence: number | null;
    uncertainty: string;
    ari_mm: number | null;
    explanation_notes: string[];
    terrain: { slope_deg: number; elevation_m: number; susceptibility_score: number; geology: string | null };
    threshold_provenance?: Record<string, string>;
  } | null;
}

interface RiskGeoResponse {
  engine_version: string;
  generated_at: string;
  threshold_provenance?: Record<string, string>;
  features: Array<{ properties: any }>;
}

interface LocationDetailModalProps {
  location: LocationItem | null;
  onClose: () => void;
  lang: Language;
}

export const LocationDetailModal: React.FC<LocationDetailModalProps> = ({
  location,
  onClose,
  lang: _lang
}) => {
  const API_BASE = (import.meta as any).env?.VITE_API_BASE_URL || 'http://127.0.0.1:8000/api/v1';
  const [predictions, setPredictions] = useState<PredictionItem[]>([]);
  const [observations, setObservations] = useState<ObservationItem[]>([]);
  const [integratedRisk, setIntegratedRisk] = useState<IntegratedRiskFeature>({ properties: null });
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    if (!location) return;
    const fetchData = async () => {
      setLoading(true);
      try {
        const [preds, obs, geoRes] = await Promise.all([
          api.getPredictions({ location_id: location.id }),
          api.getObservations({ location_id: location.id }),
          fetch(`${API_BASE}/risk/geo?location_id=${location.id}`)
        ]);
        setPredictions(preds);
        setObservations(obs);
        if (geoRes.ok) {
          const geo = (await geoRes.json()) as RiskGeoResponse;
          const feature = geo.features?.[0]?.properties;
          setIntegratedRisk({ properties: feature ?? null });
        } else {
          setIntegratedRisk({ properties: null });
        }
      } catch (err) {
        console.error("Failed to fetch location details", err);
        setIntegratedRisk({ properties: null });
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [location, API_BASE]);

  if (!location) return null;

  const floodPred = predictions.find(p => p.hazard_type === 'FLOOD');
  const landPred = predictions.find(p => p.hazard_type === 'LANDSLIDE');

  // Real telemetry chart built from stored observations — no synthetic points.
  const levelObs = observations
    .filter(o => o.variable === 'river_level_m')
    .sort((a, b) => new Date(a.observed_at).getTime() - new Date(b.observed_at).getTime());
  const rainObs = observations
    .filter(o => o.variable === 'rainfall_24h_mm')
    .sort((a, b) => new Date(a.observed_at).getTime() - new Date(b.observed_at).getTime());

  const chartData = levelObs.length ? levelObs.map(o => ({
    time: new Date(o.observed_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    level: o.value,
    rainfall: rainObs.length > 1
      ? (rainObs.find(r => r.observed_at >= o.observed_at)?.value ?? null)
      : (rainObs[0]?.value ?? null)
  })) : [];

  const hasTelemetry = chartData.length > 0;
  const values = levelObs.map(o => o.value);
  const yMin = values.length ? Math.floor(Math.min(...values) - 1) : 0;
  const yMax = values.length ? Math.ceil(Math.max(...values) + 1) : 1;
  const dangerMark = floodPred?.explanation?.official_cwc_danger_level_m ?? null;
  const warningMark = floodPred?.explanation?.official_cwc_warning_level_m ?? null;
  const gaugeLabel = levelObs.length
    ? levelObs[levelObs.length - 1].provenance ?? 'Stored official-gauge readings'
    : 'No river gauge telemetry registered for this location';

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-3xl w-full border border-slate-200 overflow-hidden max-h-[90vh] flex flex-col animate-fade-in">
        {/* Modal Header */}
        <div className="px-6 py-4 bg-slate-900 text-white flex justify-between items-center">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold tracking-tight">{location.name}</h2>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-white/20 uppercase tracking-wider">
                {location.location_type.replace('_', ' ')}
              </span>
            </div>
            <p className="text-xs text-slate-300">
              {location.district}, {location.state} • Elev: {location.elevation_m != null ? `${location.elevation_m}m` : 'unavailable'} • ({location.latitude.toFixed(4)}°N, {location.longitude.toFixed(4)}°E)
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Content */}
        <div className="p-6 overflow-y-auto space-y-6">
          {loading && (
            <div className="flex items-center justify-center p-4 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-500 gap-2">
              <span className="w-4 h-4 border-2 border-teal-600 border-t-transparent rounded-full animate-spin"></span>
              <span>Loading latest telemetry and risk assessment...</span>
            </div>
          )}

          {/* Integrated Geo-Risk Engine Banner (rainfall + terrain + CWC marks + validated history) */}
          {integratedRisk.properties && (
            <div className="bg-slate-900 rounded-xl p-4 text-white border border-slate-800">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                    Integrated Geo-Risk Engine — Coastal to 20 km hazard history, CWC marks, Open-Meteo precipitation
                  </div>
                  <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                    <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-black ${
                      integratedRisk.properties.primary_hazard === 'FLOOD' ? 'bg-blue-600' : 'bg-amber-600'
                    }`}>
                      Primary: {integratedRisk.properties.primary_hazard}
                    </span>
                    <span className="px-2.5 py-0.5 rounded-full text-[11px] font-black bg-white/10">
                      Flood: {integratedRisk.properties.flood_category}
                      {integratedRisk.properties.flood_probability != null ? ` (${(integratedRisk.properties.flood_probability * 100).toFixed(0)}%)` : ''}
                    </span>
                    <span className="px-2.5 py-0.5 rounded-full text-[11px] font-black bg-white/10">
                      Landslide: {integratedRisk.properties.landslide_category}
                      {integratedRisk.properties.landslide_probability != null ? ` (${(integratedRisk.properties.landslide_probability * 100).toFixed(0)}%)` : ''}
                    </span>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[11px] text-slate-300 font-bold">
                    Confidence: {integratedRisk.properties.confidence != null ? `${(integratedRisk.properties.confidence * 100).toFixed(0)}%` : 'N/A'}
                  </div>
                  <div className="text-[10px] text-slate-400">
                    {integratedRisk.properties.uncertainty.replace('_', ' ').toLowerCase()}
                  </div>
                </div>
              </div>
              <ul className="mt-3 space-y-0.5 text-[10.5px] text-slate-300 list-disc list-inside">
                {(integratedRisk.properties.explanation_notes || []).slice(0, 6).map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Dual Hazard Assessments (FR-FLOOD-04 & FR-LAND-04) */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Flood Assessment Card */}
            <div className="bg-slate-50 rounded-xl p-4 border border-slate-200">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="p-1.5 rounded-lg bg-blue-100 text-blue-700">
                    <Waves className="w-4 h-4" />
                  </span>
                  <span className="text-xs font-bold text-slate-800 uppercase tracking-wide">Flood Risk Assessment</span>
                </div>
                {floodPred && (
                  <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${
                    floodPred.risk_category === 'CRITICAL' ? 'bg-red-100 text-red-800 border border-red-200' :
                    floodPred.risk_category === 'HIGH' ? 'bg-orange-100 text-orange-800 border border-orange-200' :
                    floodPred.risk_category === 'MODERATE' ? 'bg-amber-100 text-amber-800 border border-amber-200' :
                    floodPred.risk_category === 'UNAVAILABLE' ? 'bg-slate-200 text-slate-700 border border-slate-300' :
                    'bg-emerald-100 text-emerald-800 border border-emerald-200'
                  }`}>
                    {floodPred.risk_category}
                  </span>
                )}
              </div>

              {floodPred ? (
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between text-slate-600">
                    <span>Calibrated Probability:</span>
                    <span className="font-bold text-slate-900">
                      {floodPred.probability !== null && floodPred.probability !== undefined 
                        ? `${(floodPred.probability * 100).toFixed(0)}%` 
                        : 'Uncertain (Data Missing)'}
                    </span>
                  </div>
                  <div className="flex justify-between text-slate-600">
                    <span>Forecast Horizon:</span>
                    <span className="font-medium text-slate-900">6 Hours</span>
                  </div>
                  <div className="flex justify-between text-slate-600">
                    <span>Data Freshness:</span>
                    <span className="font-semibold text-blue-700">{floodPred.data_quality_status}</span>
                  </div>

                  {floodPred.explanation && (
                    <div className="mt-2 pt-2 border-t border-slate-200">
                      <div className="text-[11px] font-bold text-slate-700 mb-1">Explainability & Factors:</div>
                      <p className="text-[11px] text-slate-600 italic mb-1.5">{floodPred.explanation.primary_reason}</p>
                      <ul className="space-y-1 text-[11px] text-slate-600 list-disc list-inside">
                        {floodPred.explanation.contributing_factors?.map((f, i) => (
                          <li key={i}>{f}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-xs text-slate-500 py-3">No direct flood station in this catchment.</div>
              )}
            </div>

            {/* Landslide Assessment Card */}
            <div className="bg-slate-50 rounded-xl p-4 border border-slate-200">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="p-1.5 rounded-lg bg-amber-100 text-amber-700">
                    <Mountain className="w-4 h-4" />
                  </span>
                  <span className="text-xs font-bold text-slate-800 uppercase tracking-wide">Landslide Risk Assessment</span>
                </div>
                {landPred && (
                  <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${
                    landPred.risk_category === 'CRITICAL' ? 'bg-red-100 text-red-800 border border-red-200' :
                    landPred.risk_category === 'HIGH' ? 'bg-orange-100 text-orange-800 border border-orange-200' :
                    landPred.risk_category === 'MODERATE' ? 'bg-amber-100 text-amber-800 border border-amber-200' :
                    landPred.risk_category === 'UNAVAILABLE' ? 'bg-slate-200 text-slate-700 border border-slate-300' :
                    'bg-emerald-100 text-emerald-800 border border-emerald-200'
                  }`}>
                    {landPred.risk_category}
                  </span>
                )}
              </div>

              {landPred ? (
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between text-slate-600">
                    <span>Calibrated Probability:</span>
                    <span className="font-bold text-slate-900">
                      {landPred.probability !== null && landPred.probability !== undefined 
                        ? `${(landPred.probability * 100).toFixed(0)}%` 
                        : 'Uncertain (Data Missing)'}
                    </span>
                  </div>
                  <div className="flex justify-between text-slate-600">
                    <span>Forecast Horizon:</span>
                    <span className="font-medium text-slate-900">24 Hours</span>
                  </div>
                  <div className="flex justify-between text-slate-600">
                    <span>Data Freshness:</span>
                    <span className="font-semibold text-amber-700">{landPred.data_quality_status}</span>
                  </div>

                  {landPred.explanation && (
                    <div className="mt-2 pt-2 border-t border-slate-200">
                      <div className="text-[11px] font-bold text-slate-700 mb-1">Explainability & Factors:</div>
                      <p className="text-[11px] text-slate-600 italic mb-1.5">{landPred.explanation.primary_reason}</p>
                      <ul className="space-y-1 text-[11px] text-slate-600 list-disc list-inside">
                        {landPred.explanation.contributing_factors?.map((f, i) => (
                          <li key={i}>{f}</li>
                        ))}
                      </ul>
                      <div className="mt-2 p-1.5 bg-amber-50 rounded border border-amber-200 text-[10px] text-amber-900">
                        {landPred.explanation.disclaimer}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-xs text-slate-500 py-3">Flat terrain / Not a monitored slope zone.</div>
              )}
            </div>
          </div>

          {/* Hydrological & Rainfall Trend Telemetry Chart (Recharts) — real stored observations */}
          <div className="bg-white rounded-xl p-4 border border-slate-200">
            <div className="flex justify-between items-center mb-3">
              <div>
                <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wide">Hydrological Stage & Cumulative Rainfall (Real Observations)</h4>
                <p className="text-[11px] text-slate-500">
                  Plotted from ingested observations only — never synthetic. Danger/warning marks shown are the official CWC marks for this station.
                </p>
              </div>
              <span className="text-[11px] text-slate-500 font-medium">{gaugeLabel}</span>
            </div>

            {hasTelemetry ? (
              <div className="flex flex-col md:flex-row gap-4 items-center">
                {warningMark != null && dangerMark != null && values.length > 0 && (
                  <div className="flex-shrink-0">
                    <RiverStaffGauge
                      currentLevel={values[values.length - 1]}
                      warningLevel={warningMark}
                      dangerLevel={dangerMark}
                      stationName={location.name}
                    />
                  </div>
                )}
                <div className="h-56 w-full flex-1 min-w-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                      <XAxis dataKey="time" tick={{ fontSize: 11 }} />
                      <YAxis domain={[yMin, yMax]} tick={{ fontSize: 11 }} unit="m" />
                      <Tooltip />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      {dangerMark != null && (
                        <ReferenceLine y={dangerMark} stroke="#ef4444" strokeDasharray="4 4"
                          label={{ value: `Danger: ${dangerMark}m`, fill: '#ef4444', fontSize: 10, position: 'top' }} />
                      )}
                      {warningMark != null && (
                        <ReferenceLine y={warningMark} stroke="#f59e0b" strokeDasharray="4 4"
                          label={{ value: `Warning: ${warningMark}m`, fill: '#f59e0b', fontSize: 10, position: 'bottom' }} />
                      )}
                      <Line type="monotone" dataKey="level" stroke="#2563eb" dot={{ r: 3 }} name="River Level (m)" />
                    </LineChart>
                  </ResponsiveContainer>
                  {rainObs.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-2 text-[10px] text-emerald-800 bg-emerald-50 border border-emerald-200 rounded px-2 py-1">
                      <span className="font-bold">Latest rainfall (24h): {rainObs[rainObs.length - 1].value} mm</span>
                      <span>• {rainObs[rainObs.length - 1].provenance || rainObs[rainObs.length - 1].source_id}</span>
                      <span>• observed {new Date(rainObs[rainObs.length - 1].observed_at).toLocaleTimeString()}</span>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="h-24 flex items-center justify-center text-xs text-slate-400 border border-dashed border-slate-200 rounded-lg">
                No river gauge observations stored for this location yet — chart renders only measured data.
              </div>
            )}
          </div>

          {/* Observation provenance table */}
          <div className="bg-white rounded-xl p-4 border border-slate-200">
            <div className="flex items-center gap-2 mb-3">
              <Database className="w-4 h-4 text-slate-600" />
              <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wide">Observation Provenance (Latest Readings)</h4>
            </div>
            {observations.length ? (
              <div className="overflow-x-auto">
                <table className="min-w-full text-[11px]">
                  <thead>
                    <tr className="text-left text-slate-500 border-b border-slate-200">
                      <th className="py-1.5 pr-3 font-semibold">Variable</th>
                      <th className="py-1.5 pr-3 font-semibold">Value</th>
                      <th className="py-1.5 pr-3 font-semibold">Source</th>
                      <th className="py-1.5 pr-3 font-semibold">Reference</th>
                      <th className="py-1.5 pr-3 font-semibold">Observed At</th>
                      <th className="py-1.5 pr-3 font-semibold">Last Updated</th>
                      <th className="py-1.5 font-semibold">Quality</th>
                    </tr>
                  </thead>
                  <tbody>
                    {observations
                      .slice()
                      .sort((a, b) => new Date(b.observed_at).getTime() - new Date(a.observed_at).getTime())
                      .slice(0, 12)
                      .map(o => (
                        <tr key={o.id} className="border-b border-slate-100 text-slate-700">
                          <td className="py-1.5 pr-3 font-mono">{o.variable}</td>
                          <td className="py-1.5 pr-3 font-bold">{o.value} {o.unit}</td>
                          <td className="py-1.5 pr-3">{o.source_id}</td>
                          <td className="py-1.5 pr-3 text-slate-500">{o.provenance || '—'}</td>
                          <td className="py-1.5 pr-3">{new Date(o.observed_at).toLocaleString()}</td>
                          <td className="py-1.5 pr-3">{new Date(o.ingested_at).toLocaleString()}</td>
                          <td className="py-1.5">
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                              o.quality_status === 'VALID' || o.quality_status === 'FRESH'
                                ? 'bg-emerald-100 text-emerald-700'
                                : 'bg-amber-100 text-amber-700'
                            }`}>
                              {o.quality_status}{o.simulation_flag ? ' • SIM' : ''}
                            </span>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-xs text-slate-400 py-2">No observations ingested yet for this location.</div>
            )}
          </div>

          {/* Official Agency Bulletins vs AI Distinction (Rule R-01, R-05) */}
          <div className="bg-blue-50/70 rounded-xl p-4 border border-blue-200 flex items-start gap-3">
            <Info className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
            <div className="text-xs text-blue-900 space-y-1">
              <div className="font-bold">Official Warning Authority Distinction (PRD Section 7):</div>
              <p>
                Under NE-SAFE AI safety principles, AI probability outputs are purely advisory support tools. Official Central Water Commission (CWC) water level forecasts and India Meteorological Department (IMD) colour-coded weather warnings remain strictly authoritative.
              </p>
              <div className="pt-1 flex gap-3 text-[11px] font-semibold text-blue-700">
                <a href="https://ffs.india-water.gov.in" target="_blank" rel="noreferrer" className="hover:underline flex items-center gap-1">
                  <span>CWC Flood Forecasting System</span>
                  <ArrowUpRight className="w-3 h-3" />
                </a>
                <a href="https://api.imd.gov.in" target="_blank" rel="noreferrer" className="hover:underline flex items-center gap-1">
                  <span>IMD Weather Warnings Portal</span>
                  <ArrowUpRight className="w-3 h-3" />
                </a>
              </div>
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-3 bg-slate-50 border-t border-slate-200 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-900 text-white rounded-lg text-xs font-bold hover:bg-slate-800 transition"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
