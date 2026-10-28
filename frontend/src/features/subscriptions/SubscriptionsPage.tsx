import React, { useEffect, useState } from 'react';
import { Mail, BellRing, ShieldCheck, AlertTriangle, X, CheckCircle2 } from 'lucide-react';
import { api } from '../../api/client';
import type { AlertDistrictItem, PublicAlertEmailStatus, SubscriptionResult } from '../../types';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function SubscriptionsPage() {
  const [districts, setDistricts] = useState<AlertDistrictItem[]>([]);
  const [emailStatus, setEmailStatus] = useState<PublicAlertEmailStatus | null>(null);
  const [email, setEmail] = useState('');
  const [district, setDistrict] = useState('');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SubscriptionResult | null>(null);
  const [error, setError] = useState('');
  const [unsubEmail, setUnsubEmail] = useState('');
  const [unsubDistrict, setUnsubDistrict] = useState('');
  const [unsubBusy, setUnsubBusy] = useState(false);
  const [unsubResult, setUnsubResult] = useState<string | null>(null);
  const [unsubError, setUnsubError] = useState('');

  useEffect(() => {
    api.getAlertDistricts()
      .then(ds => {
        setDistricts(ds);
        if (ds.length) {
          setDistrict(ds[0].district);
          setUnsubDistrict(ds[0].district);
        }
      })
      .catch(() => setError('Could not load district list. Please try again.'));
    api.getPublicAlertEmailStatus()
      .then(setEmailStatus)
      .catch(() => setEmailStatus({
        status: 'UNKNOWN', enabled: false, smtp_configured: false,
        missing_smtp_settings: [],
        reason: 'Delivery readiness could not be verified from the backend.',
        provider_acceptance_is_not_inbox_delivery: true,
      }));
  }, []);

  const subscribe = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setResult(null);
    if (!EMAIL_RE.test(email) || email.length > 254) {
      setError('Please enter a valid email address.');
      return;
    }
    if (!consent) { setError('Your explicit consent is required to subscribe.'); return; }
    if (!district) { setError('Please select a district.'); return; }
    setBusy(true);
    try {
      const data = await api.subscribeToAlerts(email, district, consent);
      setResult(data);
      setEmail('');
      setConsent(false);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } }; message?: string };
      setError(e?.response?.data?.detail || e?.message || 'Subscription failed. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const unsubscribe = async (e: React.FormEvent) => {
    e.preventDefault();
    setUnsubError('');
    setUnsubResult(null);
    if (!EMAIL_RE.test(unsubEmail)) {
      setUnsubError('Enter the email address you subscribed with.');
      return;
    }
    setUnsubBusy(true);
    try {
      await api.unsubscribeFromAlerts(unsubEmail, unsubDistrict);
      setUnsubResult('Consent withdrawn. You will no longer receive alert emails for this district.');
      setUnsubEmail('');
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } }; message?: string };
      setUnsubError(e?.response?.data?.detail || e?.message || 'Unsubscribe failed.');
    } finally {
      setUnsubBusy(false);
    }
  };

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Delivery state is read from the backend; never infer readiness in the browser. */}
      <div className={`rounded-xl border p-4 flex items-start gap-3 ${emailStatus?.status === 'ON' ? 'bg-emerald-50 border-emerald-300' : 'bg-amber-50 border-amber-300'}`}>
        {emailStatus?.status === 'ON'
          ? <ShieldCheck className="w-5 h-5 text-emerald-700 flex-shrink-0 mt-0.5" />
          : <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />}
        <div>
          <div className={`text-sm font-bold ${emailStatus?.status === 'ON' ? 'text-emerald-800' : 'text-amber-800'}`}>
            {!emailStatus ? 'Checking public alert email status…' : emailStatus.status === 'ON' ? 'Public alert email dispatch is ON' : emailStatus.status === 'NEEDS_SMTP' ? 'Public alert emails need SMTP configuration' : emailStatus.status === 'UNKNOWN' ? 'Public alert email status could not be checked' : 'Public alert emails are currently OFF'}
          </div>
          <p className={`text-xs mt-1 ${emailStatus?.status === 'ON' ? 'text-emerald-800' : 'text-amber-700'}`}>
            {emailStatus?.reason || 'Checking backend configuration.'} Subscribing records consent; email is only attempted for an eligible operator-issued alert, and SMTP acceptance does not guarantee inbox delivery.
          </p>
        </div>
      </div>

      {/* Subscribe */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
        <div className="flex items-center gap-2 mb-1">
          <BellRing className="w-5 h-5 text-teal-700" />
          <h2 className="text-base font-bold text-slate-900">Subscribe to District Alert Emails</h2>
        </div>
        <p className="text-xs text-slate-500 mb-4">
          Choose your district — Geo Shield <strong>never infers your location</strong>.
          Messages are platform advisories, not government warnings; official ASDMA/SDMA/DDMA instructions take precedence.
        </p>

        {result ? (
          <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl flex items-start gap-3">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" />
            <div>
              <div className="text-sm font-bold text-emerald-800">Subscription saved!</div>
              <p className="text-xs text-emerald-700 mt-1">
                Consent for {result.email} is saved for <strong>{result.district}</strong>. {result.email_delivery?.reason || result.note || 'The current email delivery state is unavailable.'}
                {result.updated && ' (Existing subscription updated.)'}
              </p>
              <button onClick={() => setResult(null)} className="mt-2 text-xs text-emerald-600 font-semibold hover:underline">Subscribe another district</button>
            </div>
          </div>
        ) : (
          <form onSubmit={subscribe} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1" htmlFor="sub-email">Email Address</label>
                <input
                  id="sub-email"
                  type="email"
                  required
                  maxLength={254}
                  placeholder="you@example.org"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  className="w-full text-sm p-2.5 rounded-lg border border-slate-300 bg-slate-50 text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1" htmlFor="sub-district">District</label>
                <select
                  id="sub-district"
                  value={district}
                  onChange={e => setDistrict(e.target.value)}
                  className="w-full text-sm p-2.5 rounded-lg border border-slate-300 bg-slate-50 text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-500"
                >
                  {districts.length === 0 && <option value="">Loading districts…</option>}
                  {districts.map(d => (
                    <option key={d.district} value={d.district}>{d.district}, {d.state}</option>
                  ))}
                </select>
              </div>
            </div>

            <label className="flex items-start gap-3 cursor-pointer p-3 bg-slate-50 rounded-lg border border-slate-200">
              <input
                type="checkbox"
                checked={consent}
                onChange={e => setConsent(e.target.checked)}
                className="mt-0.5 accent-teal-700"
              />
              <span className="text-xs text-slate-700">
                <strong>I consent</strong> to receive flood and landslide risk alert emails for <strong>{district || 'this district'}</strong>.
                I understand that: (1) these emails are AI-generated advisories, not official government warnings;
                (2) no location tracking is performed; (3) I can unsubscribe at any time below;
                (4) emails are sent only when HIGH or CRITICAL risk is assessed and approved by an operator.
              </span>
            </label>

            {error && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700 flex items-start gap-2">
                <X className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={busy || !consent || !district || !email}
              className="flex items-center gap-2 px-5 py-2.5 bg-teal-700 text-white rounded-lg text-sm font-bold hover:bg-teal-800 disabled:opacity-50 transition"
            >
              <Mail className="w-4 h-4" />
              {busy ? 'Saving…' : 'Subscribe to Alerts'}
            </button>
          </form>
        )}
      </div>

      {/* Unsubscribe */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
        <div className="flex items-center gap-2 mb-1">
          <ShieldCheck className="w-5 h-5 text-slate-500" />
          <h3 className="text-sm font-bold text-slate-900">Withdraw Consent (Unsubscribe)</h3>
        </div>
        <p className="text-xs text-slate-500 mb-4">Enter your email and district to withdraw your subscription at any time. No questions asked.</p>

        {unsubResult ? (
          <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-800">
            <CheckCircle2 className="w-3.5 h-3.5 inline mr-1" />
            {unsubResult}
          </div>
        ) : (
          <form onSubmit={unsubscribe} className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input
                type="email"
                required
                placeholder="Subscribed email address"
                value={unsubEmail}
                onChange={e => setUnsubEmail(e.target.value)}
                className="text-sm p-2.5 rounded-lg border border-slate-300 bg-slate-50 text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-400"
              />
              <select
                value={unsubDistrict}
                onChange={e => setUnsubDistrict(e.target.value)}
                className="text-sm p-2.5 rounded-lg border border-slate-300 bg-slate-50 text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-400"
              >
                {districts.map(d => <option key={d.district} value={d.district}>{d.district}</option>)}
              </select>
            </div>
            {unsubError && <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-2.5">{unsubError}</div>}
            <button
              type="submit"
              disabled={unsubBusy}
              className="text-sm font-semibold text-rose-600 hover:text-rose-800 disabled:opacity-50 transition"
            >
              {unsubBusy ? 'Processing…' : 'Unsubscribe & withdraw consent'}
            </button>
          </form>
        )}
      </div>

      {/* What happens after subscribing */}
      <div className="bg-slate-50 rounded-xl border border-slate-200 p-4 text-xs text-slate-600 space-y-2">
        <div className="font-bold text-slate-700">What happens when you subscribe?</div>
        <ul className="space-y-1 list-disc list-inside">
          <li>Your email is saved with your district and consent timestamp</li>
          <li>Automatic dispatch is currently disabled; a saved subscription does not send a message</li>
          <li>If dispatch is enabled, messages are identified as platform advisories, not official warnings</li>
          <li>After SMTP and dispatch are configured, provider acceptance still does not guarantee delivery</li>
          <li>No marketing, no sharing, no location data collected</li>
          <li>Withdraw consent using the form above</li>
        </ul>
      </div>
    </div>
  );
}
