'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useSession } from '@/components/session';
import { money, date } from '@/lib/format';
import { PageHeader, Card, Badge, Loading, Empty, useFetch } from '@/components/ui';

const BUCKETS = ['0–30', '31–60', '61–90', '90+'];

function Credit() {
  const { can } = useSession();
  const params = useSearchParams();
  const [kind, setKind] = useState(params.get('tab') === 'S' ? 'S' : 'P');
  const [all, setAll] = useState(false);
  const { data, error } = useFetch(`/credit/${kind === 'P' ? 'purchases' : 'sales'}${all ? '?all=1' : ''}`);
  const base = kind === 'P' ? '/purchases' : '/sales';
  const aging = BUCKETS.map((b) => (data || []).filter((r) => r.age_bucket === b).reduce((a, r) => a + r.balance, 0));

  // Balance per party
  const byParty = Object.values((data || []).reduce((acc, r) => {
    const key = r.party_tin || r.party_name || '—';
    acc[key] = acc[key] || { name: r.party_name || '—', tin: r.party_tin, balance: 0, n: 0 };
    acc[key].balance += r.balance;
    acc[key].n += 1;
    return acc;
  }, {})).filter((p) => p.balance > 0.004).sort((a, b) => b.balance - a.balance);

  return (
    <>
      <PageHeader title="Credit & payments" subtitle="Outstanding credit purchases (payables) and credit sales (receivables)">
        {can('credit', 'export') && <a className="btn" href="/api/export/credit">Export Excel</a>}
      </PageHeader>
      <div className="tabs">
        <button className={`tab ${kind === 'P' ? 'active' : ''}`} onClick={() => setKind('P')}>Payables – we owe</button>
        <button className={`tab ${kind === 'S' ? 'active' : ''}`} onClick={() => setKind('S')}>Receivables – owed to us</button>
      </div>

      <div className="grid grid-4">
        {BUCKETS.map((b, i) => (
          <div key={b} className="card stat">
            <div className="stat-label">{b} days</div>
            <div className="stat-value" style={i === 3 && aging[i] > 0 ? { color: 'var(--bad)' } : undefined}>{money(aging[i])}</div>
          </div>
        ))}
      </div>

      <div className="grid mt fill-row" style={{ gridTemplateColumns: 'minmax(0,2fr) minmax(0,1fr)' }}>
        <Card fill bodyClass="" title={kind === 'P' ? 'Credit purchases' : 'Credit sales'} actions={<label className="check small"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />Include settled</label>}>
          {!data ? <Loading error={error} /> : !data.length ? <Empty>No {all ? '' : 'open '}credit transactions.</Empty> : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>ID</th><th>Date</th><th>{kind === 'P' ? 'Seller' : 'Buyer'}</th><th className="num">Due</th><th className="num">Paid</th><th className="num">Balance</th><th>Age</th></tr></thead>
                <tbody>
                  {data.map((r) => (
                    <tr key={r.id}>
                      <td><Link href={`${base}/${r.id}`}>{r.invoice_no}</Link></td>
                      <td>{date(r.date)}</td>
                      <td>{r.party_name}</td>
                      <td className="num">{money(r.amount_due)}</td>
                      <td className="num">{money(r.amount_paid)}</td>
                      <td className="num"><strong>{money(r.balance)}</strong></td>
                      <td>{r.balance > 0.004 ? <Badge tone={r.age_days > 90 ? 'bad' : r.age_days > 30 ? 'warn' : undefined}>{r.age_days} days</Badge> : <Badge tone="good">Paid</Badge>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        <Card title={`Balance by ${kind === 'P' ? 'supplier' : 'customer'}`}>
          {!byParty.length ? <Empty>Nothing outstanding</Empty> : (
            <ul className="list-plain">
              {byParty.map((p) => <li key={p.tin || p.name}><span>{p.name} <span className="muted small">({p.n})</span></span><strong>{money(p.balance)}</strong></li>)}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}

export default function CreditPage() {
  return <Suspense fallback={<Loading />}><Credit /></Suspense>;
}
