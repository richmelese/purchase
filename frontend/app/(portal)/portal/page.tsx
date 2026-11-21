'use client';

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { Badge, Card, Empty, Loading, useFetch } from '@/components/ui';
import { usePortal } from '@/components/portal';
import { ProfileForm } from '@/components/CompanyProfile';
import { money, date } from '@/lib/format';
import { useT } from '@/lib/i18n';

interface PortalCompany {
  name: string;
  tin?: string | null;
  type?: string;
  mrc1?: string | null;
  mrc2?: string | null;
  mrc3?: string | null;
  profile?: any;
}

interface StatementTotals {
  purchased: number;
  purchaseCount: number;
  payable: number;
  whWithheld: number;
  sold: number;
  saleCount: number;
  receivable: number;
  whByCustomer: number;
}

interface StatementRow {
  date: string;
  type: string;
  invoice_id?: number | null;
  ref: string;
  detail?: string | null;
  charge?: number;
  payment?: number;
  balance: number;
}

interface StatementData {
  totals: StatementTotals;
  purchases: StatementRow[];
  sales: StatementRow[];
}

interface PortalInvoiceRow {
  id: number;
  invoice_no: string;
  date: string;
  receipt_type: string;
  vat_receipt_no: string | null;
  payment_type: string;
  grand_total: number;
  balance: number;
}

type PortalTab = 'statement' | 'P' | 'S' | 'profile';

const TABS: { id: PortalTab; label: string }[] = [
  { id: 'statement', label: 'Statement' },
  { id: 'P', label: 'Purchases from you' },
  { id: 'S', label: 'Sales to you' },
  { id: 'profile', label: 'Company profile' },
];

function PortalStat({ label, value, hint, tone }: { label: ReactNode; value: ReactNode; hint?: ReactNode; tone?: string }) {
  return (
    <div className={`card portal-stat ${tone || ''}`}>
      <div className="small muted">{label}</div>
      <div className="portal-stat-value">{value}</div>
      {hint && <div className="small muted">{hint}</div>}
    </div>
  );
}

function Ledger({ title, rows }: { title: string; rows: StatementRow[] }) {
  const { t } = useT();
  return (
    <Card title={title} bodyClass="">
      {!rows.length ? <Empty>{t('No transactions.')}</Empty> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>{t('Date')}</th><th>{t('Type')}</th><th>{t('Reference')}</th><th>{t('Detail')}</th><th className="num">{t('Amount')}</th><th className="num">{t('Paid')}</th><th className="num">{t('Balance')}</th></tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td>{date(r.date)}</td>
                  <td>{t(r.type)}</td>
                  <td>{r.invoice_id ? <Link href={`/portal/invoices/${r.invoice_id}`}>{r.ref}</Link> : r.ref}</td>
                  <td className="wrap small">{r.detail}</td>
                  <td className="num">{r.charge ? money(r.charge) : ''}</td>
                  <td className="num">{r.payment ? money(r.payment) : ''}</td>
                  <td className="num"><strong>{money(r.balance)}</strong></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function InvoiceTable({ kind }: { kind: 'P' | 'S' }) {
  const { t } = useT();
  const { data, error } = useFetch<PortalInvoiceRow[]>(`/portal/invoices?kind=${kind}`);
  if (!data) return <Loading error={error} />;
  return (
    <Card bodyClass="" title={kind === 'P' ? t('Purchases from you') : t('Sales to you')} actions={<span className="small muted">{t('{n} invoices', { n: data.length })}</span>}>
      {!data.length ? <Empty>{t('No invoices yet.')}</Empty> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>{t('No.')}</th><th>{t('Date')}</th><th>{t('Receipt')}</th><th>{t('Payment')}</th><th className="num">{t('Total')}</th><th className="num">{t('Balance')}</th><th /></tr></thead>
            <tbody>
              {data.map((inv) => (
                <tr key={inv.id}>
                  <td><Link href={`/portal/invoices/${inv.id}`}><strong>{inv.invoice_no}</strong></Link></td>
                  <td>{date(inv.date)}</td>
                  <td>{t(inv.receipt_type)} {inv.vat_receipt_no}</td>
                  <td><Badge>{inv.payment_type}</Badge></td>
                  <td className="num">{money(inv.grand_total)}</td>
                  <td className="num">{inv.payment_type === 'Credit' ? money(inv.balance) : '—'}</td>
                  <td className="right"><Link className="btn btn-sm btn-ghost" href={`/portal/invoices/${inv.id}`}>{t('View')}</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

export default function PortalHome() {
  const { company: rawCompany, options, issuer } = usePortal();
  const company = rawCompany as PortalCompany;
  const { data: st, error } = useFetch<StatementData>('/portal/statement');
  const [tab, setTab] = useState<PortalTab>('statement');
  const tot = st?.totals;
  const { t } = useT();

  return (
    <>
      <div className="card portal-hero">
        <div>
          <div className="small muted">{t('Your account with {company}', { company: issuer.company_name })}</div>
          <h1>{company.name}</h1>
          <div className="row small muted">
            {company.tin && <span>{t('TIN {tin}', { tin: company.tin })}</span>}
            <Badge>{company.type}</Badge>
            {company.mrc1 && <span>MRC {[company.mrc1, company.mrc2, company.mrc3].filter(Boolean).join(', ')}</span>}
          </div>
        </div>
        <button className="btn no-print" onClick={() => window.print()}>{t('Print')}</button>
      </div>

      {!tot ? <Loading error={error} /> : (
        <div className="grid grid-4 portal-stats">
          <PortalStat label={t('Purchases from you')} value={money(tot.purchased)} hint={tot.purchaseCount === 1 ? t('1 invoice') : t('{n} invoices', { n: tot.purchaseCount })} />
          <PortalStat label={t('Still to be paid to you')} value={money(tot.payable)} hint={tot.whWithheld ? t('Withholding deducted: {amount}', { amount: money(tot.whWithheld) }) : t('After withholding')} tone={tot.payable > 0 ? 'warn' : ''} />
          <PortalStat label={t('Sales to you')} value={money(tot.sold)} hint={tot.saleCount === 1 ? t('1 invoice') : t('{n} invoices', { n: tot.saleCount })} />
          <PortalStat label={t('You still owe')} value={money(tot.receivable)} hint={tot.whByCustomer ? t('Withholding you deducted: {amount}', { amount: money(tot.whByCustomer) }) : t('After withholding')} tone={tot.receivable > 0 ? 'warn' : ''} />
        </div>
      )}

      <div className="tabs no-print">
        {TABS.map((x) => <button key={x.id} className={`tab ${tab === x.id ? 'active' : ''}`} onClick={() => setTab(x.id)}>{t(x.label)}</button>)}
      </div>

      {tab === 'statement' && st && (
        <>
          {(st.purchases.length > 0 || !st.sales.length) && <Ledger title={t('Purchases from you – payments to you')} rows={st.purchases} />}
          {st.sales.length > 0 && <Ledger title={t('Sales to you – your payments')} rows={st.sales} />}
        </>
      )}
      {(tab === 'P' || tab === 'S') && <InvoiceTable kind={tab} />}
      {tab === 'profile' && (
        <>
          <p className="small muted">{t('Registration details held by {company}. Contact them to correct anything.', { company: issuer.company_name })}</p>
          <ProfileForm value={company.profile} onChange={() => {}} options={options} canEdit={false} partyMode />
        </>
      )}
    </>
  );
}
