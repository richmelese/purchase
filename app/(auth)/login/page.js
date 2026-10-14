'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import AuthShell, { AuthInput, UserIcon, KeyIcon } from '@/components/AuthShell';

// Only allow same-site relative paths after sign-in.
function safeNext(n) {
  return n && n.startsWith('/') && !n.startsWith('//') && !n.startsWith('/login') ? n : '/';
}

function LoginForm() {
  const params = useSearchParams();
  const [f, setF] = useState({ username: '', password: '', remember: true });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [firstRun, setFirstRun] = useState(false);
  const registered = params.get('registered');
  const notice = registered === 'pending'
    ? 'Account created. An administrator must activate it before you can sign in.'
    : registered === 'admin' ? 'Administrator account created. Please sign in.' : '';

  useEffect(() => {
    fetch('/api/auth/status').then((r) => r.json()).then((d) => setFirstRun(!d.hasUsers)).catch(() => {});
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (!f.username.trim() || !f.password) { setError('Enter your user name and password'); return; }
    setBusy(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(f),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Sign in failed');
      window.location.href = safeNext(params.get('next'));
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <AuthShell title="SIGN IN">
      {notice && <div className="auth-ok">{notice}</div>}
      {firstRun && !notice && (
        <div className="auth-ok">No users yet – <Link href="/signup">sign up</Link> to create the administrator account.</div>
      )}
      {error && <div className="auth-error" role="alert">{error}</div>}
      <form onSubmit={submit} noValidate>
        <div className="auth-fields">
          <AuthInput icon={UserIcon} placeholder="user name" autoComplete="username" autoFocus
            value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} aria-label="User name" />
          <AuthInput icon={KeyIcon} placeholder="password" type="password" autoComplete="current-password"
            value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} aria-label="Password" />
        </div>
        <button className="auth-btn" type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Login'}</button>
        <div className="auth-row">
          <label><input type="checkbox" checked={f.remember} onChange={(e) => setF({ ...f, remember: e.target.checked })} />Remember me</label>
          <Link className="auth-link" href="/signup">Signup</Link>
        </div>
        <Link className="auth-forgot" href="/forgot-password">Forgot Password?</Link>
      </form>
    </AuthShell>
  );
}

export default function LoginPage() {
  return <Suspense fallback={null}><LoginForm /></Suspense>;
}
