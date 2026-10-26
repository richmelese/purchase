'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Badge, Card, Empty, Loading, useFetch } from '@/components/ui';
import { usePortal } from '@/components/portal';
import { ProfileForm } from '@/components/CompanyProfile';
import { money, date } from '@/lib/format';

const TABS = [
  { id: 'statement', label: 'Statement' },
  { id: 'P', label: 'Purchases from you' },
  { id: 'S', label: 'Sales to you' },
  { id: 'profile', label: 'Company profile' },
];

function Stat({ label, value, hint, tone }) {
  return (
    <div className={`card portal-stat ${tone || ''}`}>
      <div className="small muted">{label}</div>
      <div className="portal-stat-value">{value}</div>
      {hint && <div className="small muted">{hint}</div>}
    </div>
  );
}

function Ledger({ title, rows }) {
  return (
    <Card title={title} bodyClass="">
      {!rows.length ? <Empty>No transactions.</Empty> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Date</th><th>Type</th><th>Reference</th><th>Detail</th><th className="num">Amount</th><th className="num">Paid</th><th className="num">Balance</th></tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td>{date(r.date)}</td>
                  <td>{r.type}</td>
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

function InvoiceTable({ kind }) {
  const { data, error } = useFetch(`/portal/invoices?kind=${kind}`);
  if (!data) return <Loading error={error} />;
  return (
    <Card bodyClass="" title={kind === 'P' ? 'Purchases from you' : 'Sales to you'} actions={<span className="small muted">{data.length} invoices</span>}>
      {!data.length ? <Empty>No invoices yet.</Empty> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>No.</th><th>Date</th><th>Receipt</th><th>Payment</th><th className="num">Total</th><th className="num">Balance</th><th /></tr></thead>
            <tbody>
              {data.map((inv) => (
                <tr key={inv.id}>
                  <td><Link href={`/portal/invoices/${inv.id}`}><strong>{inv.invoice_no}</strong></Link></td>
                  <td>{date(inv.date)}</td>
                  <td>{inv.receipt_type} {inv.vat_receipt_no}</td>
                  <td><Badge>{inv.payment_type}</Badge></td>
                  <td className="num">{money(inv.grand_total)}</td>
                  <td className="num">{inv.payment_type === 'Credit' ? money(inv.balance) : '—'}</td>
                  <td className="right"><Link className="btn btn-sm btn-ghost" href={`/portal/invoices/${inv.id}`}>View</Link></td>
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
  const { company, options, issuer } = usePortal();
  const { data: st, error } = useFetch('/portal/statement');
  const [tab, setTab] = useState('statement');
  const t = st?.totals;

  return (
    <>
      <div className="card portal-hero">
        <div>
          <div className="small muted">Your account with {issuer.company_name}</div>
          <h1>{company.name}</h1>
          <div className="row small muted">
            {company.tin && <span>TIN {company.tin}</span>}
            <Badge>{company.type}</Badge>
            {company.mrc1 && <span>MRC {[company.mrc1, company.mrc2, company.mrc3].filter(Boolean).join(', ')}</span>}
          </div>
        </div>
        <button className="btn no-print" onClick={() => window.print()}>Print</button>
      </div>

      {!t ? <Loading error={error} /> : (
        <div className="grid grid-4 portal-stats">
          <Stat label="Purchases from you" value={money(t.purchased)} hint={`${t.purchaseCount} invoice${t.purchaseCount === 1 ? '' : 's'}`} />
          <Stat label="Still to be paid to you" value={money(t.payable)} hint={t.whWithheld ? `Withholding deducted: ${money(t.whWithheld)}` : 'After withholding'} tone={t.payable > 0 ? 'warn' : ''} />
          <Stat label="Sales to you" value={money(t.sold)} hint={`${t.saleCount} invoice${t.saleCount === 1 ? '' : 's'}`} />
          <Stat label="You still owe" value={money(t.receivable)} hint={t.whByCustomer ? `Withholding you deducted: ${money(t.whByCustomer)}` : 'After withholding'} tone={t.receivable > 0 ? 'warn' : ''} />
        </div>
      )}

      <div className="tabs no-print">
        {TABS.map((x) => <button key={x.id} className={`tab ${tab === x.id ? 'active' : ''}`} onClick={() => setTab(x.id)}>{x.label}</button>)}
      </div>

      {tab === 'statement' && st && (
        <>
          {(st.purchases.length > 0 || !st.sales.length) && <Ledger title="Purchases from you – payments to you" rows={st.purchases} />}
          {st.sales.length > 0 && <Ledger title="Sales to you – your payments" rows={st.sales} />}
        </>
      )}
      {(tab === 'P' || tab === 'S') && <InvoiceTable kind={tab} />}
      {tab === 'profile' && (
        <>
          <p className="small muted">Registration details held by {issuer.company_name}. Contact them to correct anything.</p>
          <ProfileForm value={company.profile} onChange={() => {}} options={options} canEdit={false} partyMode />
        </>
      )}
    </>
  );
}
