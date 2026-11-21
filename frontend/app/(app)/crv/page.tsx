'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useSession } from '@/components/session';
import { api, qs, translateMessage } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { money, date, today } from '@/lib/format';
import { PageHeader, Card, Badge, Loading, Empty, Field, Select, Modal, useFetch, useToast } from '@/components/ui';
import type { Party } from '@/lib/types';
import DateInput from '@/components/DateInput';

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
  const { t } = useT();
  const fe = (v: unknown) => (v ? translateMessage(v) : undefined);
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
      toast(t('CRV #{no} recorded', { no: r.crv_no }));
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
      title={t('New CRV')}
      subtitle={t('Cash / credit receipt voucher')}
      icon="wallet"
      onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>{t('Cancel')}</button><button className="btn btn-primary" disabled={saving} onClick={save}>{saving ? t('Saving…') : t('Save CRV')}</button></>}
    >
      {err._ && <div className="alert alert-error">{err._}</div>}
      <div className="form-grid" style={{ gridTemplateColumns: 'repeat(2, minmax(0,1fr))' }}>
        <Field label={t('Category')} required error={fe(err.category)} className="span-2">
          <Select options={CATEGORY_OPTIONS.map((o) => ({ ...o, label: t(o.label) }))} value={f.category} onChange={(v) => setF({ ...f, category: v as CrvCategory, invoice_id: '', party_id: '' })} />
        </Field>
        {isCollection ? (
          <>
            <Field label={t('Purchase or sale')}>
              <select value={kind} onChange={(e) => { setKind(e.target.value as 'P' | 'S'); setF({ ...f, invoice_id: '' }); }}>
                <option value="P">{t('Purchase')}</option>
                <option value="S">{t('Sale')}</option>
              </select>
            </Field>
            <Field label={t('Invoice')} required error={fe(err.invoice_id)}>
              <select value={f.invoice_id} onChange={(e) => pickInvoice(e.target.value)}>
                <option value="">{t('— Select a credit invoice —')}</option>
                {(invoices || []).filter((i) => i.balance > 0.004).map((i) => (
                  <option key={i.id} value={i.id}>{i.invoice_no} · {i.party_name || t('Unregistered')} · {t('outstanding {amount}', { amount: money(i.balance) })}</option>
                ))}
              </select>
            </Field>
          </>
        ) : (
          <Field label={t('Party')} error={fe(err.party_id)} hint={t('Optional')}>
            <select value={f.party_id} onChange={(e) => setF({ ...f, party_id: e.target.value })}>
              <option value="">{t('— None —')}</option>
              {(parties || []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
        )}
        <Field label={t('Date')} required error={fe(err.date)}><DateInput value={f.date} invalid={!!err.date} onChange={(v) => setF({ ...f, date: v })} /></Field>
        <Field label={t('Amount')} required error={fe(err.amount)}><input type="number" step="any" min="0" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
        <Field label={t('Method')}><input value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })} placeholder={t('Cash / bank transfer…')} /></Field>
        <Field label={t('Reference')}><input value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} placeholder={t('Cheque / transaction no.')} /></Field>
        <Field label={t('Note')} className="span-2"><textarea rows={2} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

export default function CrvPage() {
  const toast = useToast();
  const { t } = useT();
  const { can } = useSession();
  const params = useSearchParams();
  const [category, setCategory] = useState('');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(params.get('new') === 'credit_collection');
  const { data, error, reload } = useFetch<CrvRow[]>('/crv' + qs({ category, q }));

  const remove = async (row: CrvRow) => {
    if (!confirm(t('Delete CRV #{no}?', { no: row.crv_no }))) return;
    try {
      await api.del(`/crv/${row.id}`);
      toast(t('CRV #{no} deleted', { no: row.crv_no }));
      reload();
    } catch (e: any) {
      toast(e.message, 'error');
    }
  };

  return (
    <>
      <PageHeader title={t('Cash / Credit Receipt Vouchers')} subtitle={t('Loans, shareholder contributions, other refunds and collections against invoices')}>
        {can('crv', 'create') && <button className="btn btn-primary" onClick={() => setOpen(true)}>{t('+ New CRV')}</button>}
      </PageHeader>
      <Card
        fill
        bodyClass=""
        title={(
          <div className="row">
            <input type="search" placeholder={t('Search note, reference, party…')} value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 260 }} />
            <select value={category} onChange={(e) => setCategory(e.target.value)} aria-label={t('Category')}>
              <option value="">{t('All categories')}</option>
              <option value="credit_collection">{t('Credit collection')}</option>
              <option value="loan">{t('Loan received')}</option>
              <option value="shareholder_contribution">{t('Shareholder contribution')}</option>
              <option value="other_refund">{t('Other / refund')}</option>
            </select>
          </div>
        )}
        actions={<span className="small muted">{t('{n} vouchers', { n: data?.length ?? 0 })}</span>}
      >
        {!data ? <Loading error={error} /> : !data.length ? <Empty>{t('No CRVs yet.')}</Empty> : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t('CRV #')}</th><th>{t('Date')}</th><th>{t('Category')}</th><th className="num">{t('Amount')}</th><th>{t('Party')}</th>
                  <th>{t('Invoice')}</th><th>{t('Method')}</th><th>{t('Reference')}</th><th>{t('Note')}</th><th />
                </tr>
              </thead>
              <tbody>
                {data.map((r) => (
                  <tr key={r.id}>
                    <td>{r.crv_no}</td>
                    <td>{date(r.date)}</td>
                    <td><Badge tone={CATEGORY_TONES[r.category]}>{t(CATEGORY_LABELS[r.category] || r.category)}</Badge></td>
                    <td className="num">{money(r.amount)}</td>
                    <td>{r.party_name || '—'}</td>
                    <td>{r.invoice_no || '—'}</td>
                    <td>{r.method ? t(r.method) : '—'}</td>
                    <td>{r.reference || '—'}</td>
                    <td className="wrap">{r.note || ''}</td>
                    <td className="right">
                      {can('crv', 'delete') && <button className="btn btn-sm btn-ghost" onClick={() => remove(r)}>{t('Delete')}</button>}
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
