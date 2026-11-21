'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import AuthShell, { AuthInput, UserIcon, KeyIcon } from '@/components/AuthShell';
import { useT } from '@/lib/i18n';

// Only allow same-site relative paths after sign-in.
function safeNext(n: string | null) {
  return n && n.startsWith('/') && !n.startsWith('//') && !n.startsWith('/login') ? n : '/';
}

type LoginForm = {
  username: string;
  password: string;
  remember: boolean;
};

function LoginForm() {
  const { t } = useT();
  const params = useSearchParams();
  const [f, setF] = useState<LoginForm>({ username: '', password: '', remember: true });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [firstRun, setFirstRun] = useState(false);
  const registered = params.get('registered');
  const notice = registered === 'pending'
    ? t('Account created. An administrator must activate it before you can sign in.')
    : registered === 'admin' ? t('Administrator account created. Please sign in.') : '';

  useEffect(() => {
    fetch('/api/auth/status').then((r) => r.json()).then((d) => setFirstRun(!d.hasUsers)).catch(() => {});
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!f.username.trim() || !f.password) { setError(t('Enter your user name and password')); return; }
    setBusy(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(f),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(t(data.error || 'Sign in failed'));
      window.location.href = safeNext(params.get('next'));
    } catch (err: any) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <AuthShell title={t('SIGN IN')}>
      {notice && <div className="auth-ok">{notice}</div>}
      {firstRun && !notice && (
        <div className="auth-ok">{t('No users yet –')} <Link href="/signup">{t('sign up')}</Link> {t('to create the administrator account.')}</div>
      )}
      {error && <div className="auth-error" role="alert">{error}</div>}
      <form onSubmit={submit} noValidate>
        <div className="auth-fields">
          <AuthInput icon={UserIcon} placeholder={t('user name')} autoComplete="username" autoFocus
            value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} aria-label={t('User name')} />
          <AuthInput icon={KeyIcon} placeholder={t('password')} type="password" autoComplete="current-password"
            value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} aria-label={t('Password')} />
        </div>
        <button className="auth-btn" type="submit" disabled={busy}>{busy ? t('Signing in…') : t('Login')}</button>
        <div className="auth-row">
          <label><input type="checkbox" checked={f.remember} onChange={(e) => setF({ ...f, remember: e.target.checked })} />{t('Remember me')}</label>
          <Link className="auth-link" href="/signup">{t('Signup')}</Link>
        </div>
        <Link className="auth-forgot" href="/forgot-password">{t('Forgot Password?')}</Link>
      </form>
    </AuthShell>
  );
}

export default function LoginPage() {
  return <Suspense fallback={null}><LoginForm /></Suspense>;
}
