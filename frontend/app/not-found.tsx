import Link from 'next/link';
import { cookies } from 'next/headers';
import { isLang, translate, LANG_COOKIE, type Lang } from '@/lib/i18n/core';

export default async function NotFound() {
  const saved = (await cookies()).get(LANG_COOKIE)?.value;
  const lang: Lang = isLang(saved) ? saved : 'en';
  const t = (s: string) => translate(lang, s);
  return (
    <div className="nf-page">
      <div className="nf-card">
        <div className="nf-code">404</div>
        <h1>{t('Page not found')}</h1>
        <p>{t('The address you opened does not exist in Purchase & Sales Management.')}</p>
        <div className="nf-links">
          <Link className="btn btn-primary" href="/">{t('Go to dashboard')}</Link>
          <Link className="btn" href="/login">{t('Sign in')}</Link>
          <Link className="btn" href="/settings?tab=users">{t('Administration')}</Link>
        </div>
      </div>
    </div>
  );
}
