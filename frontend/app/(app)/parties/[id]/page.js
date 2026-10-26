'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useSession } from '@/components/session';
import { money, date, today } from '@/lib/format';
import { PageHeader, Card, Stat, Badge, Loading, Empty, useFetch } from '@/components/ui';

function Ledger({ title, rows, kind, outstanding }) {
  if (!rows.length) return null;
  const base = kind === 'P' ? '/purchases' : '/sales';
  return (
    <Card className="mt statement-card" bodyClass="" title={title} actions={<span className="small">Outstanding <strong>ETB {money(outstanding)}</strong></span>}>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Date</th><th>Type</th><th>Reference</th><th>Details</th>
              <th className="num">{kind === 'P' ? 'Amount owed' : 'Amount charged'}</th>
              <th className="num">{kind === 'P' ? 'Paid' : 'Received'}</th>
              <th className="num">Balance</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td>{date(r.date)}</td>
                <td><Badge tone={r.charge ? 'info' : 'good'}>{r.type}</Badge></td>
                <td><Link href={`${base}/${r.invoice_id}`}>{r.ref}</Link></td>
                <td className="small">{r.detail}</td>
                <td className="num">{r.charge ? money(r.charge) : ''}</td>
                <td className="num">{r.payment ? money(r.payment) : ''}</td>
                <td className="num"><strong>{money(r.balance)}</strong></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

export default function StatementPage() {
  const { can } = useSession();
  const { id } = useParams();
  const { data, error } = useFetch(`/parties/${id}/statement`);
  const { data: s } = useFetch('/settings');
  const [printedOn] = useState(today());
  if (!data) return <Loading error={error} />;
  const { party, totals } = data;

  return (
    <>
      <div className="print-only statement-head">
        <div className="pd-company">{s?.company_name}</div>
        {s?.company_tin && <div>TIN: {s.company_tin}</div>}
        <h2 style={{ margin: '12px 0 2px' }}>Statement of account – {party.name}</h2>
        <div>TIN {party.tin || '—'} · printed {date(printedOn)}</div>
      </div>

      <PageHeader title={party.name} subtitle={`Statement of account · TIN ${party.tin || '—'} · ${party.type}`}>
        <Link className="btn" href="/parties">← Supplier list</Link>
        <button className="btn" onClick={() => window.print()}>Print statement</button>
        <Link className="btn" href="/purchases/new">+ Purchase</Link>
        {can('sales', 'create') && <Link className="btn btn-primary" href="/sales/new">+ Sale</Link>}
      </PageHeader>

      <div className="grid grid-4">
        <Stat label="Total purchased from them" value={`ETB ${money(totals.purchased)}`} sub={`${totals.purchaseCount} receipts · WH withheld ${money(totals.whWithheld)}`} />
        <Stat label="We owe them (payable)" value={`ETB ${money(totals.payable)}`} tone={totals.payable > 0 ? 'bad' : undefined} />
        <Stat label="Total sold to them" value={`ETB ${money(totals.sold)}`} sub={`${totals.saleCount} invoices · WH by customer ${money(totals.whByCustomer)}`} />
        <Stat label="They owe us (receivable)" value={`ETB ${money(totals.receivable)}`} tone={totals.receivable > 0 ? 'bad' : undefined} />
      </div>

      <Card className="mt" title="Company details">
        <dl className="kv">
          <dt>TIN</dt><dd>{party.tin || '—'}</dd>
          <dt>MRC numbers</dt><dd>{[party.mrc1, party.mrc2, party.mrc3].filter(Boolean).join(', ') || '—'}</dd>
          <dt>Phone</dt><dd>{party.phone || '—'}</dd>
          <dt>Email</dt><dd>{party.email || '—'}</dd>
          <dt>Address</dt><dd>{party.address || '—'}</dd>
        </dl>
      </Card>

      {!data.purchases.length && !data.sales.length && <Card className="mt"><Empty>No transactions with this company yet.</Empty></Card>}
      <Ledger title="Purchases & payments (payable)" rows={data.purchases} kind="P" outstanding={totals.payable} />
      <Ledger title="Sales & receipts (receivable)" rows={data.sales} kind="S" outstanding={totals.receivable} />
      <p className="small muted no-print">Amounts are invoice totals less withholding tax. Cash transactions are shown as settled on the same day.</p>
    </>
  );
}
