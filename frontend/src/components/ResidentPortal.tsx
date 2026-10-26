import React, { useState, useEffect } from 'react';
import { AlertItem, ShelterItem, Language, LocationItem, RescueRequestItem, RescueTrackingItem, RescueStatus } from '../types';
import { api } from '../api/client';
import { translations } from '../locales/translations';
import { MapPin, AlertTriangle, ShieldCheck, Home, Phone, Accessibility, CheckCircle2, Building2, LifeBuoy, Search } from 'lucide-react';
import { SubscribeToAlerts } from './SubscribeToAlerts';

interface ResidentPortalProps {
  locations: LocationItem[];
  alerts: AlertItem[];
  shelters: ShelterItem[];
  lang: Language;
}

const NORTHEAST_STATES = [
  'ALL',
  'Assam',
  'Arunachal Pradesh',
  'Meghalaya',
  'Manipur',
  'Mizoram',
  'Nagaland',
  'Tripura',
  'Sikkim'
];

export const ResidentPortal: React.FC<ResidentPortalProps> = ({
  locations,
  alerts,
  shelters,
  lang
}) => {
  const t = translations[lang] || translations.en;
  const [selectedState, setSelectedState] = useState<string>('ALL');
  const [selectedLocationId, setSelectedLocationId] = useState<string>(locations[0]?.id || 'loc_pandu_ghat');

  // Filter locations based on selected state
  const filteredLocations = selectedState === 'ALL'
    ? locations
    : locations.filter(l => l.state === selectedState);

  // Sync selectedLocationId when filteredLocations changes
  useEffect(() => {
    if (filteredLocations.length > 0 && !filteredLocations.some(l => l.id === selectedLocationId)) {
      setSelectedLocationId(filteredLocations[0].id);
    }
  }, [selectedState, filteredLocations, selectedLocationId]);

  const selectedLoc = locations.find(l => l.id === selectedLocationId) || filteredLocations[0] || locations[0];
  const activeAlertsForLoc = alerts.filter(a =>
    a.location_id === selectedLoc?.id && (a.lifecycle_status === 'ISSUED' || a.lifecycle_status === 'PROPOSED')
  );

  /* ---- Rescue request state ---- */
  const [rescueContact, setRescueContact] = useState('');
  const [rescuePeople, setRescuePeople] = useState<number>(1);
  const [rescueNeeds, setRescueNeeds] = useState('');
  const [rescueConsent, setRescueConsent] = useState(true);
  const [rescueSubmitting, setRescueSubmitting] = useState(false);
  const [rescueResult, setRescueResult] = useState<RescueRequestItem | null>(null);
  const [rescueError, setRescueError] = useState<string | null>(null);
  const [trackRef, setTrackRef] = useState('');
  const [trackResults, setTrackResults] = useState<RescueTrackingItem[] | null>(null);
  const [trackError, setTrackError] = useState<string | null>(null);

  const submitRescue = async () => {
    setRescueError(null);
    if (!selectedLoc) { setRescueError('Select a location first.'); return; }
    if (!rescueContact.trim() || !rescueNeeds.trim() || rescuePeople < 1) {
      setRescueError('Contact, people count and needs summary are required.');
      return;
    }
    setRescueSubmitting(true);
    try {
      const created = await api.submitRescueRequest({
        location_name: selectedLoc.name,
        latitude: selectedLoc.latitude,
        longitude: selectedLoc.longitude,
        requester_contact: rescueContact.trim(),
        people_count: rescuePeople,
        needs_summary: rescueNeeds.trim(),
        consent_shared_location: rescueConsent
      });
      setRescueResult(created);
      setTrackRef(created.public_reference);
      setRescueNeeds('');
    } catch (e) {
      setRescueError(String(e instanceof Error ? e.message : e));
    } finally {
      setRescueSubmitting(false);
    }
  };

  const runTrack = async () => {
    setTrackError(null);
    setTrackResults(null);
    if (!trackRef.trim()) { setTrackError('Enter your reference, e.g. RR-A1B2C3.'); return; }
    try {
      const rows = await api.trackRescueRequest(trackRef.trim());
      if (!rows.length) { setTrackError('No request found for that reference yet.'); return; }
      setTrackResults(rows);
    } catch (e) {
      setTrackError(String(e instanceof Error ? e.message : e));
    }
  };

  const statusStyle = (status: RescueStatus): string => {
    switch (status) {
      case 'SUBMITTED': return 'bg-slate-100 text-slate-800';
      case 'RECEIVED': return 'bg-blue-100 text-blue-800';
      case 'ASSIGNED': return 'bg-indigo-100 text-indigo-800';
      case 'EN_ROUTE': return 'bg-amber-100 text-amber-800';
      case 'SERVED': case 'CLOSED': return 'bg-emerald-100 text-emerald-800';
      case 'UNREACHABLE': return 'bg-red-100 text-red-800';
      default: return 'bg-slate-100 text-slate-800';
    }
  };

  // Filter shelters for selected state / location
  const filteredShelters = shelters.filter(s => {
    if (selectedState === 'ALL') return true;
    const stateLower = selectedState.toLowerCase();
    const matchesState = s.location_name.toLowerCase().includes(stateLower) || 
                         s.verified_by.toLowerCase().includes(stateLower);
    const matchesDistrict = selectedLoc ? s.location_name.toLowerCase().includes(selectedLoc.district.toLowerCase()) : false;
    return matchesState || matchesDistrict;
  });

  const displayShelters = filteredShelters.length > 0 ? filteredShelters : shelters;

  return (
    <div className="space-y-5">
      <SubscribeToAlerts />

      {/* Offline / Emergency Header Badge */}
      <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs font-semibold text-emerald-900">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
          <span>
            {t.offlineReady} — {selectedLoc ? `${selectedLoc.district}, ${selectedLoc.state}` : (selectedState === 'ALL' ? 'Northeast Regional' : selectedState)} Emergency Cell
          </span>
        </div>
        <div className="flex items-center gap-2 text-xs font-bold text-slate-700">
          <Phone className="w-3.5 h-3.5 text-blue-600" />
          <span>{t.emergencyHelpline}</span>
          <span className="rescue-general-number font-black tracking-widest text-sm px-3 py-1">
            National Emergency: 112
          </span>
        </div>
      </div>

      {/* State & District / Ward Filter (FR-USER-01: Low friction, no GPS required) */}
      <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {/* State Selector */}
          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wide mb-1.5 flex items-center gap-1.5">
              <Building2 className="w-3.5 h-3.5 text-indigo-600" />
              <span>{t.selectState || 'Select Northeast State:'}</span>
            </label>
            <select
              value={selectedState}
              onChange={(e) => setSelectedState(e.target.value)}
              className="w-full text-sm font-semibold p-2.5 rounded-lg border border-slate-300 bg-slate-50 text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="ALL">All 8 Northeast States (NER)</option>
              {NORTHEAST_STATES.filter(s => s !== 'ALL').map(state => (
                <option key={state} value={state}>
                  {state}
                </option>
              ))}
            </select>
          </div>

          {/* District / Ward Selector */}
          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wide mb-1.5 flex items-center gap-1.5">
              <MapPin className="w-3.5 h-3.5 text-blue-600" />
              <span>{t.selectWard || 'Select Monitored District / Catchment:'}</span>
            </label>
            <select
              value={selectedLocationId}
              onChange={(e) => setSelectedLocationId(e.target.value)}
              className="w-full text-sm font-semibold p-2.5 rounded-lg border border-slate-300 bg-slate-50 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {filteredLocations.map((loc) => (
                <option key={loc.id} value={loc.id}>
                  {loc.name} ({loc.district}, {loc.state}) — {loc.location_type.replace('_', ' ')}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Active Warning Status for Selected Location */}
      <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm">
        <div className="flex justify-between items-center mb-3">
          <h3 className="text-sm font-bold text-slate-900">
            Emergency Warning Status: <span className="text-blue-600">{selectedLoc?.name}</span>
          </h3>
          <span className="text-xs text-slate-500 font-medium">{selectedLoc?.district}, {selectedLoc?.state}</span>
        </div>

        {activeAlertsForLoc.length === 0 ? (
          <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 flex items-start gap-3">
            <ShieldCheck className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" />
            <div className="text-xs text-emerald-900">
              <div className="font-bold">No Active Emergency Warnings for this Location.</div>
              <p className="mt-1 text-emerald-700">
                Hydrological and meteorological readings are within baseline limits. Continue monitoring official CWC and IMD bulletins.
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {activeAlertsForLoc.map((alert) => (
              <div
                key={alert.id}
                className="p-4 rounded-xl bg-red-50 border-2 border-red-500 text-red-950 shadow-sm animate-fade-in"
              >
                <div className="flex items-center gap-2 mb-1.5">
                  <AlertTriangle className="w-5 h-5 text-red-600 animate-bounce" />
                  <span className="font-black text-sm uppercase tracking-wide text-red-900">{alert.title}</span>
                </div>
                <p className="text-xs text-red-800 mb-3 font-medium">{alert.description}</p>

                <div className="p-3 bg-white/90 rounded-lg border border-red-200 text-xs">
                  <div className="font-bold text-red-900 mb-1">IMMEDIATE RECOMMENDED ACTION:</div>
                  <p className="text-slate-800 font-medium">{alert.action_instructions}</p>
                </div>

                <div className="mt-3 flex justify-between items-center text-[11px] text-red-700 font-medium">
                  <span>Source: {alert.official_source_reference || `${selectedLoc?.state} Early Warning Cell`}</span>
                  <span>Expires: {alert.expires_at ? new Date(alert.expires_at).toLocaleTimeString() : 'Active'}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Rescue request panel (never auto-dispatched — responder teams confirm via control room) */}
      <div className="rescue-panel">
        <div className="flex items-center gap-2">
          <LifeBuoy className="w-5 h-5 text-red-600" />
          <h3 className="text-sm font-bold text-slate-900">Request Rescue Assistance</h3>
        </div>
        <p className="text-xs text-slate-600">
          This portal logs your request to the district emergency control room. It does NOT dispatch a rescue team
          automatically — a control-room responder must confirm. For life-threatening emergencies call <strong>112</strong> now.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="block text-[11px] font-bold text-slate-600 uppercase mb-1">Contact (phone)</label>
            <input
              value={rescueContact}
              onChange={e => setRescueContact(e.target.value)}
              placeholder="+91-XXXXX-XXXXX"
              className="w-full text-sm p-2 rounded-lg border border-slate-300 bg-slate-50 focus:outline-none focus:ring-2 focus:ring-red-500"
              data-testid="rescue-contact"
            />
          </div>
          <div>
            <label className="block text-[11px] font-bold text-slate-600 uppercase mb-1">People needing help</label>
            <input
              type="number"
              min={1}
              value={rescuePeople}
              onChange={e => setRescuePeople(Math.max(1, Number(e.target.value) || 1))}
              className="w-full text-sm p-2 rounded-lg border border-slate-300 bg-slate-50 focus:outline-none focus:ring-2 focus:ring-red-500"
              data-testid="rescue-people"
            />
          </div>
          <div>
            <label className="block text-[11px] font-bold text-slate-600 uppercase mb-1">Location</label>
            <div className="text-sm font-semibold text-slate-800 p-2 bg-slate-100 rounded-lg truncate">
              {selectedLoc ? selectedLoc.name : '—'} (auto, with consent)
            </div>
          </div>
        </div>

        <div>
          <label className="block text-[11px] font-bold text-slate-600 uppercase mb-1">What do you need?</label>
          <textarea
            value={rescueNeeds}
            onChange={e => setRescueNeeds(e.target.value)}
            rows={2}
            placeholder="e.g. Water entering home, 4 people incl. 1 elderly need boat evacuation"
            className="w-full text-sm p-2 rounded-lg border border-slate-300 bg-slate-50 focus:outline-none focus:ring-2 focus:ring-red-500"
            data-testid="rescue-needs"
          />
        </div>

        <label className="flex items-center gap-2 text-xs text-slate-700 font-medium">
          <input
            type="checkbox"
            checked={rescueConsent}
            onChange={e => setRescueConsent(e.target.checked)}
          />
          I consent to sharing this location with the emergency control room
        </label>

        <div>
          <button
            onClick={submitRescue}
            disabled={rescueSubmitting}
            className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-xs font-bold rounded-lg"
            data-testid="rescue-submit"
          >
            {rescueSubmitting ? 'Submitting…' : 'Submit rescue request'}
          </button>
          {rescueError && <span className="ml-3 text-xs text-red-700 font-semibold">{rescueError}</span>}
        </div>

        {rescueResult && (
          <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-300 text-xs text-emerald-900" data-testid="rescue-result">
            <div className="font-bold">Request logged — share this reference for tracking:</div>
            <div className="font-black text-base mt-1">{rescueResult.public_reference}</div>
            <div className="mt-1">Status: <span className="font-bold">{rescueResult.status}</span></div>
            <div className="mt-1 text-[11px] text-emerald-700">
              A control-room responder must RECEIVE and ASSIGN your request before a team moves — no automatic dispatch happens.
            </div>
          </div>
        )}

        <div className="border-t border-slate-200 pt-3">
          <div className="flex items-center gap-2 mb-2">
            <Search className="w-4 h-4 text-slate-500" />
            <span className="text-xs font-bold text-slate-700 uppercase">Track an existing request</span>
          </div>
          <div className="flex gap-2">
            <input
              value={trackRef}
              onChange={e => setTrackRef(e.target.value)}
              placeholder="RR-XXXXXX"
              className="flex-1 text-sm p-2 rounded-lg border border-slate-300 bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
              data-testid="rescue-track-ref"
            />
            <button
              onClick={runTrack}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-lg"
              data-testid="rescue-track-btn"
            >
              Track status
            </button>
          </div>
          {trackError && <div className="text-xs text-red-700 font-semibold mt-2">{trackError}</div>}
          {trackResults && trackResults.length > 0 && (
            <div className="rescue-track-result mt-2 space-y-1.5" data-testid="rescue-track-result">
              {trackResults.map(r => (
                <div key={r.public_reference} className="p-2.5 rounded-lg border border-slate-200 bg-slate-50">
                  <div className="flex items-center justify-between">
                    <span className="font-bold">{r.public_reference}</span>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${statusStyle(r.status)}`}>{r.status}</span>
                  </div>
                  <div className="text-[11px] text-slate-600 mt-1">
                    Submitted {new Date(r.submitted_at).toLocaleString()} · Updated {new Date(r.last_updated_at).toLocaleString()}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Verified Emergency Shelters (FR-USER-07) */}
      <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Home className="w-5 h-5 text-blue-600" />
            <h3 className="text-sm font-bold text-slate-900">{t.shelters}</h3>
          </div>
          <span className="text-xs text-slate-500 font-medium">
            Verified by State & District Disaster Authorities (SDMA / DDMA)
          </span>
        </div>

        <p className="text-xs text-slate-600 mb-4">{t.evacuationNotice}</p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {displayShelters.map((shelter) => {
            const isFull = shelter.operational_status === 'FULL';
            const availableCapacity = shelter.capacity - shelter.current_occupancy;

            return (
              <div key={shelter.id} className="p-3.5 rounded-xl border border-slate-200 bg-slate-50 hover:bg-white transition shadow-sm">
                <div className="flex justify-between items-start gap-2 mb-1.5">
                  <h4 className="text-xs font-bold text-slate-900">{shelter.name}</h4>
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                    isFull ? 'bg-red-100 text-red-800' : 'bg-emerald-100 text-emerald-800'
                  }`}>
                    {shelter.operational_status}
                  </span>
                </div>

                <p className="text-xs text-slate-600 mb-2">{shelter.location_name}</p>

                <div className="space-y-1.5 text-xs text-slate-600">
                  <div className="flex justify-between text-[11px]">
                    <span>Available Capacity:</span>
                    <span className="font-bold text-slate-800">{availableCapacity} / {shelter.capacity} persons</span>
                  </div>

                  <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
                    <Accessibility className="w-3.5 h-3.5 text-blue-600 flex-shrink-0" />
                    <span className="truncate">{shelter.accessibility_info}</span>
                  </div>

                  <div className="flex items-center justify-between text-[11px] text-slate-700 font-medium pt-1 border-t border-slate-200">
                    <span>Verified by: <strong className="text-slate-800">{shelter.verified_by}</strong></span>
                    <span>Contact: {shelter.contact_phone}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
