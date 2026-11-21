'use client';

import { useEffect, useState } from 'react';
import AuthShell, { AuthInput, KeyIcon } from '@/components/AuthShell';
import { useT } from '@/lib/i18n';

type Me = {
  username?: string;
  party_id?: string | number;
  company_name?: string;
  must_change_password?: boolean;
  [key: string]: unknown;
};

type ChangePasswordForm = {
  current_password: string;
  new_password: string;
  confirm: string;
};

// Shown right after signing in with a generated or reset password (and reachable from the menus).
export default function ChangePasswordPage() {
  const { t } = useT();
  const [me, setMe] = useState<Me | null>(null);
  const [f, setF] = useState<ChangePasswordForm>({ current_password: '', new_password: '', confirm: '' });
  const [error, setError] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch('/api/auth/me').then((r) => (r.ok ? r.json() : null)).then(setMe).catch(() => {});
  }, []);

  const set = (k: keyof ChangePasswordForm) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setFields({});
    if (!f.current_password || !f.new_password) { setError(t('Fill in all fields')); return; }
    if (f.new_password.length < 8) { setFields({ password: 'At least 8 characters' }); setError(t('The new password must have at least 8 characters')); return; }
    if (f.new_password !== f.confirm) { setFields({ confirm: 'Does not match' }); setError(t('The new passwords do not match')); return; }
    setBusy(true);
    try {
      const res = await fetch('/api/auth/password', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ current_password: f.current_password, new_password: f.new_password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setFields(data.fields || {}); throw new Error(t(data.error || 'Could not change the password')); }
      window.location.href = me?.party_id ? '/portal' : '/';
    } catch (err: any) {
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
    <AuthShell title={t('CHANGE PASSWORD')} compact>
      {me && (
        <div className="auth-ok">
          {forced
            ? <>{me.company_name ? t('Welcome, {name}. Please choose your own password to continue.', { name: me.company_name }) : t('Welcome. Please choose your own password to continue.')}</>
            : <>{t('Signed in as')} <b>{me.username}</b>.</>}
        </div>
      )}
      {error && <div className="auth-error" role="alert">{error}</div>}
      <form onSubmit={submit} noValidate>
        <div className="auth-fields">
          <AuthInput icon={KeyIcon} type="password" placeholder={forced ? t('password you were given') : t('current password')} autoComplete="current-password"
            value={f.current_password} onChange={set('current_password')} aria-label={t('Current password')} aria-invalid={!!fields.current_password} autoFocus />
          <AuthInput icon={KeyIcon} type="password" placeholder={t('new password (min. 8 characters)')} autoComplete="new-password"
            value={f.new_password} onChange={set('new_password')} aria-label={t('New password')} aria-invalid={!!fields.password} />
          <AuthInput icon={KeyIcon} type="password" placeholder={t('confirm new password')} autoComplete="new-password"
            value={f.confirm} onChange={set('confirm')} aria-label={t('Confirm new password')} aria-invalid={!!fields.confirm} />
        </div>
        <button className="auth-btn" type="submit" disabled={busy}>{busy ? t('Saving…') : t('Change password')}</button>
        <div className="auth-row">
          {!forced && me && <a className="auth-link" href={me.party_id ? '/portal' : '/'}>{t('Cancel')}</a>}
          <button type="button" className="auth-link auth-link-btn" onClick={signOut}>{t('Sign out')}</button>
        </div>
      </form>
    </AuthShell>
  );
}
