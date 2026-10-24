import React, { useEffect, useState, lazy, Suspense } from 'react';
import { Navbar } from './components/Navbar';
import { KPISummary } from './components/KPISummary';
import { DemoController } from './components/DemoController';
import { AlertQueue } from './components/AlertQueue';
import { ResidentPortal } from './components/ResidentPortal';
import { IncidentReporting } from './components/IncidentReporting';
import { SystemHealth } from './components/SystemHealth';
import { ModelEvaluation } from './components/ModelEvaluation';
import { LiveNewsFeed } from './components/LiveNewsFeed';

// Heavy components (MapLibre GL + Recharts) are code-split out of the main bundle
const MapView = lazy(() => import('./components/MapView').then(m => ({ default: m.MapView })));
const MapBoard = lazy(() => import('./components/MapBoard').then(m => ({ default: m.MapBoard })));
const LocationDetailModal = lazy(() => import('./components/LocationDetailModal').then(m => ({ default: m.LocationDetailModal })));
const AnalyticsCharts = lazy(() => import('./components/AnalyticsCharts'));

import {
  LocationItem, PredictionItem, AlertItem, ShelterItem,
  IncidentReportItem, DataSourceItem, UserRole, Language
} from './types';
import { api } from './api/client';
import { translations } from './locales/translations';

export const App: React.FC = () => {
  const initialTab = new URLSearchParams(window.location.search).get('tab') || 'dashboard';
  const [currentTab, setCurrentTab] = useState<string>(initialTab);
  const [userRole, setUserRole] = useState<UserRole>('OPERATOR');
  const [lang, setLang] = useState<Language>('en');

  // Application Data States
  const [locations, setLocations] = useState<LocationItem[]>([]);
  const [predictions, setPredictions] = useState<PredictionItem[]>([]);
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [shelters, setShelters] = useState<ShelterItem[]>([]);
  const [reports, setReports] = useState<IncidentReportItem[]>([]);
  const [dataSources, setDataSources] = useState<DataSourceItem[]>([]);

  const [selectedLocation, setSelectedLocation] = useState<LocationItem | null>(null);
  const [shelterStateFilter, setShelterStateFilter] = useState<string>('ALL');

  const t = translations[lang] || translations.en;

  const loadAllData = async () => {
    try {
      const [locs, preds, alts, shels, reps, sources] = await Promise.all([
        api.getLocations(),
        api.getPredictions(),
        api.getAlerts(),
        api.getShelters(),
        api.getReports(),
        api.getDataStatus()
      ]);
      setLocations(locs);
      setPredictions(preds);
      setAlerts(alts);
      setShelters(shels);
      setReports(reps);
      setDataSources(sources);
    } catch (e) {
      console.error("Failed to load initial data", e);
    }
  };

  useEffect(() => {
    loadAllData();
  }, []);

  const isSimulationActive = alerts.some(a => a.simulation_flag) || predictions.some(p => p.simulation_flag);

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans text-slate-900">
      {/* Navigation Header */}
      <Navbar
        currentTab={currentTab}
        setCurrentTab={setCurrentTab}
        userRole={userRole}
        setUserRole={setUserRole}
        lang={lang}
        setLang={setLang}
        isSimulationActive={isSimulationActive}
        alertCount={alerts.filter(a => a.lifecycle_status === 'PROPOSED' || a.lifecycle_status === 'ISSUED').length}
        onRefresh={loadAllData}
      />

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-5">
        {/* SIH 5-Minute Demonstration Controller (Accessible across tabs) */}
        <DemoController lang={lang} onScenarioLoaded={loadAllData} />

        {/* Tab 0: Interactive Disaster Map Board (map-first interface) */}
        {currentTab === 'mapboard' && (
          <MapBoard
            locations={locations}
            alerts={alerts}
            shelters={shelters}
            reports={reports}
          />
        )}

        {/* Tab 1: Situational Map & Dashboard */}
        {currentTab === 'dashboard' && (
          <div className="space-y-4">
            <KPISummary
              alerts={alerts}
              predictions={predictions}
              dataSources={dataSources}
              lang={lang}
              onFilterHazard={(hazard) => {
                if (hazard === 'OFFICIAL') setCurrentTab('alerts');
              }}
            />

            <Suspense fallback={null}><MapView
              locations={locations}
              predictions={predictions}
              alerts={alerts}
              shelters={shelters}
              reports={reports}
              lang={lang}
              onSelectLocation={(loc) => setSelectedLocation(loc)}
              />
              </Suspense>

             <LiveNewsFeed />
          </div>
        )}

        {/* Tab 2: Resident Portal */}
        {currentTab === 'resident' && (
          <ResidentPortal
            locations={locations}
            alerts={alerts}
            shelters={shelters}
           lang={lang}
         />
         )}


        {/* Tab 3: Alert & Early Warning Queue */}
        {currentTab === 'alerts' && (
          <AlertQueue
            alerts={alerts}
            predictions={predictions}
            userRole={userRole}
            lang={lang}
            onRefresh={loadAllData}
          />
        )}

        {/* Tab 4: Community Incident Reports */}
        {currentTab === 'incidents' && (
          <IncidentReporting
            reports={reports}
            userRole={userRole}
            lang={lang}
            onRefresh={loadAllData}
          />
        )}

        {/* Tab 5: Verified Shelters */}
        {currentTab === 'shelters' && (
          <div className="space-y-4">
            <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <h2 className="text-base font-bold text-slate-900">Verified Emergency Relief Shelters Directory</h2>
                <p className="text-xs text-slate-500 mt-1">
                  PRD FR-USER-07: All shelter coordinates, capacities, operational statuses, and accessibility accommodations are verified by State & District Disaster Authorities (SDMA / DDMA) across Northeast India.
                </p>
              </div>

              {/* State Filter for Shelters */}
              <div className="flex items-center gap-2 flex-shrink-0">
                <span className="text-xs font-semibold text-slate-600">Filter State:</span>
                <select
                  value={shelterStateFilter}
                  onChange={(e) => setShelterStateFilter(e.target.value)}
                  className="text-xs font-bold px-3 py-2 rounded-lg border border-slate-300 bg-slate-50 text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="ALL">All Northeast States (NER)</option>
                  <option value="Assam">Assam</option>
                  <option value="Arunachal Pradesh">Arunachal Pradesh</option>
                  <option value="Meghalaya">Meghalaya</option>
                  <option value="Manipur">Manipur</option>
                  <option value="Mizoram">Mizoram</option>
                  <option value="Nagaland">Nagaland</option>
                  <option value="Tripura">Tripura</option>
                  <option value="Sikkim">Sikkim</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {shelters
                .filter(shelter => {
                  if (shelterStateFilter === 'ALL') return true;
                  const st = shelterStateFilter.toLowerCase();
                  return shelter.location_name.toLowerCase().includes(st) || shelter.verified_by.toLowerCase().includes(st);
                })
                .map((shelter) => (
                  <div key={shelter.id} className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm space-y-2">
                    <div className="flex justify-between items-start">
                      <h3 className="text-xs font-bold text-slate-900">{shelter.name}</h3>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800">
                        {shelter.operational_status}
                      </span>
                    </div>
                    <p className="text-xs text-slate-600">{shelter.location_name}</p>
                    <div className="text-xs text-slate-600 space-y-1 pt-1 border-t border-slate-100">
                      <div className="flex justify-between">
                        <span>Verified Capacity:</span>
                        <span className="font-bold text-slate-800">{shelter.capacity} persons</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Accessibility:</span>
                        <span className="text-blue-700 font-medium">{shelter.accessibility_info}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Verified by:</span>
                        <span className="text-slate-700 font-medium">{shelter.verified_by}</span>
                      </div>
                      <div className="flex justify-between text-[11px] text-slate-500 pt-1">
                        <span>Contact:</span>
                        <span>{shelter.contact_phone}</span>
                      </div>
                    </div>
                  </div>
                ))}
            </div>
          </div>
        )}

        {/* Tab 6: Analytics & Situation Dashboards */}
        {currentTab === 'analytics' && (
          <Suspense fallback={<div className="analytics-empty">Loading analytics…</div>}>
            <AnalyticsCharts />
          </Suspense>
        )}

        {/* Tab 7: System Health & Audit Trail */}
        {currentTab === 'health' && (
          <SystemHealth dataSources={dataSources} onRefresh={loadAllData} />
        )}

        {/* Tab 8: AI Model Evaluation */}
        {currentTab === 'models' && (
          <ModelEvaluation />
        )}
      </main>

      {/* Location Details Modal */}
      {selectedLocation && (
        <Suspense fallback={null}><LocationDetailModal
          location={selectedLocation}
          onClose={() => setSelectedLocation(null)}
          lang={lang}
        />
        </Suspense>
      )}

      {/* Footer */}
      <footer className="bg-white border-t border-slate-200 py-4 mt-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center text-xs text-slate-500 space-y-1">
            <p className="font-semibold text-slate-700">
              NE-SAFE AI — AI-Powered Disaster Risk Monitoring & Early Warning Platform (SIH Prototype v1.0)
            </p>
          <p>
            Study Area: Northeast India (NER — All 8 States). Compliant with CWC, IMD, GSI & ISRO Bhuvan Guidelines.
          </p>
          <p className="text-[11px] text-slate-400">
            {t.disclaimerSafety}
          </p>
        </div>
      </footer>
    </div>
  );
};

export default App;

