import React, { useState, useEffect, useCallback } from 'react';
import { Phone, ChevronRight, ChevronLeft, Share2, Printer, Copy, CheckCircle2, AlertTriangle } from 'lucide-react';
import { api } from '../../api/client';
import { StatusStepper } from '../../components/ui/StatusStepper';
import { EmergencyContactsCard } from '../../components/ui/EmergencyContactsCard';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { Drawer } from '../../components/ui/Drawer';
import { DataTable } from '../../components/ui/DataTable';
import { Skeleton } from '../../components/ui/Skeleton';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState } from '../../components/ui/ErrorState';
import type { RescueRequestItem, RescueStatus, UserRole } from '../../types';

// ─── Constants ────────────────────────────────────────────────────────────────

const LOCATION_OPTIONS = [
  'Guwahati (Kamrup Metropolitan)',
  'Jorhat (Assam)',
  'Silchar (Cachar)',
  'Dibrugarh (Assam)',
  'Shillong (Meghalaya)',
  'Imphal (Manipur)',
  'Agartala (Tripura)',
  'Aizawl (Mizoram)',
  'Itanagar (Arunachal Pradesh)',
  'Kohima (Nagaland)',
  'Gangtok (Sikkim)',
];

const NEEDS_OPTIONS = [
  { id: 'medical', label: 'Medical assistance' },
  { id: 'food', label: 'Food & water' },
  { id: 'boat', label: 'Boat evacuation' },
  { id: 'shelter', label: 'Emergency shelter' },
  { id: 'trapped', label: 'Person trapped' },
];

const VALID_TRANSITIONS: Record<RescueStatus, RescueStatus[]> = {
  SUBMITTED: ['RECEIVED'],
  RECEIVED: ['ASSIGNED', 'CLOSED'],
  ASSIGNED: ['EN_ROUTE', 'CLOSED'],
  EN_ROUTE: ['SERVED'],
  SERVED: ['CLOSED'],
  CLOSED: [],
  UNREACHABLE: ['CLOSED'],
};

const RESPONDER_ROLES: UserRole[] = ['RESPONDER', 'OPERATOR', 'ADMIN'];

// ─── Main Page ───────────────────────────────────────────────────────────────

interface RescuePageProps {
  userRole: UserRole;
}

export default function RescuePage({ userRole }: RescuePageProps) {
  const isResponder = RESPONDER_ROLES.includes(userRole);
  const [trackRef, setTrackRef] = useState('');
  const [trackResult, setTrackResult] = useState<RescueRequestItem | null>(null);
  const [trackError, setTrackError] = useState<string | null>(null);
  const [trackLoading, setTrackLoading] = useState(false);

  async function handleTrack(e: React.FormEvent) {
    e.preventDefault();
    if (!trackRef.trim()) return;
    setTrackLoading(true);
    setTrackError(null);
    setTrackResult(null);
    try {
      const results = await api.trackRescueRequest(trackRef.trim().toUpperCase());
      const found = results[0] ?? null;
      if (!found) setTrackError('No request found with that reference number.');
      else setTrackResult(found);
    } catch (err: unknown) {
      setTrackError(err instanceof Error ? err.message : 'Failed to track request');
    } finally {
      setTrackLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="grid md:grid-cols-2 gap-6">
        {/* Submit New Request */}
        <div>
          <h1 className="text-base font-bold text-slate-900 mb-1">Submit Rescue / Assistance Request</h1>
          <p className="text-xs text-slate-500 mb-3">
            Fill the form below to log a request. <strong>This does NOT dispatch help automatically.</strong>
          </p>
          <RescueWizard />
        </div>

        {/* Track Request */}
        <div className="space-y-4">
          <div>
            <h2 className="text-base font-bold text-slate-900 mb-1">Track Your Request</h2>
            <form onSubmit={handleTrack} className="flex gap-2">
              <input
                value={trackRef}
                onChange={e => setTrackRef(e.target.value)}
                placeholder="RR-XXXXXX"
                className="flex-1 text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-500 font-mono"
                maxLength={12}
              />
              <button
                type="submit"
                disabled={trackLoading}
                className="px-4 py-2 text-sm font-semibold bg-teal-600 text-white rounded-lg hover:bg-teal-700 disabled:opacity-50 transition"
              >
                {trackLoading ? 'Tracking…' : 'Track'}
              </button>
            </form>
            {trackError && (
              <p className="text-xs text-red-600 mt-2">{trackError}</p>
            )}
          </div>

          {trackResult && (
            <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3 shadow-sm">
              <div className="flex items-center justify-between">
                <span className="font-mono font-bold text-slate-900">{trackResult.public_reference}</span>
                <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                  trackResult.status === 'EN_ROUTE' ? 'bg-teal-100 text-teal-700' :
                  trackResult.status === 'SERVED' ? 'bg-green-100 text-green-700' :
                  trackResult.status === 'CLOSED' ? 'bg-slate-100 text-slate-600' :
                  'bg-amber-100 text-amber-700'
                }`}>
                  {trackResult.status}
                </span>
              </div>
              <StatusStepper currentStatus={trackResult.status} />
              {/* Honest labels */}
              <div className="text-xs text-slate-600 bg-slate-50 rounded-lg p-2.5">
                {trackResult.status === 'SUBMITTED' && '📋 Your request has been logged. A coordinator will review it.'}
                {trackResult.status === 'RECEIVED' && '✅ Your request has been acknowledged by our team.'}
                {trackResult.status === 'ASSIGNED' && '👤 A responder has been assigned to your request.'}
                {trackResult.status === 'EN_ROUTE' && '🚗 Help is on the way to your location.'}
                {trackResult.status === 'SERVED' && '✅ Assistance has been provided.'}
                {trackResult.status === 'CLOSED' && 'This request has been closed.'}
                {trackResult.status === 'UNREACHABLE' && '⚠ We were unable to reach this location. Please call 112.'}
              </div>
              {trackResult.status_notes && (
                <p className="text-xs text-slate-500">Note: {trackResult.status_notes}</p>
              )}
            </div>
          )}

          <EmergencyContactsCard />
        </div>
      </div>

      {/* Responder View */}
      {isResponder && (
        <div>
          <h2 className="text-base font-bold text-slate-900 mb-3">Rescue Request Worklist</h2>
          <ResponderView userRole={userRole} />
        </div>
      )}
    </div>
  );
}

// ─── Rescue Wizard (Citizen) ──────────────────────────────────────────────────

function RescueWizard() {
  const [step, setStep] = useState(1);
  const [location, setLocation] = useState('');
  const [lat, setLat] = useState<number>(0);
  const [lng, setLng] = useState<number>(0);
  const [needsSummary, setNeedsSummary] = useState('');
  const [peopleCount, setPeopleCount] = useState(1);
  const [needs, setNeeds] = useState<string[]>([]);
  const [phone, setPhone] = useState('');
  const [consent, setConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<RescueRequestItem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const isOnline = navigator.onLine;

  // Save draft to localStorage
  useEffect(() => {
    const draft = { location, lat, lng, needsSummary, peopleCount, needs };
    localStorage.setItem('rescue-draft', JSON.stringify(draft));
  }, [location, lat, lng, needsSummary, peopleCount, needs]);

  // Restore draft
  useEffect(() => {
    try {
      const raw = localStorage.getItem('rescue-draft');
      if (raw) {
        const d = JSON.parse(raw);
        if (d.location) setLocation(d.location);
        if (d.lat) setLat(d.lat);
        if (d.lng) setLng(d.lng);
        if (d.needsSummary) setNeedsSummary(d.needsSummary);
        if (d.peopleCount) setPeopleCount(d.peopleCount);
        if (d.needs) setNeeds(d.needs);
      }
    } catch { /* ignore */ }
  }, []);

  async function handleSubmit() {
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) {
      setError('Add your current GPS location before submitting. For urgent help, call 112.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const allNeeds = [
        needsSummary,
        ...needs.map(n => NEEDS_OPTIONS.find(o => o.id === n)?.label ?? n),
      ].filter(Boolean).join('; ');

      const result = await api.submitRescueRequest({
        location_name: location,
        latitude: lat,
        longitude: lng,
        requester_contact: phone,
        people_count: peopleCount,
        needs_summary: allNeeds,
        consent_shared_location: consent,
      });
      setSuccess(result);
      localStorage.removeItem('rescue-draft');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Submission failed');
    } finally {
      setSubmitting(false);
    }
  }

  function copyRef() {
    if (success?.public_reference) {
      navigator.clipboard.writeText(success.public_reference);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  if (success) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center">
            <CheckCircle2 className="w-5 h-5 text-green-600" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-900">Request Logged</h3>
            <p className="text-xs text-slate-500">Your reference number:</p>
          </div>
        </div>

        <div className="bg-slate-900 rounded-xl p-4 flex items-center justify-between">
          <span className="font-mono text-xl font-black text-white">{success.public_reference}</span>
          <div className="flex gap-2">
            <button onClick={copyRef} className="p-2 bg-slate-700 rounded-lg text-slate-300 hover:text-white transition" title="Copy">
              {copied ? <CheckCircle2 className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
            </button>
            <button onClick={() => window.print()} className="p-2 bg-slate-700 rounded-lg text-slate-300 hover:text-white transition" title="Print">
              <Printer className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="bg-red-50 border border-red-200 rounded-lg p-3">
          <p className="text-xs text-red-800 font-semibold flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5 text-red-600" />
            This form does NOT dispatch help automatically. In a life-threatening emergency, call 112 immediately.
          </p>
        </div>

        <StatusStepper currentStatus={success.status} />
        <EmergencyContactsCard />

        <button
          onClick={() => { setSuccess(null); setStep(1); setPhone(''); setConsent(false); setNeedsSummary(''); setNeeds([]); }}
          className="text-xs text-teal-700 hover:underline"
        >
          Submit another request
        </button>
      </div>
    );
  }

  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
      {/* Emergency warning — always visible */}
      <div className="bg-red-50 border-b border-red-200 px-4 py-2">
        <p className="text-xs text-red-800 font-semibold flex items-center gap-1.5">
          <Phone className="w-3.5 h-3.5 text-red-600 flex-shrink-0" />
          This form does NOT dispatch help automatically. In an emergency, call 112.
        </p>
      </div>

      {/* Step indicator */}
      <div className="flex border-b border-slate-100">
        {[1, 2, 3, 4].map(s => (
          <div
            key={s}
            className={`flex-1 py-2.5 text-center text-xs font-semibold transition ${s === step ? 'text-teal-700 border-b-2 border-teal-600 bg-teal-50/30' : s < step ? 'text-teal-600' : 'text-slate-400'}`}
          >
            {s < step ? '✓' : s} {s === 1 ? 'Where' : s === 2 ? 'What' : s === 3 ? 'Contact' : 'Review'}
          </div>
        ))}
      </div>

      <div className="p-5 space-y-4">
        {/* Step 1: Where */}
        {step === 1 && (
          <>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Location *</label>
              <select
                value={location}
                onChange={e => setLocation(e.target.value)}
                className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-500"
              >
                <option value="">Select location…</option>
                {LOCATION_OPTIONS.map(l => <option key={l} value={l}>{l}</option>)}
              </select>
            </div>
            <p className="text-xs text-slate-500">
              Don't see your location? Type a description in the "What help" step.
            </p>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-2">
              <button
                type="button"
                onClick={() => {
                  setLocationError(null);
                  if (!navigator.geolocation) {
                    setLocationError('Location services are not available in this browser. Call 112 for urgent help.');
                    return;
                  }
                  navigator.geolocation.getCurrentPosition(
                    position => {
                      setLat(position.coords.latitude);
                      setLng(position.coords.longitude);
                    },
                    () => setLocationError('Could not read your location. Allow location access or call 112 for urgent help.'),
                    { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 },
                  );
                }}
                className="rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100"
              >
                Use my current location
              </button>
              <p className="text-[11px] text-slate-500">
                {lat !== 0 || lng !== 0 ? `Location ready (${lat.toFixed(4)}, ${lng.toFixed(4)}). It is sent only with your request and consent.` : 'GPS location is required to submit a request; no default location will be invented.'}
              </p>
              {locationError && <p role="alert" className="text-xs text-red-700">{locationError}</p>}
            </div>
          </>
        )}

        {/* Step 2: What */}
        {step === 2 && (
          <>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Describe the situation *</label>
              <textarea
                value={needsSummary}
                onChange={e => setNeedsSummary(e.target.value)}
                rows={3}
                className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-500 resize-none"
                placeholder="Describe what happened and what you need…"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-2">Number of people</label>
              <input
                type="number"
                min={1}
                max={999}
                value={peopleCount}
                onChange={e => setPeopleCount(Number(e.target.value))}
                className="w-24 text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-2">Specific needs (select all that apply)</label>
              <div className="space-y-1.5">
                {NEEDS_OPTIONS.map(opt => (
                  <label key={opt.id} className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={needs.includes(opt.id)}
                      onChange={e => setNeeds(prev => e.target.checked ? [...prev, opt.id] : prev.filter(n => n !== opt.id))}
                      className="rounded"
                    />
                    {opt.label}
                  </label>
                ))}
              </div>
            </div>
          </>
        )}

        {/* Step 3: Contact */}
        {step === 3 && (
          <>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Contact phone *</label>
              <input
                type="tel"
                value={phone}
                onChange={e => setPhone(e.target.value)}
                placeholder="+91 XXXXX XXXXX"
                className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
            </div>
            <label className="flex items-start gap-2 text-xs text-slate-600 cursor-pointer">
              <input
                type="checkbox"
                checked={consent}
                onChange={e => setConsent(e.target.checked)}
                className="rounded mt-0.5 flex-shrink-0"
              />
              <span>
                Your phone number and GPS coordinates will be shared with responders handling this request.{' '}
                <button className="text-teal-700 underline">read more</button>
              </span>
            </label>
          </>
        )}

        {/* Step 4: Review */}
        {step === 4 && (
          <>
            <div className="space-y-2 text-xs">
              <p><span className="font-semibold text-slate-600">Location:</span> {location || '—'}</p>
              <p><span className="font-semibold text-slate-600">People:</span> {peopleCount}</p>
              <p><span className="font-semibold text-slate-600">Needs:</span> {[needsSummary, ...needs.map(n => NEEDS_OPTIONS.find(o => o.id === n)?.label ?? n)].filter(Boolean).join(', ') || '—'}</p>
              <p><span className="font-semibold text-slate-600">Contact:</span> {phone ? `${phone.slice(0, -4).replace(/./g, '*')}${phone.slice(-4)}` : '—'}</p>
            </div>
            <div className="bg-red-50 border border-red-200 rounded-lg p-3">
              <p className="text-xs font-semibold text-red-800 flex items-start gap-1.5">
                <AlertTriangle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
                This form does NOT dispatch help automatically. In an emergency call 112.
              </p>
            </div>
            {error && <p className="text-xs text-red-600">{error}</p>}
          </>
        )}

        {/* Navigation */}
        <div className="flex justify-between pt-2">
          {step > 1 ? (
            <button
              onClick={() => setStep(s => s - 1)}
              className="inline-flex items-center gap-1 text-xs text-slate-600 hover:text-slate-900 transition"
            >
              <ChevronLeft className="w-3.5 h-3.5" /> Back
            </button>
          ) : <div />}

          {step < 4 ? (
            <button
              onClick={() => setStep(s => s + 1)}
              disabled={
                (step === 1 && !location) ||
                (step === 2 && !needsSummary.trim())
              }
              className="inline-flex items-center gap-1 px-4 py-2 text-xs font-semibold bg-teal-600 text-white rounded-lg hover:bg-teal-700 disabled:opacity-50 transition"
            >
              Next <ChevronRight className="w-3.5 h-3.5" />
            </button>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={submitting || !consent || !phone.trim() || (!isOnline)}
              className="inline-flex items-center gap-1 px-4 py-2 text-xs font-semibold bg-teal-600 text-white rounded-lg hover:bg-teal-700 disabled:opacity-50 transition"
            >
              {submitting ? 'Submitting…' : !isOnline ? 'Offline — connect to submit' : 'Submit Request'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Responder View ──────────────────────────────────────────────────────────

function maskPhone(phone: string): string {
  if (!phone || phone.length < 4) return '***';
  return `***-***-${phone.slice(-4)}`;
}

function ResponderView({ userRole }: { userRole: UserRole }) {
  const [requests, setRequests] = useState<RescueRequestItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedReq, setSelectedReq] = useState<RescueRequestItem | null>(null);
  const [revealedPhone, setRevealedPhone] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [newStatus, setNewStatus] = useState<RescueStatus>('RECEIVED');
  const [notes, setNotes] = useState('');
  const [updating, setUpdating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.listRescueRequests(statusFilter !== 'ALL' ? statusFilter : undefined);
      setRequests(data);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => { load(); }, [load]);

  async function handleStatusUpdate(comment?: string) {
    if (!selectedReq) return;
    setUpdating(true);
    try {
      const updated = await api.updateRescueRequestStatus(selectedReq.id, {
        new_status: newStatus,
        responder_id: userRole + '-user',
        responder_role: userRole,
        notes: comment ?? notes,
      });
      setRequests(prev => prev.map(r => r.id === updated.id ? updated : r));
      setSelectedReq(updated);
      setConfirmOpen(false);
    } catch (e: unknown) {
      console.error('Status update failed', e);
    } finally {
      setUpdating(false);
    }
  }

  if (loading) return <Skeleton className="h-40 w-full rounded-xl" />;
  if (error) return <ErrorState message={error} onRetry={load} />;

  return (
    <>
      <div className="flex items-center gap-3 mb-3">
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none"
        >
          {['ALL', 'SUBMITTED', 'RECEIVED', 'ASSIGNED', 'EN_ROUTE', 'SERVED', 'CLOSED'].map(s => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>

      <DataTable<RescueRequestItem & { _maskedPhone: string }>
        data={requests.map(r => ({ ...r, _maskedPhone: maskPhone(r.public_reference) }))}
        keyField="id"
        searchable
        searchPlaceholder="Search by reference or location…"
        exportFilename="rescue-requests"
        columns={[
          { key: 'public_reference', label: 'Reference', sortable: true },
          { key: 'location_name', label: 'Location', sortable: true },
          { key: 'people_count', label: 'People', sortable: true },
          { key: 'status', label: 'Status', sortable: true, render: r => (
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
              r.status === 'EN_ROUTE' ? 'bg-teal-100 text-teal-700' :
              r.status === 'SERVED' || r.status === 'CLOSED' ? 'bg-green-100 text-green-700' :
              'bg-amber-100 text-amber-700'
            }`}>{r.status}</span>
          )},
          { key: 'submitted_at', label: 'Submitted', sortable: true, render: r => new Date(r.submitted_at).toLocaleString('en-IN') },
          { key: 'id', label: 'Actions', render: r => (
            <button
              onClick={() => { setSelectedReq(r); setRevealedPhone(null); }}
              className="text-teal-700 text-xs font-semibold hover:underline"
            >
              View
            </button>
          )},
        ]}
      />

      {/* Detail Drawer */}
      <Drawer
        open={!!selectedReq}
        onClose={() => setSelectedReq(null)}
        title={selectedReq?.public_reference ?? 'Rescue Request'}
      >
        {selectedReq && (
          <div className="space-y-4">
            <StatusStepper currentStatus={selectedReq.status} />

            <div className="space-y-2 text-xs">
              <Row label="Location" value={selectedReq.location_name} />
              <Row label="People" value={selectedReq.people_count} />
              <Row label="Needs" value={selectedReq.needs_summary || '—'} />
              <Row
                label="Contact"
                value={
                  <div className="flex items-center gap-2">
                    <span className="font-mono">
                      {revealedPhone ?? maskPhone(selectedReq.public_reference)}
                    </span>
                    <button
                      onClick={() => setRevealedPhone(prev => prev ? null : '*** revealed ***')}
                      className="text-teal-700 text-[10px] underline"
                    >
                      {revealedPhone ? 'Hide' : 'Reveal'}
                    </button>
                  </div>
                }
              />
              <Row label="Submitted" value={new Date(selectedReq.submitted_at).toLocaleString('en-IN')} />
              {selectedReq.status_notes && <Row label="Notes" value={selectedReq.status_notes} />}
            </div>

            {/* Status transition */}
            {VALID_TRANSITIONS[selectedReq.status].length > 0 && (
              <div className="space-y-2">
                <label className="block text-xs font-semibold text-slate-700">Update Status</label>
                <select
                  value={newStatus}
                  onChange={e => setNewStatus(e.target.value as RescueStatus)}
                  className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2"
                >
                  {VALID_TRANSITIONS[selectedReq.status].map(s => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
                <input
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  placeholder="Add notes (optional)…"
                  className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2"
                />
                <button
                  onClick={() => setConfirmOpen(true)}
                  className="w-full py-2 text-sm font-semibold bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition"
                >
                  Update to {newStatus}
                </button>
              </div>
            )}
          </div>
        )}
      </Drawer>

      <ConfirmDialog
        open={confirmOpen}
        title={`Update status to ${newStatus}?`}
        consequenceText={
          newStatus === 'EN_ROUTE'
            ? 'This will inform the citizen that help is on the way. Only set this if a team is actually dispatched.'
            : `This will change the status to ${newStatus}. This action is audited.`
        }
        auditNote="This action is logged in the audit trail."
        onConfirm={handleStatusUpdate}
        onCancel={() => setConfirmOpen(false)}
        loading={updating}
      />
    </>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-slate-500 flex-shrink-0">{label}</span>
      <span className="text-slate-800 text-right">{value}</span>
    </div>
  );
}
