'use client';

import { useEffect, useState } from 'react';
import AuthShell, { AuthInput, KeyIcon } from '@/components/AuthShell';

// Shown right after signing in with a generated or reset password (and reachable from the menus).
export default function ChangePasswordPage() {
  const [me, setMe] = useState(null);
  const [f, setF] = useState({ current_password: '', new_password: '', confirm: '' });
  const [error, setError] = useState('');
  const [fields, setFields] = useState({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch('/api/auth/me').then((r) => (r.ok ? r.json() : null)).then(setMe).catch(() => {});
  }, []);

  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setFields({});
    if (!f.current_password || !f.new_password) { setError('Fill in all fields'); return; }
    if (f.new_password.length < 8) { setFields({ password: 'At least 8 characters' }); setError('The new password must have at least 8 characters'); return; }
    if (f.new_password !== f.confirm) { setFields({ confirm: 'Does not match' }); setError('The new passwords do not match'); return; }
    setBusy(true);
    try {
      const res = await fetch('/api/auth/password', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ current_password: f.current_password, new_password: f.new_password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setFields(data.fields || {}); throw new Error(data.error || 'Could not change the password'); }
      window.location.href = me?.party_id ? '/portal' : '/';
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };
  const signOut = async () => {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
    window.location.href = '/login';
  };

  const forced = me?.must_change_password;
  return (
    <AuthShell title="CHANGE PASSWORD" compact>
      {me && (
        <div className="auth-ok">
          {forced
            ? <>Welcome{me.company_name ? `, ${me.company_name}` : ''}. Please choose your own password to continue.</>
            : <>Signed in as <b>{me.username}</b>.</>}
        </div>
      )}
      {error && <div className="auth-error" role="alert">{error}</div>}
      <form onSubmit={submit} noValidate>
        <div className="auth-fields">
          <AuthInput icon={KeyIcon} type="password" placeholder={forced ? 'password you were given' : 'current password'} autoComplete="current-password"
            value={f.current_password} onChange={set('current_password')} aria-label="Current password" aria-invalid={!!fields.current_password} autoFocus />
          <AuthInput icon={KeyIcon} type="password" placeholder="new password (min. 8 characters)" autoComplete="new-password"
            value={f.new_password} onChange={set('new_password')} aria-label="New password" aria-invalid={!!fields.password} />
          <AuthInput icon={KeyIcon} type="password" placeholder="confirm new password" autoComplete="new-password"
            value={f.confirm} onChange={set('confirm')} aria-label="Confirm new password" aria-invalid={!!fields.confirm} />
        </div>
        <button className="auth-btn" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Change password'}</button>
        <div className="auth-row">
          {!forced && me && <a className="auth-link" href={me.party_id ? '/portal' : '/'}>Cancel</a>}
          <button type="button" className="auth-link auth-link-btn" onClick={signOut}>Sign out</button>
        </div>
      </form>
    </AuthShell>
  );
}
