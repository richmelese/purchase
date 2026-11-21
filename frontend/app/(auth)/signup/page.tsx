'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import AuthShell, { AuthInput, UserIcon, KeyIcon, IdIcon } from '@/components/AuthShell';
import { useT } from '@/lib/i18n';

type SignupForm = {
  full_name: string;
  username: string;
  password: string;
  confirm: string;
};

export default function SignupPage() {
  const { t } = useT();
  const [f, setF] = useState<SignupForm>({ full_name: '', username: '', password: '', confirm: '' });
  const [err, setErr] = useState<Record<string, string | undefined>>({});
  const [busy, setBusy] = useState(false);
  const [firstRun, setFirstRun] = useState(false);
  useEffect(() => {
    fetch('/api/auth/status').then((r) => r.json()).then((d) => setFirstRun(!d.hasUsers)).catch(() => {});
  }, []);

  const submit = async (e: React.FormEvent) => {
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
  const set = (k: keyof SignupForm) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setF({ ...f, [k]: e.target.value });
    setErr({ ...err, [k]: undefined });
  };
  // Errors are stored in English (some come from the server) and translated when shown.
  const show = (m?: string) => (m ? <div className="auth-field-err">{t(m)}</div> : null);

  return (
    <AuthShell title={t('SIGN UP')} compact>
      <p className="auth-note">
        {firstRun ? t('This first account will be the administrator.') : t('New accounts must be activated by an administrator.')}
      </p>
      {err._ && <div className="auth-error" role="alert">{t(err._)}</div>}
      <form onSubmit={submit} noValidate>
        <div className="auth-fields">
          <AuthInput icon={IdIcon} placeholder={t('full name')} autoComplete="name" autoFocus value={f.full_name} onChange={set('full_name')} aria-label={t('Full name')} />
          {show(err.full_name)}
          <AuthInput icon={UserIcon} placeholder={t('user name')} autoComplete="username" value={f.username} onChange={set('username')} aria-label={t('User name')} />
          {show(err.username)}
          <AuthInput icon={KeyIcon} placeholder={t('password (min. 8 characters)')} type="password" autoComplete="new-password" value={f.password} onChange={set('password')} aria-label={t('Password')} />
          {show(err.password)}
          <AuthInput icon={KeyIcon} placeholder={t('confirm password')} type="password" autoComplete="new-password" value={f.confirm} onChange={set('confirm')} aria-label={t('Confirm password')} />
          {show(err.confirm)}
        </div>
        <button className="auth-btn" type="submit" disabled={busy}>{busy ? t('Creating account…') : t('Create account')}</button>
        <div className="auth-row" style={{ justifyContent: 'center' }}>
          <span>{t('Already have an account?')} <Link className="auth-link" href="/login">{t('Sign in')}</Link></span>
        </div>
      </form>
    </AuthShell>
  );
}
