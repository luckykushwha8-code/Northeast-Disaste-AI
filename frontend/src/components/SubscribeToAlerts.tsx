import React, { useEffect, useState } from 'react';
import { Mail, BellRing, ShieldCheck } from 'lucide-react';
import { api } from '../api/client';
import { SubscriptionResult } from '../types';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const SubscribeToAlerts: React.FC = () => {
  const [districts, setDistricts] = useState<string[]>([]);
  const [email, setEmail] = useState('');
  const [district, setDistrict] = useState('');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SubscriptionResult | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.getAlertDistricts()
      .then(ds => {
        setDistricts(ds.map(d => d.district));
        if (ds.length) setDistrict(ds[0].district);
      })
      .catch(() => setError('District list unavailable.'));
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setResult(null);
    if (!EMAIL_RE.test(email) || email.length > 254) {
      setError('Enter a valid email address.');
      return;
    }
    if (!consent) {
      setError('Consent is required to subscribe.');
      return;
    }
    setBusy(true);
    try {
      const data = await api.subscribeToAlerts(email, district, consent);
      setResult(data);
      setEmail('');
      setConsent(false);
    } catch (err: any) {
      const detail = err?.response?.data?.detail;
      setError(typeof detail === 'string' ? detail : (err?.message || 'Subscription failed.'));
    } finally {
      setBusy(false);
    }
  };

  const withdraw = async () => {
    setError('');
    setResult(null);
    if (!EMAIL_RE.test(email)) {
      setError('Enter the email address you subscribed with.');
      return;
    }
    setBusy(true);
    try {
      const data = await api.unsubscribeFromAlerts(email, district);
      setResult({ ...data, note: 'Consent withdrawn. No further alert emails will address this address.' });
    } catch (err: any) {
      const detail = err?.response?.data?.detail;
      setError(typeof detail === 'string' ? detail : (err?.message || 'Unsubscribe failed.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm">
      <div className="flex items-center gap-2 mb-2">
        <BellRing className="w-5 h-5 text-amber-600" />
        <h3 className="text-sm font-bold text-slate-900">Subscribe to district alert emails</h3>
      </div>
      <p className="text-xs text-slate-500 mb-4">
        Choose the district you live in — the platform never infers your location. You'll receive
        HIGH/CRITICAL flood and landslide reports for that district by email. Every report carries the
        marker "not a government-issued warning"; official ASDMA/DDMA instructions always take precedence.
        <span className="ml-1 font-semibold text-amber-700">Automatic sends are disabled until the data and model are validated.</span>
      </p>
      <form onSubmit={submit} className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <input
          id="alert-email"
          type="email"
          required
          maxLength={254}
          placeholder="you@example.org"
          value={email}
          onChange={e => setEmail(e.target.value)}
          className="text-sm font-medium p-2.5 rounded-lg border border-slate-300 bg-slate-50 text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        <select
          id="alert-district"
          value={district}
          onChange={e => setDistrict(e.target.value)}
          className="text-sm font-semibold p-2.5 rounded-lg border border-slate-300 bg-slate-50 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          {districts.length === 0 && <option value="">Loading districts…</option>}
          {districts.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
        <button
          type="submit"
          disabled={busy || !consent || !district}
          className="flex items-center justify-center gap-1.5 px-4 py-2.5 bg-indigo-600 text-white rounded-lg text-sm font-bold hover:bg-indigo-700 disabled:opacity-50 transition"
        >
          <Mail className="w-4 h-4" />
          {busy ? 'Working…' : 'Subscribe'}
        </button>
      </form>
      <label className="flex items-start gap-2 mt-3 text-[11px] text-slate-600 cursor-pointer">
        <input
          type="checkbox"
          checked={consent}
          onChange={e => setConsent(e.target.checked)}
          className="mt-0.5"
        />
        I agree to receive flood and landslide risk updates for this district by email. I can
        unsubscribe at any time below.
      </label>
      <button
        onClick={withdraw}
        disabled={busy}
        className="mt-2 text-[11px] font-semibold text-rose-600 hover:text-rose-700 disabled:opacity-50"
      >
        Withdraw consent (unsubscribe)
      </button>
      {result && (
        <div className="mt-3 text-xs bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg p-2.5">
          <ShieldCheck className="w-3.5 h-3.5 inline mr-1" />
          {result.status}: {result.note}
        </div>
      )}
      {error && <div className="mt-3 text-xs bg-rose-50 border border-rose-200 text-rose-800 rounded-lg p-2.5" role="status">{error}</div>}
    </div>
  );
};
