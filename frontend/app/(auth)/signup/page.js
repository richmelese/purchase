'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import AuthShell, { AuthInput, UserIcon, KeyIcon, IdIcon } from '@/components/AuthShell';

export default function SignupPage() {
  const [f, setF] = useState({ full_name: '', username: '', password: '', confirm: '' });
  const [err, setErr] = useState({});
  const [busy, setBusy] = useState(false);
  const [firstRun, setFirstRun] = useState(false);
  useEffect(() => {
    fetch('/api/auth/status').then((r) => r.json()).then((d) => setFirstRun(!d.hasUsers)).catch(() => {});
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    if (f.password !== f.confirm) { setErr({ confirm: 'Passwords do not match' }); return; }
    setBusy(true);
    try {
      const res = await fetch('/api/auth/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(f) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setErr({ ...(data.fields || {}), _: data.error || 'Sign up failed' }); setBusy(false); return; }
      window.location.href = `/login?registered=${data.first ? 'admin' : 'pending'}`;
    } catch {
      setErr({ _: 'Could not reach the server' });
      setBusy(false);
    }
  };
  const set = (k) => (e) => { setF({ ...f, [k]: e.target.value }); setErr({ ...err, [k]: undefined }); };

  return (
    <AuthShell title="SIGN UP" compact>
      <p className="auth-note">
        {firstRun ? 'This first account will be the administrator.' : 'New accounts must be activated by an administrator.'}
      </p>
      {err._ && <div className="auth-error" role="alert">{err._}</div>}
      <form onSubmit={submit} noValidate>
        <div className="auth-fields">
          <AuthInput icon={IdIcon} placeholder="full name" autoComplete="name" autoFocus value={f.full_name} onChange={set('full_name')} aria-label="Full name" />
          {err.full_name && <div className="auth-field-err">{err.full_name}</div>}
          <AuthInput icon={UserIcon} placeholder="user name" autoComplete="username" value={f.username} onChange={set('username')} aria-label="User name" />
          {err.username && <div className="auth-field-err">{err.username}</div>}
          <AuthInput icon={KeyIcon} placeholder="password (min. 8 characters)" type="password" autoComplete="new-password" value={f.password} onChange={set('password')} aria-label="Password" />
          {err.password && <div className="auth-field-err">{err.password}</div>}
          <AuthInput icon={KeyIcon} placeholder="confirm password" type="password" autoComplete="new-password" value={f.confirm} onChange={set('confirm')} aria-label="Confirm password" />
          {err.confirm && <div className="auth-field-err">{err.confirm}</div>}
        </div>
        <button className="auth-btn" type="submit" disabled={busy}>{busy ? 'Creating account…' : 'Create account'}</button>
        <div className="auth-row" style={{ justifyContent: 'center' }}>
          <span>Already have an account? <Link className="auth-link" href="/login">Sign in</Link></span>
        </div>
      </form>
    </AuthShell>
  );
}
