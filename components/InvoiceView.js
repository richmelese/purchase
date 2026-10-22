'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSession } from '@/components/session';
import { paymentGrant, updateGrant } from '@/lib/permissions';
import { api } from '@/lib/api';
import { money, date, ecDate, qty, today } from '@/lib/format';
import { FY_MONTHS, taxPeriod } from '@/lib/shared/ethiopian';
import { useLookups } from './lookups';
import PrintInvoice from './PrintInvoice';
import { PageHeader, Card, Badge, Loading, Field, Select, Modal, useFetch, useToast } from './ui';

function WithholdingCard({ inv, base, onSaved }) {
  const toast = useToast();
  const { canAny, canCompany } = useSession();
  const mayEdit = canAny(updateGrant(inv.kind), ['withholding', 'edit']) && canCompany(inv.party_id, 'edit');
  const lk = useLookups();
  const [f, setF] = useState({
    wh_receipt_type: inv.wh_receipt_type || '', wh_receipt_no: inv.wh_receipt_no || '',
    wh_receipt_date: inv.wh_receipt_date || '', wh_paid: inv.wh_paid || '',
  });
  const [err, setErr] = useState({});
  const [saving, setSaving] = useState(false);
  const whMonth = f.wh_receipt_date ? taxPeriod(f.wh_receipt_date) : null;
  const sameMonth = whMonth && whMonth.fy === inv.fy && whMonth.idx === inv.fy_month;

  const save = async () => {
    setSaving(true);
    try {
      const r = await api.put(`${base}/${inv.id}/withholding`, f);
      toast('Withholding updated');
      setErr({});
      onSaved(r);
    } catch (e) {
      setErr(e.fields || {});
      toast(e.message, 'error');
    } finally { setSaving(false); }
  };

  const isSale = inv.kind === 'S';
  return (
    <Card title="Withholding tax" actions={<Badge>{inv.wh.status}</Badge>}>
      {!inv.wh.applicable ? (
        <p className="muted" style={{ margin: 0 }}>
          Withholding does not apply – taxable amount {money(inv.taxable_amount)} is below the
          {inv.vat_category === 'S' ? ' service' : ' goods'} threshold.
        </p>
      ) : (
        <>
          <p className="small muted" style={{ marginTop: 0 }}>
            {isSale ? 'The buyer withholds tax from our payment and issues a WH receipt.' : 'We withhold tax from the seller and pay it to the tax authority.'}
          </p>
          <div className="form-grid" style={{ gridTemplateColumns: 'repeat(2, minmax(0,1fr))' }}>
            <Field label="WH receipt status" error={err.wh_receipt_type}>
              <Select options={lk.options('wh_receipt_type')} placeholder="Select RT" value={f.wh_receipt_type} onChange={(v) => setF({ ...f, wh_receipt_type: v })} />
            </Field>
            <Field label="WH receipt no.">
              <input value={f.wh_receipt_no} onChange={(e) => setF({ ...f, wh_receipt_no: e.target.value })} />
            </Field>
            <Field label="WH receipt date" error={err.wh_receipt_date} hint={whMonth ? `${whMonth.month} · ${sameMonth ? 'same month' : 'different month – penalty risk'}` : ''}>
              <input type="date" value={f.wh_receipt_date} onChange={(e) => setF({ ...f, wh_receipt_date: e.target.value })} />
            </Field>
            <Field label="WH paid" error={err.wh_paid}>
              <input type="number" step="any" min="0" value={f.wh_paid} onChange={(e) => setF({ ...f, wh_paid: e.target.value })} />
            </Field>
          </div>
          <dl className="kv mt">
            <dt>WH base</dt><dd>{money(inv.wh.base)}</dd>
            <dt>Expected WH</dt><dd>{money(inv.wh.expected)}</dd>
            <dt>Outstanding</dt><dd style={inv.wh.outstanding > 0 ? { color: 'var(--bad)' } : undefined}>{money(inv.wh.outstanding)}</dd>
          </dl>
          <div className="row mt">
            {inv.wh.expected > 0 && <button className="btn btn-sm" onClick={() => setF({ ...f, wh_paid: inv.wh.expected })}>Fill expected amount</button>}
            <span className="spacer" />
            {mayEdit && <button className="btn btn-primary" disabled={saving} onClick={save}>Save withholding</button>}
          </div>
        </>
      )}
    </Card>
  );
}

function PaymentsCard({ inv, base, onChange }) {
  const toast = useToast();
  const { canAny, canCompany } = useSession();
  // role right, and the "edit" right for this invoice's company
  const mayRecord = canAny(paymentGrant(inv.kind), ['credit', 'create'], ['credit', 'edit']) && canCompany(inv.party_id, 'edit');
  const mayDelete = canAny(paymentGrant(inv.kind), ['credit', 'delete']) && canCompany(inv.party_id, 'edit');
  const lk = useLookups();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ date: today(), amount: '', method: 'Bank transfer', reference: '' });
  const [err, setErr] = useState({});

  const add = async () => {
    try {
      const r = await api.post(`${base}/${inv.id}/payments`, f);
      toast('Payment recorded');
      setOpen(false);
      setErr({});
      onChange(r);
    } catch (e) { setErr({ ...(e.fields || {}), _: e.message }); }
  };
  const remove = async (id) => {
    if (!confirm('Delete this payment?')) return;
    onChange(await api.del(`/payments/${id}`));
  };

  return (
    <Card
      title={inv.kind === 'S' ? 'Receipts from buyer' : 'Payments to seller'}
      actions={mayRecord && inv.payment_type === 'Credit' && inv.balance > 0.004 && (
        <button className="btn btn-sm btn-primary" onClick={() => { setF((x) => ({ ...x, amount: inv.balance })); setOpen(true); }}>+ Record payment</button>
      )}
    >
      {inv.payment_type === 'Cash' ? (
        <p className="muted" style={{ margin: 0 }}>Cash transaction – settled at the time of {inv.kind === 'S' ? 'sale' : 'purchase'}.</p>
      ) : (
        <>
          <dl className="kv">
            <dt>Invoice total</dt><dd>{money(inv.grand_total)}</dd>
            <dt>Less withholding</dt><dd>{money(inv.wh.expected)}</dd>
            <dt>Amount due</dt><dd>{money(inv.amount_due)}</dd>
            <dt>Paid</dt><dd>{money(inv.amount_paid)}</dd>
            <dt>Balance</dt><dd><Badge tone={inv.balance > 0.004 ? 'warn' : 'good'}>{inv.balance > 0.004 ? money(inv.balance) : 'Fully paid'}</Badge></dd>
          </dl>
          {inv.payments.length > 0 && (
            <table className="mt">
              <thead><tr><th>Date</th><th>Method</th><th>Reference</th><th className="num">Amount</th><th /></tr></thead>
              <tbody>
                {inv.payments.map((p) => (
                  <tr key={p.id}>
                    <td>{date(p.date)}</td><td>{p.method}</td><td>{p.reference}</td>
                    <td className="num">{money(p.amount)}</td>
                    <td>{mayDelete && <button className="icon-btn" aria-label="Delete payment" onClick={() => remove(p.id)}>✕</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
      {open && (
        <Modal title="Record payment" onClose={() => setOpen(false)} footer={<><button className="btn" onClick={() => setOpen(false)}>Cancel</button><button className="btn btn-primary" onClick={add}>Save payment</button></>}>
          {err._ && <div className="alert alert-error">{err._}</div>}
          <div className="form-grid" style={{ gridTemplateColumns: 'repeat(2, minmax(0,1fr))' }}>
            <Field label="Date" required error={err.date}><input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
            <Field label="Amount" required error={err.amount} hint={`Outstanding ${money(inv.balance)}`}><input type="number" step="any" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
            <Field label="Method"><Select options={lk.options('payment_method')} value={f.method} onChange={(v) => setF({ ...f, method: v })} /></Field>
            <Field label="Reference"><input value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} placeholder="Cheque / transaction no." /></Field>
          </div>
        </Modal>
      )}
    </Card>
  );
}

export default function InvoiceView({ kind, id }) {
  const router = useRouter();
  const { canFor } = useSession();
  const resource = kind === 'S' ? 'sales' : 'purchases';
  const toast = useToast();
  const isSale = kind === 'S';
  const base = isSale ? '/sales' : '/purchases';
  const { data: inv, error, setData } = useFetch(`${base}/${id}`);
  const lk = useLookups();
  if (!inv) return <Loading error={error} />;
  const typeList = isSale ? 'sales_type' : 'purchase_type';

  const remove = async () => {
    if (!confirm(`Delete ${inv.invoice_no}? This cannot be undone.`)) return;
    try {
      await api.del(`${base}/${inv.id}`);
      toast(`${inv.invoice_no} deleted`);
      router.push(base);
    } catch (e) {
      toast(e.message, 'error');
    }
  };
  const toggleReported = async () => {
    const status = inv.report_status === 'Reported' ? 'Not Reported' : 'Reported';
    try {
      await api.post(`${base}/report-status`, { ids: [inv.id], status });
      setData({ ...inv, report_status: status });
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  return (
    <>
      <PrintInvoice inv={inv} />
      <div className="no-print">
      <PageHeader title={`${isSale ? 'Sale' : 'Purchase'} ${inv.invoice_no}`} subtitle={`${inv.party_name || 'Unregistered ' + (isSale ? 'buyer' : 'seller')} · ${date(inv.date)} · ${ecDate(inv.date)}`}>
        <Link className="btn" href={base}>← Back</Link>
        <button className="btn" onClick={() => window.print()}>Print {isSale ? 'invoice' : 'voucher'}</button>
        {canFor(resource, 'edit', inv.party_id, updateGrant(inv.kind)[2]) && <button className="btn" onClick={toggleReported}>{inv.report_status === 'Reported' ? 'Mark not reported' : 'Mark reported'}</button>}
        {canFor(resource, 'edit', inv.party_id, updateGrant(inv.kind)[2]) && <Link className="btn" href={`${base}/${inv.id}/edit`}>Edit</Link>}
        {canFor(resource, 'delete', inv.party_id) && <button className="btn btn-danger" onClick={remove}>Delete</button>}
      </PageHeader>

      <div className="grid grid-2">
        <Card title="Receipt details" actions={<Badge>{inv.report_status}</Badge>}>
          <dl className="kv">
            <dt>{isSale ? 'Buyer' : 'Seller'}</dt><dd>{inv.party_name || '—'}</dd>
            <dt>TIN</dt><dd>{inv.party_tin || '—'}</dd>
            <dt>Payment type</dt><dd><Badge>{inv.payment_type}</Badge></dd>
            <dt>Product type</dt><dd>{inv.vat_category === 'G' ? 'Goods' : 'Service'}</dd>
            <dt>Date</dt><dd>{date(inv.date)} <span className="muted">({ecDate(inv.date)})</span></dd>
            <dt>Tax month</dt><dd>{FY_MONTHS[inv.fy_month]} · FY {inv.fy}</dd>
            <dt>Receipt type</dt><dd>{inv.receipt_type}{inv.mrc_number ? ` · MRC ${inv.mrc_number}` : ''}</dd>
            <dt>Receipt no.</dt><dd>{inv.vat_receipt_no}</dd>
            {inv.created_by && <><dt>Recorded by</dt><dd>{inv.created_by}{inv.updated_by && inv.updated_by !== inv.created_by ? <span className="muted"> · last edited by {inv.updated_by}</span> : null}</dd></>}
            {inv.notes && <><dt>Remark</dt><dd>{inv.notes}</dd></>}
          </dl>
        </Card>
        <Card title="Amounts">
          <div className="totals" style={{ width: '100%' }}>
            <div><span>B · Total price</span><span>{money(inv.total_amount)}</span></div>
            <div><span>D · Excise tax amount</span><span>{money(inv.excise_amount)}</span></div>
            <div><span>E · Other vatable service fee</span><span>{money(inv.vatable_service_fee)}</span></div>
            <div className="muted"><span>VAT base (B + D + E)</span><span>{money(inv.taxable_amount)}</span></div>
            <div><span>F · VAT</span><span>{money(inv.vat_amount)}</span></div>
            <div><span>G · Other non-vatable fee</span><span>{money(inv.non_vatable_fee)}</span></div>
            <div className="grand"><span>H · Total price</span><span>ETB {money(inv.grand_total)}</span></div>
          </div>
        </Card>
      </div>

      <Card className="mt" title="Items" bodyClass="">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>#</th><th>Code</th><th>Item name</th><th>Measurement</th><th>{isSale ? 'Type of sales' : 'Input category'}</th><th>Tax type</th>
                <th className="num">Qty</th><th className="num">Unit price (A)</th><th className="num">Total price (B)</th>
                <th className="num">Excise (C · D)</th><th className="num">Other vatable fee (E)</th><th className="num">VAT (F)</th>
                <th className="num">Other non-vatable fee (G)</th><th className="num">Total price (H)</th>
              </tr>
            </thead>
            <tbody>
              {inv.lines.map((l) => (
                <tr key={l.id}>
                  <td>{l.line_no}</td><td>{l.product_code}</td><td className="wrap">{l.description}</td><td>{l.unit ? `${l.unit} – ${lk.unitLabel(l.unit)}` : ''}</td>
                  <td className="small wrap" style={{ minWidth: 200 }}>{lk.labelOf(typeList, l.tx_type)}</td>
                  <td>{lk.labelOf('transaction_type', l.transaction_type)}</td>
                  <td className="num">{qty(l.qty)}</td><td className="num">{money(l.unit_price)}</td><td className="num">{money(l.total)}</td>
                  <td className="num">{l.excise_rate ? `${l.excise_rate}% · ` : ''}{money(l.excise_amount)}</td><td className="num">{money(l.vatable_service_fee)}</td>
                  <td className="num">{money(l.vat_amount)}</td><td className="num">{money(l.non_vatable_fee)}</td><td className="num"><strong>{money(l.line_total)}</strong></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid grid-2 mt">
        <WithholdingCard key={`wh-${inv.updated_at}`} inv={inv} base={base} onSaved={setData} />
        <PaymentsCard inv={inv} base={base} onChange={setData} />
      </div>
      </div>
    </>
  );
}
