'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { qs } from '@/lib/api';
import { money, qty } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { PageHeader, Card, Loading, Empty, PeriodFilter, Badge, useFetch, useCurrentFy, type PeriodValue } from '@/components/ui';
import { useSession } from '@/components/session';

interface Period {
  fy: number | null;
  month: number | '';
}

// Labels stay English here (they are also dictionary keys); translate at render with t().
const TABS = [
  { id: 'monthly', label: 'Monthly summary', export: 'monthly' },
  { id: 'products', label: 'Sales by product & profit', export: 'products' },
  { id: 'suppliers', label: 'Purchases by supplier', export: 'suppliers' },
  { id: 'customers', label: 'Sales by customer', export: 'customers' },
  { id: 'unreported', label: 'Unreported / Incomplete', export: null as string | null },
];

const pct = (v: number | null | undefined) => (v == null ? '—' : `${v.toFixed(1)}%`);
const signed = (v: number) => <span style={v < 0 ? { color: 'var(--good)' } : v > 0 ? { color: 'var(--bad)' } : undefined}>{money(v)}</span>;

type MonthlyMetricKey = 'sales' | 'output_vat' | 'purchases' | 'input_vat' | 'net_vat' | 'wh_on_purchases' | 'wh_on_sales';

interface MonthlyRow extends Record<MonthlyMetricKey, number> {
  month: string;
  sales_count: number;
  purchase_count: number;
}

interface MonthlyTotals extends Record<MonthlyMetricKey, number> {
  sales_count: number;
  purchase_count: number;
}

interface MonthlyData {
  rows: MonthlyRow[];
  total: MonthlyTotals;
}

function Monthly({ fy }: { fy: number | null }) {
  const { t } = useT();
  const { data, error } = useFetch<MonthlyData>(`/reports/monthly?fy=${fy}`);
  if (!data) return <Loading error={error} />;
  const cols: [MonthlyMetricKey, string][] = [
    ['sales', 'Sales (taxable)'], ['output_vat', 'Output VAT'], ['purchases', 'Purchases (taxable)'], ['input_vat', 'Input VAT'],
    ['net_vat', 'Net VAT'], ['wh_on_purchases', 'WH on purchases'], ['wh_on_sales', 'WH on sales'],
  ];
  return (
    <div className="table-wrap">
      <table>
        <thead><tr><th>{t('Month')}</th>{cols.map(([k, l]) => <th key={k} className="num">{t(l)}</th>)}<th className="num">{t('Sales inv.')}</th><th className="num">{t('Purchase rec.')}</th></tr></thead>
        <tbody>
          {data.rows.map((r) => (
            <tr key={r.month}>
              <td>{t(r.month)}</td>
              {cols.map(([k]) => <td key={k} className="num">{k === 'net_vat' ? signed(r[k]) : r[k] ? money(r[k]) : <span className="muted">–</span>}</td>)}
              <td className="num">{r.sales_count || ''}</td><td className="num">{r.purchase_count || ''}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr><td>{t('Total')}</td>{cols.map(([k]) => <td key={k} className="num">{k === 'net_vat' ? signed(data.total[k]) : money(data.total[k])}</td>)}<td className="num">{data.total.sales_count}</td><td className="num">{data.total.purchase_count}</td></tr>
        </tfoot>
      </table>
      <p className="small muted" style={{ padding: '0 16px' }}>
        {t('Net VAT = output VAT − input VAT (red = payable, green = credit). The official return with adjustments is on the VAT declaration page.')}{' '}
        <Link href="/vat">{t('Open VAT declaration →')}</Link>
      </p>
    </div>
  );
}

interface ProductRow {
  code: string | null;
  name: string;
  qty: number;
  sales: number;
  vat: number;
  cost: number | null;
  profit: number | null;
  unit_cost: number | null;
  margin: number | null;
}

function Products({ period }: { period: Period }) {
  const { t } = useT();
  const { data, error } = useFetch<ProductRow[]>(`/reports/products${qs(period)}`);
  if (!data) return <Loading error={error} />;
  if (!data.length) return <Empty>{t('No sales in this period.')}</Empty>;
  const tot = data.reduce((a, r) => ({ sales: a.sales + r.sales, vat: a.vat + r.vat, cost: a.cost + (r.cost || 0), profit: a.profit + (r.profit || 0) }), { sales: 0, vat: 0, cost: 0, profit: 0 });
  return (
    <div className="table-wrap">
      <table>
        <thead><tr><th>{t('Code')}</th><th>{t('Product')}</th><th className="num">{t('Qty sold')}</th><th className="num">{t('Sales (before VAT)')}</th><th className="num">{t('VAT')}</th><th className="num">{t('Avg unit cost')}</th><th className="num">{t('Cost of sales')}</th><th className="num">{t('Gross profit')}</th><th className="num">{t('Margin')}</th></tr></thead>
        <tbody>
          {data.map((r) => (
            <tr key={`${r.code}-${r.name}`}>
              <td>{r.code}</td><td className="wrap">{r.name}</td><td className="num">{qty(r.qty)}</td>
              <td className="num">{money(r.sales)}</td><td className="num">{money(r.vat)}</td>
              <td className="num">{r.unit_cost == null ? <span className="muted">{t('no cost')}</span> : money(r.unit_cost)}</td>
              <td className="num">{r.cost == null ? '—' : money(r.cost)}</td>
              <td className="num" style={r.profit != null && r.profit < 0 ? { color: 'var(--bad)' } : undefined}><strong>{r.profit == null ? '—' : money(r.profit)}</strong></td>
              <td className="num">{pct(r.margin)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr><td colSpan={3}>{t('{n} products', { n: data.length })}</td><td className="num">{money(tot.sales)}</td><td className="num">{money(tot.vat)}</td><td /><td className="num">{money(tot.cost)}</td><td className="num">{money(tot.profit)}</td><td className="num">{tot.sales ? pct((tot.profit / tot.sales) * 100) : '—'}</td></tr>
        </tfoot>
      </table>
      <p className="small muted" style={{ padding: '0 16px' }}>{t('Cost uses the average purchase cost of each product (or its purchase price when it has never been bought). Lines without a product code have no cost.')}</p>
    </div>
  );
}

interface PartyRow {
  party_id: number | null;
  name: string;
  tin: string | null;
  count: number;
  taxable: number;
  vat: number;
  total: number;
  wh: number;
  balance: number;
}

function Parties({ kind, period }: { kind: 'P' | 'S'; period: Period }) {
  const { t } = useT();
  const { data, error } = useFetch<PartyRow[]>(`/reports/parties/${kind === 'P' ? 'purchases' : 'sales'}${qs(period)}`);
  if (!data) return <Loading error={error} />;
  if (!data.length) return <Empty>{kind === 'P' ? t('No purchases in this period.') : t('No sales in this period.')}</Empty>;
  const sum = (k: keyof PartyRow) => data.reduce((a, r) => a + (r[k] as number), 0);
  return (
    <div className="table-wrap">
      <table>
        <thead><tr><th>{kind === 'P' ? t('Supplier') : t('Customer')}</th><th>{t('TIN')}</th><th className="num">{kind === 'P' ? t('Receipts') : t('Invoices')}</th><th className="num">{t('Taxable')}</th><th className="num">{t('VAT')}</th><th className="num">{t('Total after VAT')}</th><th className="num">{t('Withholding')}</th><th className="num">{t('Outstanding')}</th><th className="num">{t('Share')}</th></tr></thead>
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
          <tr><td colSpan={2}>{t('{n} companies', { n: data.length })}</td><td className="num">{sum('count')}</td><td className="num">{money(sum('taxable'))}</td><td className="num">{money(sum('vat'))}</td><td className="num">{money(sum('total'))}</td><td className="num">{money(sum('wh'))}</td><td className="num">{money(sum('balance'))}</td><td /></tr>
        </tfoot>
      </table>
    </div>
  );
}

const MISSING_FIELD_LABEL: Record<string, string> = {
  party_tin: 'TIN', party_name: 'Party name', vat_receipt_no: 'VAT receipt no.', mrc_number: 'MRC number',
};

interface UnreportedRow {
  id: number;
  invoice_no: string;
  date: string;
  party_name: string | null;
  party_tin: string | null;
  report_status: string;
  missing_fields: string[] | null;
}

function Unreported({ period }: { period: Period }) {
  const { t } = useT();
  const [kind, setKind] = useState<'P' | 'S'>('P');
  const { data, error } = useFetch<UnreportedRow[]>(`/reports/unreported${qs({ kind, fy: period.fy, month: period.month })}`);
  return (
    <>
      <div className="row" style={{ padding: '12px 16px 0' }}>
        <div className="tabs" style={{ marginBottom: 0 }}>
          <button className={`tab ${kind === 'P' ? 'active' : ''}`} onClick={() => setKind('P')}>{t('Purchases')}</button>
          <button className={`tab ${kind === 'S' ? 'active' : ''}`} onClick={() => setKind('S')}>{t('Sales')}</button>
        </div>
      </div>
      {!data ? <Loading error={error} /> : !data.length ? <Empty>{t('Nothing unreported or incomplete in this period.')}</Empty> : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>{t('Invoice #')}</th><th>{t('Date')}</th><th>{kind === 'P' ? t('Supplier') : t('Customer')}</th><th>{t('TIN')}</th><th>{t('Status')}</th><th>{t('Missing fields')}</th></tr>
            </thead>
            <tbody>
              {data.map((r) => (
                <tr key={r.id}>
                  <td><Link href={`/${kind === 'P' ? 'purchases' : 'sales'}/${r.id}`}>{r.invoice_no}</Link></td>
                  <td>{r.date}</td>
                  <td className="wrap">{r.party_name || <span className="muted">—</span>}</td>
                  <td>{r.party_tin || <span className="muted">—</span>}</td>
                  <td><Badge tone={r.report_status === 'Not Reported' ? 'bad' : 'good'}>{t(r.report_status)}</Badge></td>
                  <td className="wrap">
                    {!r.missing_fields || !r.missing_fields.length
                      ? <span className="muted">—</span>
                      : r.missing_fields.map((f) => <span key={f} className="badge badge-warn" style={{ marginRight: 4 }}>{t(MISSING_FIELD_LABEL[f] || f)}</span>)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function Reports() {
  const { can } = useSession();
  const { t } = useT();
  const params = useSearchParams();
  const router = useRouter();
  const currentFy = useCurrentFy();
  const [period, setPeriod] = useState<Period>({ fy: null, month: '' });
  useEffect(() => { if (currentFy && !period.fy) setPeriod((p) => ({ ...p, fy: currentFy })); }, [currentFy, period.fy]);
  const tab = TABS.find((x) => x.id === params.get('tab')) || TABS[0];
  const fyLabel = period.fy ? t('FY {from}/{to} E.C.', { from: period.fy - 1, to: String(period.fy).slice(-2) }) : '';

  return (
    <>
      <PageHeader title={t('Reports')} subtitle={fyLabel}>
        <PeriodFilter fy={period.fy} month={period.month} onChange={(p: PeriodValue) => setPeriod(p)} showMonth={tab.id !== 'monthly'} />
        <button className="btn" onClick={() => window.print()}>{t('Print')}</button>
        {tab.export && can('reports', 'export') && <a className="btn" href={`/api/export/report/${tab.export}${qs(period)}`}>{t('Export Excel')}</a>}
      </PageHeader>
      <div className="tabs">
        {TABS.map((x) => (
          <button key={x.id} className={`tab ${tab.id === x.id ? 'active' : ''}`} onClick={() => router.replace(`/reports?tab=${x.id}`)}>{t(x.label)}</button>
        ))}
      </div>
      <Card fill bodyClass="">
        {!period.fy ? <Loading /> : (
          <>
            {tab.id === 'monthly' && <Monthly fy={period.fy} />}
            {tab.id === 'products' && <Products period={period} />}
            {tab.id === 'suppliers' && <Parties kind="P" period={period} />}
            {tab.id === 'customers' && <Parties kind="S" period={period} />}
            {tab.id === 'unreported' && <Unreported period={period} />}
          </>
        )}
      </Card>
    </>
  );
}

export default function ReportsPage() {
  return <Suspense fallback={<Loading />}><Reports /></Suspense>;
}
