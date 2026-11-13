'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useSession } from '@/components/session';
import { api } from '@/lib/api';
import { money, date, today } from '@/lib/format';
import { PageHeader, Card, Stat, Badge, Loading, Empty, Field, Select, Modal, useFetch, useToast } from '@/components/ui';
import type { Party } from '@/lib/types';

interface MergeModalProps {
  party: { id: number; name: string };
  onClose: () => void;
}

/** Picks the surviving party and confirms the merge; `party` is `{ id, name }` of the one being merged away. */
function MergeModal({ party, onClose }: MergeModalProps) {
  const router = useRouter();
  const toast = useToast();
  const { data: parties } = useFetch<Party[]>('/parties');
  const [intoId, setIntoId] = useState('');
  const [busy, setBusy] = useState(false);

  const candidates = (parties || []).filter((p) => p.id !== party.id);
  const options = candidates.map((p) => ({ value: p.id, label: `${p.name}${p.tin ? ` · TIN ${p.tin}` : ''}` }));
  const target = candidates.find((p) => p.id === Number(intoId));

  const merge = async () => {
    if (!intoId || !target) return;
    if (!confirm(`Merge "${party.name}" into "${target.name}"? This cannot be undone.`)) return;
    setBusy(true);
    try {
      await api.post(`/parties/${party.id}/merge`, { into_id: Number(intoId) });
      toast(`${party.name} merged into ${target.name}`);
      router.push(`/parties/${intoId}`);
    } catch (e: any) {
      toast(e.message, 'error');
      setBusy(false);
    }
  };

  return (
    <Modal
      icon="suppliers"
      title="Merge into another party"
      subtitle={`"${party.name}" will be kept only as history; its purchases and sales move to the party you pick.`}
      onClose={onClose}
      footer={(
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={merge} disabled={!intoId || busy}>{busy ? 'Merging…' : 'Merge'}</button>
        </>
      )}
    >
      {!parties ? <Loading /> : !options.length ? <Empty>No other companies to merge into.</Empty> : (
        <Field label="Merge into" hint="Pick the party that should survive the merge.">
          <Select placeholder="Select a party…" options={options} value={intoId} onChange={setIntoId} />
        </Field>
      )}
    </Modal>
  );
}

interface LedgerRow {
  date: string;
  type: string;
  ref: string;
  detail?: string | null;
  invoice_id: number;
  charge?: number;
  payment?: number;
  balance: number;
}

interface LedgerProps {
  title: string;
  rows: LedgerRow[];
  kind: 'P' | 'S';
  outstanding: number;
}

function Ledger({ title, rows, kind, outstanding }: LedgerProps) {
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

interface StatementTotals {
  purchased: number;
  purchaseCount: number;
  whWithheld: number;
  payable: number;
  sold: number;
  saleCount: number;
  whByCustomer: number;
  receivable: number;
}

interface StatementParty {
  name: string;
  tin: string | null;
  type: string;
  mrc1?: string | null;
  mrc2?: string | null;
  mrc3?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
}

interface StatementData {
  party: StatementParty;
  totals: StatementTotals;
  purchases: LedgerRow[];
  sales: LedgerRow[];
}

interface SettingsData {
  company_name?: string;
  company_tin?: string;
  [key: string]: unknown;
}

export default function StatementPage() {
  const { can, canFor } = useSession();
  const { id } = useParams<{ id: string }>();
  const partyId = Number(id);
  const { data, error } = useFetch<StatementData>(`/parties/${id}/statement`);
  const { data: full } = useFetch<Party>(`/parties/${id}`);
  const { data: s } = useFetch<SettingsData>('/settings');
  const [printedOn] = useState(today());
  const [merging, setMerging] = useState(false);
  if (!data) return <Loading error={error} />;
  const { party, totals } = data;
  const mergedIntoId = full?.merged_into_id ?? null;

  return (
    <>
      <div className="print-only statement-head">
        <div className="pd-company">{s?.company_name}</div>
        {s?.company_tin && <div>TIN: {s.company_tin}</div>}
        <h2 style={{ margin: '12px 0 2px' }}>Statement of account – {party.name}</h2>
        <div>TIN {party.tin || '—'} · printed {date(printedOn)}</div>
      </div>

      {mergedIntoId != null && (
        <div className="alert alert-warn no-print">
          This company was merged into another party and is kept only as history.{' '}
          <Link href={`/parties/${mergedIntoId}`}>View the surviving party →</Link>
        </div>
      )}

      <PageHeader title={party.name} subtitle={`Statement of account · TIN ${party.tin || '—'} · ${party.type}`}>
        <Link className="btn" href="/parties">← Supplier list</Link>
        <button className="btn" onClick={() => window.print()}>Print statement</button>
        <Link className="btn" href="/purchases/new">+ Purchase</Link>
        {can('sales', 'create') && <Link className="btn btn-primary" href="/sales/new">+ Sale</Link>}
        {mergedIntoId == null && canFor('parties', 'delete', partyId) && (
          <button className="btn" onClick={() => setMerging(true)}>Merge into another party…</button>
        )}
      </PageHeader>

      {merging && <MergeModal party={{ id: partyId, name: party.name }} onClose={() => setMerging(false)} />}

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
