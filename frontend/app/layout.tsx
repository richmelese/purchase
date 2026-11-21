import './globals.css';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { cookies } from 'next/headers';
import { ToastProvider } from '@/components/ui';
import { I18nProvider } from '@/lib/i18n';
import { LANG_COOKIE, isLang, translate, type Lang } from '@/lib/i18n/core';

// Browser-tab title in the chosen language (company name stays as registered).
export async function generateMetadata(): Promise<Metadata> {
  const saved = (await cookies()).get(LANG_COOKIE)?.value;
  const lang: Lang = isLang(saved) ? saved : 'en';
  return {
    title: `Epiccenter Trading PLC – ${translate(lang, 'Purchase & Sales')}`,
    description: translate(lang, 'Purchases, sales, VAT, withholding and inventory'),
  };
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const saved = (await cookies()).get(LANG_COOKIE)?.value;
  const lang: Lang = isLang(saved) ? saved : 'en';
  return (
    <html lang={lang}>
      <body>
        <I18nProvider initialLang={lang}>
          <ToastProvider>{children}</ToastProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
