'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useSession } from '@/components/session';
import { api, qs } from '@/lib/api';
import { money, date, today } from '@/lib/format';
import { PageHeader, Card, Badge, Loading, Empty, Field, Select, Modal, useFetch, useToast } from '@/components/ui';
import type { Party } from '@/lib/types';

type CrvCategory = 'credit_collection' | 'loan' | 'shareholder_contribution' | 'other_refund';

interface CrvRow {
  id: number;
  crv_no: number;
  date: string;
  amount: number;
  method: string | null;
  reference: string | null;
  category: CrvCategory;
  note: string | null;
  party_id: number | null;
  party_name: string | null;
  invoice_id: number | null;
  invoice_no: string | null;
  created_at: string;
}

interface CreditInvoice {
  id: number;
  invoice_no: string;
  party_name: string | null;
  balance: number;
}

const CATEGORY_OPTIONS = [
  { value: 'credit_collection', label: 'Credit collection (against an invoice)' },
  { value: 'loan', label: 'Loan received' },
  { value: 'shareholder_contribution', label: 'Shareholder contribution' },
  { value: 'other_refund', label: 'Other / refund' },
];
const CATEGORY_LABELS: Record<string, string> = {
  credit_collection: 'Credit collection',
  loan: 'Loan received',
  shareholder_contribution: 'Shareholder contribution',
  other_refund: 'Other / refund',
};
const CATEGORY_TONES: Record<string, string | undefined> = {
  credit_collection: 'info',
  loan: 'warn',
  shareholder_contribution: 'good',
  other_refund: undefined,
};

/**
 * New CRV — either a standalone money-in event (loan / shareholder contribution / other refund)
 * or a credit collection against a Credit purchase/sale (this is the ONLY place a collection can
 * be recorded now — there is no "Record payment" action on the invoice page anymore).
 */
function NewCrvModal({ onClose, onSaved, initialCategory, initialKind, initialInvoiceId }: {
  onClose: () => void; onSaved: (r: CrvRow) => void;
  initialCategory: CrvCategory; initialKind: 'P' | 'S'; initialInvoiceId: string;
}) {
  const toast = useToast();
  const { data: parties } = useFetch<Party[]>('/parties');
  const [kind, setKind] = useState<'P' | 'S'>(initialKind || 'P');
  const { data: purchases } = useFetch<CreditInvoice[]>('/purchases' + qs({ payment: 'Credit' }));
  const { data: sales } = useFetch<CreditInvoice[]>('/sales' + qs({ payment: 'Credit' }));
  const invoices = kind === 'S' ? sales : purchases;
  const [f, setF] = useState({
    date: today(), amount: '' as number | string, category: initialCategory || 'loan', party_id: '',
    invoice_id: initialInvoiceId || '', method: '', reference: '', note: '',
  });
  const [err, setErr] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const isCollection = f.category === 'credit_collection';

  const pickInvoice = (invoiceId: string) => {
    const inv = (invoices || []).find((i) => String(i.id) === String(invoiceId));
    setF({ ...f, invoice_id: invoiceId, amount: inv ? inv.balance : f.amount });
  };

  const save = async () => {
    setSaving(true);
    try {
      const body = isCollection
        ? { date: f.date, amount: f.amount, category: f.category, invoice_id: Number(f.invoice_id) || null, method: f.method, reference: f.reference, note: f.note }
        : { ...f, invoice_id: null, party_id: f.party_id || null };
      const r = await api.post<CrvRow>('/crv', body);
      toast(`CRV #${r.crv_no} recorded`);
      setErr({});
      onSaved(r);
    } catch (e: any) {
      setErr({ ...(e.fields || {}), _: e.message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title="New CRV"
      subtitle="Cash / credit receipt voucher"
      icon="wallet"
      onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save CRV'}</button></>}
    >
      {err._ && <div className="alert alert-error">{err._}</div>}
      <div className="form-grid" style={{ gridTemplateColumns: 'repeat(2, minmax(0,1fr))' }}>
        <Field label="Category" required error={err.category} className="span-2">
          <Select options={CATEGORY_OPTIONS} value={f.category} onChange={(v) => setF({ ...f, category: v as CrvCategory, invoice_id: '', party_id: '' })} />
        </Field>
        {isCollection ? (
          <>
            <Field label="Purchase or sale">
              <select value={kind} onChange={(e) => { setKind(e.target.value as 'P' | 'S'); setF({ ...f, invoice_id: '' }); }}>
                <option value="P">Purchase</option>
                <option value="S">Sale</option>
              </select>
            </Field>
            <Field label="Invoice" required error={err.invoice_id}>
              <select value={f.invoice_id} onChange={(e) => pickInvoice(e.target.value)}>
                <option value="">— Select a credit invoice —</option>
                {(invoices || []).filter((i) => i.balance > 0.004).map((i) => (
                  <option key={i.id} value={i.id}>{i.invoice_no} · {i.party_name || 'Unregistered'} · outstanding {money(i.balance)}</option>
                ))}
              </select>
            </Field>
          </>
        ) : (
          <Field label="Party" error={err.party_id} hint="Optional">
            <select value={f.party_id} onChange={(e) => setF({ ...f, party_id: e.target.value })}>
              <option value="">— None —</option>
              {(parties || []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
        )}
        <Field label="Date" required error={err.date}><input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
        <Field label="Amount" required error={err.amount}><input type="number" step="any" min="0" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
        <Field label="Method"><input value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })} placeholder="Cash / bank transfer…" /></Field>
        <Field label="Reference"><input value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} placeholder="Cheque / transaction no." /></Field>
        <Field label="Note" className="span-2"><textarea rows={2} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

export default function CrvPage() {
  const toast = useToast();
  const { can } = useSession();
  const params = useSearchParams();
  const [category, setCategory] = useState('');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(params.get('new') === 'credit_collection');
  const { data, error, reload } = useFetch<CrvRow[]>('/crv' + qs({ category, q }));

  const remove = async (row: CrvRow) => {
    if (!confirm(`Delete CRV #${row.crv_no}?`)) return;
    try {
      await api.del(`/crv/${row.id}`);
      toast(`CRV #${row.crv_no} deleted`);
      reload();
    } catch (e: any) {
      toast(e.message, 'error');
    }
  };

  return (
    <>
      <PageHeader title="Cash / Credit Receipt Vouchers" subtitle="Loans, shareholder contributions, other refunds and collections against invoices">
        {can('crv', 'create') && <button className="btn btn-primary" onClick={() => setOpen(true)}>+ New CRV</button>}
      </PageHeader>
      <Card
        fill
        bodyClass=""
        title={(
          <div className="row">
            <input type="search" placeholder="Search note, reference, party…" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 260 }} />
            <select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category">
              <option value="">All categories</option>
              <option value="credit_collection">Credit collection</option>
              <option value="loan">Loan received</option>
              <option value="shareholder_contribution">Shareholder contribution</option>
              <option value="other_refund">Other / refund</option>
            </select>
          </div>
        )}
        actions={<span className="small muted">{data?.length ?? 0} vouchers</span>}
      >
        {!data ? <Loading error={error} /> : !data.length ? <Empty>No CRVs yet.</Empty> : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>CRV #</th><th>Date</th><th>Category</th><th className="num">Amount</th><th>Party</th>
                  <th>Invoice</th><th>Method</th><th>Reference</th><th>Note</th><th />
                </tr>
              </thead>
              <tbody>
                {data.map((r) => (
                  <tr key={r.id}>
                    <td>{r.crv_no}</td>
                    <td>{date(r.date)}</td>
                    <td><Badge tone={CATEGORY_TONES[r.category]}>{CATEGORY_LABELS[r.category] || r.category}</Badge></td>
                    <td className="num">{money(r.amount)}</td>
                    <td>{r.party_name || '—'}</td>
                    <td>{r.invoice_no || '—'}</td>
                    <td>{r.method || '—'}</td>
                    <td>{r.reference || '—'}</td>
                    <td className="wrap">{r.note || ''}</td>
                    <td className="right">
                      {can('crv', 'delete') && <button className="btn btn-sm btn-ghost" onClick={() => remove(r)}>Delete</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {open && (
        <NewCrvModal
          initialCategory={params.get('new') === 'credit_collection' ? 'credit_collection' : 'loan'}
          initialKind={(params.get('kind') as 'P' | 'S') || 'P'}
          initialInvoiceId={params.get('invoice_id') || ''}
          onClose={() => setOpen(false)}
          onSaved={() => { setOpen(false); reload(); }}
        />
      )}
    </>
  );
}
