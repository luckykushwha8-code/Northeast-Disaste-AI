import React, { useState } from 'react';
import { LockKeyhole, X } from 'lucide-react';
import { api } from '../api/client';
import type { AuthenticatedUser } from '../types';

interface AuthDialogProps {
  onClose: () => void;
  onLogin: (user: AuthenticatedUser) => void;
}

export const AuthDialog: React.FC<AuthDialogProps> = ({ onClose, onLogin }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      onLogin(await api.login(username.trim(), password));
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Login failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/60 p-4" role="presentation" onMouseDown={event => event.target === event.currentTarget && onClose()}>
      <section role="dialog" aria-modal="true" aria-labelledby="login-title" className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl">
        <div className="mb-4 flex items-start justify-between">
          <div>
            <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-xl bg-teal-50 text-teal-700"><LockKeyhole className="h-5 w-5" /></div>
            <h2 id="login-title" className="text-lg font-bold text-slate-900">Protected staff login</h2>
            <p className="mt-1 text-xs text-slate-500">Sign in to approve alerts, review incidents, or update responder status.</p>
          </div>
          <button onClick={onClose} aria-label="Close login" className="rounded-lg p-2 text-slate-400 hover:bg-slate-100"><X className="h-4 w-4" /></button>
        </div>

        <form onSubmit={submit} className="space-y-3">
          <label className="block text-xs font-semibold text-slate-700" htmlFor="auth-username">Username
            <input id="auth-username" autoComplete="username" required maxLength={80} value={username} onChange={event => setUsername(event.target.value)} className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal" />
          </label>
          <label className="block text-xs font-semibold text-slate-700" htmlFor="auth-password">Password
            <input id="auth-password" autoComplete="current-password" type="password" required maxLength={1024} value={password} onChange={event => setPassword(event.target.value)} className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal" />
          </label>
          {error && <p className="rounded-lg border border-rose-200 bg-rose-50 p-2 text-xs text-rose-800" role="alert">{error}</p>}
          <button disabled={busy} className="w-full rounded-lg bg-teal-700 px-3 py-2.5 text-sm font-bold text-white hover:bg-teal-800 disabled:opacity-50">{busy ? 'Signing in…' : 'Sign in'}</button>
        </form>

        <p className="mt-4 rounded-lg bg-slate-50 p-3 text-[10px] leading-relaxed text-slate-500">
          Accounts are configured by the backend administrator. If login is not configured, create a password hash with <code>python -m app.auth hash-password</code> in <code>backend</code>, then set <code>AUTH_SECRET_KEY</code> and <code>AUTH_USERS_JSON</code> in the private backend environment file. Never put passwords in frontend code.
        </p>
      </section>
    </div>
  );
};
