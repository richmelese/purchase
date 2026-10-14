'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { formatEthiopian, taxPeriod } from '@/lib/shared/ethiopian';
import { today } from '@/lib/format';
import { useSession } from './session';
import Icon from './icons';

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

export default function Topbar() {
  const { user, can } = useSession();
  const [now, setNow] = useState(null);
  useEffect(() => { setNow({ iso: today(), hello: greeting() }); }, []);
  const g = now ? new Date(`${now.iso}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : '';
  const period = now ? taxPeriod(now.iso) : null;
  const first = user?.full_name?.split(/\s+/)[0];

  return (
    <header className="topbar no-print">
      <div>
        <div className="topbar-greeting">{now ? `${now.hello}${first ? `, ${first}` : ''}` : ' '}</div>
        <div className="topbar-date">
          <Icon name="calendar" size={14} />
          <span>{now ? formatEthiopian(now.iso) : ''} E.C.</span>
          <span className="dot" />
          <span>{g}</span>
          {period && <><span className="dot" /><span>Tax month: {period.month}</span></>}
        </div>
      </div>
      <div className="spacer" />
      {user && <span className="topbar-role" title="Your role decides which pages and actions you can use">{user.role_label}</span>}
      {can('purchases', 'create') && <Link className="btn btn-sm" href="/purchases/new"><Icon name="plus" size={15} />Purchase</Link>}
      {can('sales', 'create') && <Link className="btn btn-sm btn-primary" href="/sales/new"><Icon name="plus" size={15} />Sale</Link>}
    </header>
  );
}
