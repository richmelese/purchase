'use client';

import Link from 'next/link';
import AuthShell from '@/components/AuthShell';
import { useT } from '@/lib/i18n';

export default function ForgotPasswordPage() {
  const { t } = useT();
  return (
    <AuthShell title={t('RESET')}>
      <p className="auth-note" style={{ marginTop: 0 }}>
        {t('For security, passwords are reset by your system administrator. Ask an administrator to open')}
        {' '}<strong>{t('Settings › Users')}</strong> {t('and set a new password for your account.')}
      </p>
      <p className="auth-note">{t('After you sign in, you can change it yourself with the')} <strong>{t('Password')}</strong> {t('button in the sidebar.')}</p>
      <Link className="auth-btn" href="/login" style={{ display: 'block', textAlign: 'center', textDecoration: 'none' }}>{t('Back to sign in')}</Link>
    </AuthShell>
  );
}
