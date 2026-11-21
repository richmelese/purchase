'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { money, date } from '@/lib/format';
import { fiscalYearLabel } from '@/lib/shared/ethiopian';
import MonthlyChart from '@/components/MonthlyChart';
import { PageHeader, Card, Stat, Badge, Loading, Empty, PeriodFilter, useFetch, useCurrentFy } from '@/components/ui';
import { useSession } from '@/components/session';
import Icon from '@/components/icons';
import { canOpenPage, type AppUser } from '@/lib/permissions';
import { useT } from '@/lib/i18n';

interface StockLowItem {
  code: string;
  name: string;
  current: number;
  min: number;
}

interface DashboardTotals {
  sales: number;
  salesCount: number;
  salesVat: number;
  purchases: number;
  purchaseCount: number;
  purchaseVat: number;
  vatPayable: number;
  creditCarried: number;
}

interface DashboardStock {
  value: number;
  items: number;
  low: StockLowItem[];
}

interface DashboardAmountCount {
  amount: number;
  count: number;
}

interface TopParty {
  name: string;
  n: number;
  amount: number;
}

interface RecentRecord {
  id: number;
  kind: 'S' | 'P';
  invoice_no: string;
  date: string;
  party_name: string | null;
  payment_type: string;
  grand_total: number;
}

interface DashboardData {
  totals: DashboardTotals;
  stock: DashboardStock;
  payables: DashboardAmountCount;
  receivables: DashboardAmountCount;
  whPending: DashboardAmountCount;
  months: string[];
  series: { S: number[]; P: number[] };
  unreported: { P?: number; S?: number };
  topSuppliers: TopParty[];
  topCustomers: TopParty[];
  recent: RecentRecord[];
}

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
  { href: '/parties', label: 'Customer list', icon: 'suppliers' },
  { href: '/products', label: 'Product list', icon: 'products' },
];

function StartPage({ user }: { user: AppUser }) {
  const { t } = useT();
  const links = START.filter((l) => canOpenPage(user, l.page || l.href));
  return (
    <>
      <PageHeader title={t('Welcome, {name}', { name: user.full_name })} subtitle={t('Signed in as {role}', { role: t(String(user.role_label || '')) })} />
      <Card title={t('Your work')}>
        {!links.length ? <Empty>{t('Your role does not include any pages yet. Ask an administrator to update it.')}</Empty> : (
          <div className="start-grid">
            {links.map((l) => (
              <Link key={l.href} href={l.href} className="start-tile"><span className="start-icon"><Icon name={l.icon} size={20} /></span>{t(l.label)}</Link>
            ))}
          </div>
        )}
      </Card>
    </>
  );
}


export default function Dashboard() {
  const { user, can } = useSession();
  const { t } = useT();
  const currentFy = useCurrentFy();
  const [fy, setFy] = useState<number | null>(null);
  const [denied, setDenied] = useState('');
  useEffect(() => { if (currentFy && !fy) setFy(currentFy); }, [currentFy, fy]);
  useEffect(() => { setDenied(new URLSearchParams(window.location.search).get('denied') || ''); }, []);
  const showFigures = can('reports', 'view');
  const { data: d, error } = useFetch<DashboardData>(fy && showFigures ? `/dashboard?fy=${fy}` : null);

  const notice = denied && (
    <div className="alert alert-warn">{t('Your role does not give access to')} <b>{denied}</b>. {t('Ask an administrator if you need it.')}</div>
  );
  if (!user) return <Loading />;
  if (!showFigures) return <>{notice}<StartPage user={user} /></>;

  return (
    <>
      {notice}
      <PageHeader title={t('Dashboard')} subtitle={fy ? fiscalYearLabel(fy).replace(/^FY/, t('FY')).replace(/E\.C\.$/, t('E.C.')) : ''}>
        <PeriodFilter fy={fy} month="" showMonth={false} onChange={(p) => setFy(p.fy)} />
      </PageHeader>

      {!d ? <Loading error={error} /> : (
        <>
          <div className="grid grid-4">
            <Stat icon="sales" accent="blue" href="/sales" label={t('Sales (before VAT)')} value={`ETB ${money(d.totals.sales)}`} sub={t('{n} invoices · VAT {vat}', { n: d.totals.salesCount, vat: money(d.totals.salesVat) })} />
            <Stat icon="purchases" accent="orange" href="/purchases" label={t('Purchases (before VAT)')} value={`ETB ${money(d.totals.purchases)}`} sub={t('{n} receipts · Input VAT {vat}', { n: d.totals.purchaseCount, vat: money(d.totals.purchaseVat) })} />
            <Stat icon="vat" accent="violet" href="/vat" label={t('Net VAT payable')} value={`ETB ${money(d.totals.vatPayable)}`} sub={t('Credit carried forward {amount}', { amount: money(d.totals.creditCarried) })} tone={d.totals.vatPayable > 0 ? 'bad' : undefined} />
            <Stat icon="inventory" accent="teal" href="/inventory" label={t('Stock value')} value={`ETB ${money(d.stock.value)}`} sub={t('{items} tracked items · {low} need reorder', { items: d.stock.items, low: d.stock.low.length })} />
          </div>

          <div className="grid grid-3 mt">
            <Stat icon="wallet" accent="amber" href="/credit?tab=P" label={t('Payables (credit purchases)')} value={`ETB ${money(d.payables.amount)}`} sub={t('{n} open invoices', { n: d.payables.count })} />
            <Stat icon="coins" accent="green" href="/credit?tab=S" label={t('Receivables (credit sales)')} value={`ETB ${money(d.receivables.amount)}`} sub={t('{n} open invoices', { n: d.receivables.count })} />
            <Stat icon="withholding" accent="red" href="/withholding" label={t('Withholding to pay')} value={`ETB ${money(d.whPending.amount)}`} tone={d.whPending.amount > 0 ? 'bad' : undefined} sub={t('{n} purchases with outstanding WH', { n: d.whPending.count })} />
          </div>

          <Card className="mt" title={t('Sales vs purchases by month (taxable amount)')}>
            <MonthlyChart
              labels={d.months}
              series={[
                { name: t('Sales'), color: 'var(--series-1)', values: d.series.S },
                { name: t('Purchases'), color: 'var(--series-2)', values: d.series.P },
              ]}
            />
            <p className="small muted" style={{ marginBottom: 0 }}>{t('Full monthly figures are in the')} <Link href="/vat">{t('VAT declaration')}</Link>.</p>
          </Card>

          <div className="grid grid-3 mt">
            <Card title={t('Needs attention')}>
              <ul className="list-plain">
                <li><span>{t('Purchases not yet reported')}</span><Link href="/purchases"><Badge tone={d.unreported.P ? 'warn' : 'good'}>{d.unreported.P || 0}</Badge></Link></li>
                <li><span>{t('Sales not yet reported')}</span><Link href="/sales"><Badge tone={d.unreported.S ? 'warn' : 'good'}>{d.unreported.S || 0}</Badge></Link></li>
                <li><span>{t('Items at / below minimum stock')}</span><Link href="/inventory"><Badge tone={d.stock.low.length ? 'bad' : 'good'}>{d.stock.low.length}</Badge></Link></li>
              </ul>
              {d.stock.low.length > 0 && (
                <table className="mt">
                  <thead><tr><th>{t('Item')}</th><th className="num">{t('Stock')}</th><th className="num">{t('Min')}</th></tr></thead>
                  <tbody>
                    {d.stock.low.slice(0, 6).map((s) => (
                      <tr key={s.code}><td className="wrap">{s.name}</td><td className="num">{s.current}</td><td className="num">{s.min}</td></tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
            <Card title={t('Top suppliers')}>
              {!d.topSuppliers.length ? <Empty>{t('No purchases yet')}</Empty> : (
                <ul className="list-plain">
                  {d.topSuppliers.map((s) => <li key={s.name}><span>{s.name} <span className="muted small">({s.n})</span></span><span>{money(s.amount)}</span></li>)}
                </ul>
              )}
            </Card>
            <Card title={t('Top customers')}>
              {!d.topCustomers.length ? <Empty>{t('No sales yet')}</Empty> : (
                <ul className="list-plain">
                  {d.topCustomers.map((s) => <li key={s.name}><span>{s.name} <span className="muted small">({s.n})</span></span><span>{money(s.amount)}</span></li>)}
                </ul>
              )}
            </Card>
          </div>

          <Card className="mt" title={t('Recently recorded')} bodyClass="">
            {!d.recent.length ? <Empty>{t('Nothing recorded yet. Start with')} <Link href="/purchases/new">{t('a purchase')}</Link>.</Empty> : (
              <table>
                <thead><tr><th>{t('ID')}</th><th>{t('Type')}</th><th>{t('Date')}</th><th>{t('Party')}</th><th>{t('Payment')}</th><th className="num">{t('Total')}</th></tr></thead>
                <tbody>
                  {d.recent.map((r) => {
                    const href = `/${r.kind === 'S' ? 'sales' : 'purchases'}/${r.id}`;
                    return (
                      <tr key={r.id}>
                        <td><Link href={href}>{r.invoice_no}</Link></td>
                        <td>{r.kind === 'S' ? t('Sale') : t('Purchase')}</td>
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
