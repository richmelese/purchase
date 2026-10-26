'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { qs } from '@/lib/api';
import { money, qty } from '@/lib/format';
import { fiscalYearLabel } from '@/lib/shared/ethiopian';
import { PageHeader, Card, Loading, Empty, PeriodFilter, useFetch, useCurrentFy } from '@/components/ui';
import { useSession } from '@/components/session';

const TABS = [
  { id: 'monthly', label: 'Monthly summary', export: 'monthly' },
  { id: 'products', label: 'Sales by product & profit', export: 'products' },
  { id: 'suppliers', label: 'Purchases by supplier', export: 'suppliers' },
  { id: 'customers', label: 'Sales by customer', export: 'customers' },
];

const pct = (v) => (v == null ? '—' : `${v.toFixed(1)}%`);
const signed = (v) => <span style={v < 0 ? { color: 'var(--good)' } : v > 0 ? { color: 'var(--bad)' } : undefined}>{money(v)}</span>;

function Monthly({ fy }) {
  const { data, error } = useFetch(`/reports/monthly?fy=${fy}`);
  if (!data) return <Loading error={error} />;
  const cols = [
    ['sales', 'Sales (taxable)'], ['output_vat', 'Output VAT'], ['purchases', 'Purchases (taxable)'], ['input_vat', 'Input VAT'],
    ['net_vat', 'Net VAT'], ['wh_on_purchases', 'WH on purchases'], ['wh_on_sales', 'WH on sales'],
  ];
  return (
    <div className="table-wrap">
      <table>
        <thead><tr><th>Month</th>{cols.map(([k, l]) => <th key={k} className="num">{l}</th>)}<th className="num">Sales inv.</th><th className="num">Purchase rec.</th></tr></thead>
        <tbody>
          {data.rows.map((r) => (
            <tr key={r.month}>
              <td>{r.month}</td>
              {cols.map(([k]) => <td key={k} className="num">{k === 'net_vat' ? signed(r[k]) : r[k] ? money(r[k]) : <span className="muted">–</span>}</td>)}
              <td className="num">{r.sales_count || ''}</td><td className="num">{r.purchase_count || ''}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr><td>Total</td>{cols.map(([k]) => <td key={k} className="num">{k === 'net_vat' ? signed(data.total[k]) : money(data.total[k])}</td>)}<td className="num">{data.total.sales_count}</td><td className="num">{data.total.purchase_count}</td></tr>
        </tfoot>
      </table>
      <p className="small muted" style={{ padding: '0 16px' }}>Net VAT = output VAT − input VAT (red = payable, green = credit). The official return with adjustments is on the <Link href="/vat">VAT declaration</Link> page.</p>
    </div>
  );
}

function Products({ period }) {
  const { data, error } = useFetch(`/reports/products${qs(period)}`);
  if (!data) return <Loading error={error} />;
  if (!data.length) return <Empty>No sales in this period.</Empty>;
  const t = data.reduce((a, r) => ({ sales: a.sales + r.sales, vat: a.vat + r.vat, cost: a.cost + (r.cost || 0), profit: a.profit + (r.profit || 0) }), { sales: 0, vat: 0, cost: 0, profit: 0 });
  return (
    <div className="table-wrap">
      <table>
        <thead><tr><th>Code</th><th>Product</th><th className="num">Qty sold</th><th className="num">Sales (before VAT)</th><th className="num">VAT</th><th className="num">Avg unit cost</th><th className="num">Cost of sales</th><th className="num">Gross profit</th><th className="num">Margin</th></tr></thead>
        <tbody>
          {data.map((r) => (
            <tr key={`${r.code}-${r.name}`}>
              <td>{r.code}</td><td className="wrap">{r.name}</td><td className="num">{qty(r.qty)}</td>
              <td className="num">{money(r.sales)}</td><td className="num">{money(r.vat)}</td>
              <td className="num">{r.unit_cost == null ? <span className="muted">no cost</span> : money(r.unit_cost)}</td>
              <td className="num">{r.cost == null ? '—' : money(r.cost)}</td>
              <td className="num" style={r.profit < 0 ? { color: 'var(--bad)' } : undefined}><strong>{r.profit == null ? '—' : money(r.profit)}</strong></td>
              <td className="num">{pct(r.margin)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr><td colSpan={3}>{data.length} products</td><td className="num">{money(t.sales)}</td><td className="num">{money(t.vat)}</td><td /><td className="num">{money(t.cost)}</td><td className="num">{money(t.profit)}</td><td className="num">{t.sales ? pct((t.profit / t.sales) * 100) : '—'}</td></tr>
        </tfoot>
      </table>
      <p className="small muted" style={{ padding: '0 16px' }}>Cost uses the average purchase cost of each product (or its purchase price when it has never been bought). Lines without a product code have no cost.</p>
    </div>
  );
}

function Parties({ kind, period }) {
  const { data, error } = useFetch(`/reports/parties/${kind === 'P' ? 'purchases' : 'sales'}${qs(period)}`);
  if (!data) return <Loading error={error} />;
  if (!data.length) return <Empty>No {kind === 'P' ? 'purchases' : 'sales'} in this period.</Empty>;
  const sum = (k) => data.reduce((a, r) => a + r[k], 0);
  return (
    <div className="table-wrap">
      <table>
        <thead><tr><th>{kind === 'P' ? 'Supplier' : 'Customer'}</th><th>TIN</th><th className="num">{kind === 'P' ? 'Receipts' : 'Invoices'}</th><th className="num">Taxable</th><th className="num">VAT</th><th className="num">Total after VAT</th><th className="num">Withholding</th><th className="num">Outstanding</th><th className="num">Share</th></tr></thead>
        <tbody>
          {data.map((r) => (
            <tr key={`${r.party_id}-${r.name}`}>
              <td>{r.party_id ? <Link href={`/parties/${r.party_id}`}>{r.name}</Link> : r.name}</td>
              <td>{r.tin}</td><td className="num">{r.count}</td><td className="num">{money(r.taxable)}</td><td className="num">{money(r.vat)}</td>
              <td className="num"><strong>{money(r.total)}</strong></td><td className="num">{money(r.wh)}</td>
              <td className="num" style={r.balance > 0 ? { color: 'var(--bad)' } : undefined}>{money(r.balance)}</td>
              <td className="num">{pct((r.total / sum('total')) * 100)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr><td colSpan={2}>{data.length} companies</td><td className="num">{sum('count')}</td><td className="num">{money(sum('taxable'))}</td><td className="num">{money(sum('vat'))}</td><td className="num">{money(sum('total'))}</td><td className="num">{money(sum('wh'))}</td><td className="num">{money(sum('balance'))}</td><td /></tr>
        </tfoot>
      </table>
    </div>
  );
}

function Reports() {
  const { can } = useSession();
  const params = useSearchParams();
  const router = useRouter();
  const currentFy = useCurrentFy();
  const [period, setPeriod] = useState({ fy: null, month: '' });
  useEffect(() => { if (currentFy && !period.fy) setPeriod((p) => ({ ...p, fy: currentFy })); }, [currentFy, period.fy]);
  const tab = TABS.find((t) => t.id === params.get('tab')) || TABS[0];

  return (
    <>
      <PageHeader title="Reports" subtitle={period.fy ? `${fiscalYearLabel(period.fy)}` : ''}>
        <PeriodFilter fy={period.fy} month={period.month} onChange={setPeriod} showMonth={tab.id !== 'monthly'} />
        <button className="btn" onClick={() => window.print()}>Print</button>
        {can('reports', 'export') && <a className="btn" href={`/api/export/report/${tab.export}${qs(period)}`}>Export Excel</a>}
      </PageHeader>
      <div className="tabs">
        {TABS.map((t) => (
          <button key={t.id} className={`tab ${tab.id === t.id ? 'active' : ''}`} onClick={() => router.replace(`/reports?tab=${t.id}`)}>{t.label}</button>
        ))}
      </div>
      <Card fill bodyClass="">
        {!period.fy ? <Loading /> : (
          <>
            {tab.id === 'monthly' && <Monthly fy={period.fy} />}
            {tab.id === 'products' && <Products period={period} />}
            {tab.id === 'suppliers' && <Parties kind="P" period={period} />}
            {tab.id === 'customers' && <Parties kind="S" period={period} />}
          </>
        )}
      </Card>
    </>
  );
}

export default function ReportsPage() {
  return <Suspense fallback={<Loading />}><Reports /></Suspense>;
}
