'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { money, date } from '@/lib/format';
import { fiscalYearLabel } from '@/lib/shared/ethiopian';
import MonthlyChart from '@/components/MonthlyChart';
import { PageHeader, Card, Stat, Badge, Loading, Empty, PeriodFilter, useFetch, useCurrentFy } from '@/components/ui';
import { useSession } from '@/components/session';
import Icon from '@/components/icons';
import { canOpenPage } from '@/lib/permissions';

const START = [
  { href: '/sales/new', label: 'New sale', icon: 'sales', page: '/sales/new' },
  { href: '/purchases/new', label: 'New purchase', icon: 'purchases', page: '/purchases/new' },
  { href: '/sales', label: 'Sales', icon: 'sales' },
  { href: '/purchases', label: 'Purchases', icon: 'purchases' },
  { href: '/credit', label: 'Credit & payments', icon: 'credit' },
  { href: '/withholding', label: 'Withholding', icon: 'withholding' },
  { href: '/reconciliation', label: 'Bank reconciliation', icon: 'bank' },
  { href: '/inventory', label: 'Inventory', icon: 'inventory' },
  { href: '/vat', label: 'VAT declaration', icon: 'vat' },
  { href: '/parties', label: 'Supplier list', icon: 'suppliers' },
  { href: '/products', label: 'Product list', icon: 'products' },
];

function StartPage({ user }) {
  const links = START.filter((l) => canOpenPage(user, l.page || l.href));
  return (
    <>
      <PageHeader title={`Welcome, ${user.full_name}`} subtitle={`Signed in as ${user.role_label}`} />
      <Card title="Your work">
        {!links.length ? <Empty>Your role does not include any pages yet. Ask an administrator to update it.</Empty> : (
          <div className="start-grid">
            {links.map((l) => (
              <Link key={l.href} href={l.href} className="start-tile"><span className="start-icon"><Icon name={l.icon} size={20} /></span>{l.label}</Link>
            ))}
          </div>
        )}
      </Card>
    </>
  );
}


export default function Dashboard() {
  const { user, can } = useSession();
  const currentFy = useCurrentFy();
  const [fy, setFy] = useState(null);
  const [denied, setDenied] = useState('');
  useEffect(() => { if (currentFy && !fy) setFy(currentFy); }, [currentFy, fy]);
  useEffect(() => { setDenied(new URLSearchParams(window.location.search).get('denied') || ''); }, []);
  const showFigures = can('reports', 'view');
  const { data: d, error } = useFetch(fy && showFigures ? `/dashboard?fy=${fy}` : null);

  const notice = denied && (
    <div className="alert alert-warn">Your role does not give access to <b>{denied}</b>. Ask an administrator if you need it.</div>
  );
  if (!user) return <Loading />;
  if (!showFigures) return <>{notice}<StartPage user={user} /></>;

  return (
    <>
      {notice}
      <PageHeader title="Dashboard" subtitle={fy ? fiscalYearLabel(fy) : ''}>
        <PeriodFilter fy={fy} showMonth={false} onChange={(p) => setFy(p.fy)} />
      </PageHeader>

      {!d ? <Loading error={error} /> : (
        <>
          <div className="grid grid-4">
            <Stat icon="sales" accent="blue" href="/sales" label="Sales (before VAT)" value={`ETB ${money(d.totals.sales)}`} sub={`${d.totals.salesCount} invoices · VAT ${money(d.totals.salesVat)}`} />
            <Stat icon="purchases" accent="orange" href="/purchases" label="Purchases (before VAT)" value={`ETB ${money(d.totals.purchases)}`} sub={`${d.totals.purchaseCount} receipts · Input VAT ${money(d.totals.purchaseVat)}`} />
            <Stat icon="vat" accent="violet" href="/vat" label="Net VAT payable" value={`ETB ${money(d.totals.vatPayable)}`} sub={`Credit carried forward ${money(d.totals.creditCarried)}`} tone={d.totals.vatPayable > 0 ? 'bad' : undefined} />
            <Stat icon="inventory" accent="teal" href="/inventory" label="Stock value" value={`ETB ${money(d.stock.value)}`} sub={`${d.stock.items} tracked items · ${d.stock.low.length} need reorder`} />
          </div>

          <div className="grid grid-3 mt">
            <Stat icon="wallet" accent="amber" href="/credit?tab=P" label="Payables (credit purchases)" value={`ETB ${money(d.payables.amount)}`} sub={`${d.payables.count} open invoices`} />
            <Stat icon="coins" accent="green" href="/credit?tab=S" label="Receivables (credit sales)" value={`ETB ${money(d.receivables.amount)}`} sub={`${d.receivables.count} open invoices`} />
            <Stat icon="withholding" accent="red" href="/withholding" label="Withholding to pay" value={`ETB ${money(d.whPending.amount)}`} tone={d.whPending.amount > 0 ? 'bad' : undefined} sub={`${d.whPending.count} purchases with outstanding WH`} />
          </div>

          <Card className="mt" title="Sales vs purchases by month (taxable amount)">
            <MonthlyChart
              labels={d.months}
              series={[
                { name: 'Sales', color: 'var(--series-1)', values: d.series.S },
                { name: 'Purchases', color: 'var(--series-2)', values: d.series.P },
              ]}
            />
            <p className="small muted" style={{ marginBottom: 0 }}>Full monthly figures are in the <Link href="/vat">VAT declaration</Link>.</p>
          </Card>

          <div className="grid grid-3 mt">
            <Card title="Needs attention">
              <ul className="list-plain">
                <li><span>Purchases not yet reported</span><Link href="/purchases"><Badge tone={d.unreported.P ? 'warn' : 'good'}>{d.unreported.P || 0}</Badge></Link></li>
                <li><span>Sales not yet reported</span><Link href="/sales"><Badge tone={d.unreported.S ? 'warn' : 'good'}>{d.unreported.S || 0}</Badge></Link></li>
                <li><span>Items at / below minimum stock</span><Link href="/inventory"><Badge tone={d.stock.low.length ? 'bad' : 'good'}>{d.stock.low.length}</Badge></Link></li>
              </ul>
              {d.stock.low.length > 0 && (
                <table className="mt">
                  <thead><tr><th>Item</th><th className="num">Stock</th><th className="num">Min</th></tr></thead>
                  <tbody>
                    {d.stock.low.slice(0, 6).map((s) => (
                      <tr key={s.code}><td className="wrap">{s.name}</td><td className="num">{s.current}</td><td className="num">{s.min}</td></tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
            <Card title="Top suppliers">
              {!d.topSuppliers.length ? <Empty>No purchases yet</Empty> : (
                <ul className="list-plain">
                  {d.topSuppliers.map((s) => <li key={s.name}><span>{s.name} <span className="muted small">({s.n})</span></span><span>{money(s.amount)}</span></li>)}
                </ul>
              )}
            </Card>
            <Card title="Top customers">
              {!d.topCustomers.length ? <Empty>No sales yet</Empty> : (
                <ul className="list-plain">
                  {d.topCustomers.map((s) => <li key={s.name}><span>{s.name} <span className="muted small">({s.n})</span></span><span>{money(s.amount)}</span></li>)}
                </ul>
              )}
            </Card>
          </div>

          <Card className="mt" title="Recently recorded" bodyClass="">
            {!d.recent.length ? <Empty>Nothing recorded yet. Start with <Link href="/purchases/new">a purchase</Link>.</Empty> : (
              <table>
                <thead><tr><th>ID</th><th>Type</th><th>Date</th><th>Party</th><th>Payment</th><th className="num">Total</th></tr></thead>
                <tbody>
                  {d.recent.map((r) => {
                    const href = `/${r.kind === 'S' ? 'sales' : 'purchases'}/${r.id}`;
                    return (
                      <tr key={r.id}>
                        <td><Link href={href}>{r.invoice_no}</Link></td>
                        <td>{r.kind === 'S' ? 'Sale' : 'Purchase'}</td>
                        <td>{date(r.date)}</td>
                        <td>{r.party_name || '—'}</td>
                        <td><Badge>{r.payment_type}</Badge></td>
                        <td className="num">{money(r.grand_total)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </Card>
        </>
      )}
    </>
  );
}
