'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSession } from '@/components/session';
import { updateGrant } from '@/lib/permissions';
import { api } from '@/lib/api';
import { money, date, ecDate, qty } from '@/lib/format';
import { FY_MONTHS, taxPeriod } from '@/lib/shared/ethiopian';
import type { InvoiceDetail } from '@/lib/types';
import { useLookups } from './lookups';
import PrintInvoice from './PrintInvoice';
import { PageHeader, Card, Badge, Loading, Field, Select, useFetch, useToast } from './ui';

function WithholdingCard({ inv, base, onSaved }: { inv: InvoiceDetail; base: string; onSaved: (inv: InvoiceDetail) => void }) {
  const toast = useToast();
  const { canAny, canCompany } = useSession();
  const mayEdit = canAny(updateGrant(inv.kind), ['withholding', 'edit']) && canCompany(inv.party_id, 'edit');
  const lk = useLookups();
  const [f, setF] = useState({
    wh_receipt_type: inv.wh_receipt_type || '', wh_receipt_no: inv.wh_receipt_no || '',
    wh_receipt_date: inv.wh_receipt_date || '', wh_paid: inv.wh_paid || ('' as number | string),
    wh_reason_note: inv.wh_reason_note || '', vat_wh_paid: inv.vat_wh_paid || ('' as number | string),
  });
  const [err, setErr] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const whMonth = f.wh_receipt_date ? taxPeriod(f.wh_receipt_date) : null;
  const sameMonth = whMonth && whMonth.fy === inv.fy && whMonth.idx === inv.fy_month;

  const save = async () => {
    setSaving(true);
    try {
      const r = await api.put<InvoiceDetail>(`${base}/${inv.id}/withholding`, f);
      toast('Withholding updated');
      setErr({});
      onSaved(r);
    } catch (e: any) {
      setErr(e.fields || {});
      toast(e.message, 'error');
    } finally { setSaving(false); }
  };

  const isSale = inv.kind === 'S';
  const vatWh = isSale ? inv.vat_wh : null;
  const showForm = inv.wh.applicable || (vatWh && vatWh.applicable);
  return (
    <Card title="Withholding tax" actions={<Badge>{inv.wh.status}</Badge>}>
      {isSale && vatWh && (
        <p className="small" style={{ marginTop: 0 }}>
          VAT withholding (50% – agent buyer): <Badge tone={vatWh.applicable ? 'warn' : undefined}>{vatWh.applicable ? 'Yes' : 'No'}</Badge>
        </p>
      )}
      {!showForm ? (
        <p className="muted" style={{ margin: 0 }}>
          Withholding does not apply – taxable amount {money(inv.taxable_amount)} is below the
          {inv.vat_category === 'S' ? ' service' : ' goods'} threshold.
        </p>
      ) : (
        <>
          {inv.wh.applicable && (
            <p className="small muted" style={{ marginTop: 0 }}>
              {isSale ? 'The buyer withholds tax from our payment and issues a WH receipt.' : 'We withhold tax from the seller and pay it to the tax authority.'}
            </p>
          )}
          <div className="form-grid" style={{ gridTemplateColumns: 'repeat(2, minmax(0,1fr))' }}>
            {inv.wh.applicable && (
              <>
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
                <Field label="WH reason / note" error={err.wh_reason_note} hint={f.wh_receipt_type === 'Other' ? 'Explain the receipt type' : 'Optional'}>
                  <input value={f.wh_reason_note} onChange={(e) => setF({ ...f, wh_reason_note: e.target.value })} />
                </Field>
              </>
            )}
            {vatWh && vatWh.applicable && (
              <Field label="VAT-WH paid" error={err.vat_wh_paid}>
                <input type="number" step="any" min="0" value={f.vat_wh_paid} onChange={(e) => setF({ ...f, vat_wh_paid: e.target.value })} />
              </Field>
            )}
          </div>
          <dl className="kv mt">
            {inv.wh.applicable && (
              <>
                <dt>WH base</dt><dd>{money(inv.wh.base)}</dd>
                <dt>Expected WH</dt><dd>{money(inv.wh.expected)}</dd>
                <dt>Outstanding</dt><dd style={inv.wh.outstanding > 0 ? { color: 'var(--bad)' } : undefined}>{money(inv.wh.outstanding)}</dd>
              </>
            )}
            {vatWh && vatWh.applicable && (
              <>
                <dt>VAT-WH expected</dt><dd>{money(vatWh.expected)}</dd>
                <dt>VAT-WH outstanding</dt><dd style={vatWh.outstanding > 0 ? { color: 'var(--bad)' } : undefined}>{money(vatWh.outstanding)}</dd>
              </>
            )}
          </dl>
          <div className="row mt">
            {inv.wh.applicable && inv.wh.expected > 0 && <button className="btn btn-sm" onClick={() => setF({ ...f, wh_paid: inv.wh.expected })}>Fill expected WH</button>}
            {vatWh && vatWh.applicable && vatWh.expected > 0 && <button className="btn btn-sm" onClick={() => setF({ ...f, vat_wh_paid: vatWh.expected })}>Fill expected VAT-WH</button>}
            <span className="spacer" />
            {mayEdit && <button className="btn btn-primary" disabled={saving} onClick={save}>Save withholding</button>}
          </div>
        </>
      )}
    </Card>
  );
}

function PaymentsCard({ inv }: { inv: InvoiceDetail }) {
  return (
    <Card
      title={inv.kind === 'S' ? 'Receipts from buyer' : 'Payments to seller'}
      actions={inv.payment_type === 'Credit' && inv.balance > 0.004 && (
        <Link className="btn btn-sm btn-primary" href={`/crv?new=credit_collection&kind=${inv.kind}&invoice_id=${inv.id}`}>+ Record collection in CRV</Link>
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
          <p className="small muted">Collections against this {inv.kind === 'S' ? 'sale' : 'purchase'} are recorded and managed entirely in the <Link href="/crv">CRV</Link> module.</p>
          {inv.payments.length > 0 && (
            <table className="mt">
              <thead><tr><th>Date</th><th>Method</th><th>Reference</th><th>CRV #</th><th className="num">Amount</th></tr></thead>
              <tbody>
                {inv.payments.map((p) => (
                  <tr key={p.id}>
                    <td>{date(p.date)}</td><td>{p.method}</td><td>{p.reference}</td><td>{p.crv_no}</td>
                    <td className="num">{money(p.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </Card>
  );
}

export default function InvoiceView({ kind, id }: { kind: 'P' | 'S'; id: string | number }) {
  const router = useRouter();
  const { canFor } = useSession();
  const resource = kind === 'S' ? 'sales' : 'purchases';
  const toast = useToast();
  const isSale = kind === 'S';
  const base = isSale ? '/sales' : '/purchases';
  const { data: inv, error, setData } = useFetch<InvoiceDetail>(`${base}/${id}`);
  const lk = useLookups();
  if (!inv) return <Loading error={error} />;
  const typeList = isSale ? 'sales_type' : 'purchase_type';

  const remove = async () => {
    if (!confirm(`Delete ${inv.invoice_no}? This cannot be undone.`)) return;
    try {
      await api.del(`${base}/${inv.id}`);
      toast(`${inv.invoice_no} deleted`);
      router.push(base);
    } catch (e: any) {
      toast(e.message, 'error');
    }
  };
  const toggleReported = async () => {
    const status = inv.report_status === 'Reported' ? 'Not Reported' : 'Reported';
    try {
      await api.post(`${base}/report-status`, { ids: [inv.id], status });
      setData({ ...inv, report_status: status });
    } catch (e: any) {
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
        <PaymentsCard inv={inv} />
      </div>
      </div>
    </>
  );
}
