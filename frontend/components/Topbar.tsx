'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { formatEthiopian, taxPeriod } from '@/lib/shared/ethiopian';
import { today } from '@/lib/format';
import { LanguageSwitch, useT } from '@/lib/i18n';
import { useSession } from './session';
import Icon from './icons';

function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

export default function Topbar() {
  const { user, can } = useSession();
  const { t, lang } = useT();
  const [now, setNow] = useState<{ iso: string; hello: string } | null>(null);
  useEffect(() => { setNow({ iso: today(), hello: greeting() }); }, []);
  // English: Gregorian date; Amharic: Ethiopian date. Weekday in the chosen language.
  const day = now ? new Date(`${now.iso}T00:00:00`) : null;
  const shownDate = !day ? '' : lang === 'am'
    ? `${day.toLocaleDateString('am-ET', { weekday: 'long' })}፣ ${formatEthiopian(now!.iso)} ${t('E.C.')}`
    : day.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const period = now ? taxPeriod(now.iso) : null;
  const first = user?.full_name?.split(/\s+/)[0];

  return (
    <header className="topbar no-print">
      <div>
        <div className="topbar-greeting">{now ? `${t(now.hello)}${first ? `, ${first}` : ''}` : ' '}</div>
        <div className="topbar-date">
          <Icon name="calendar" size={14} />
          <span>{shownDate}</span>
          {period && <><span className="dot" /><span>{t('Tax month')}: {t(period.month)}</span></>}
        </div>
      </div>
      <div className="spacer" />
      <LanguageSwitch />
      {user && <span className="topbar-role" title={t('Your role decides which pages and actions you can use')}>{t((user as any).role_label || '')}</span>}
      {can('purchases', 'create') && <Link className="btn btn-sm" href="/purchases/new"><Icon name="plus" size={15} />{t('Purchase')}</Link>}
      {can('sales', 'create') && <Link className="btn btn-sm btn-primary" href="/sales/new"><Icon name="plus" size={15} />{t('Sale')}</Link>}
    </header>
  );
}
