'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSession } from '@/components/session';
import { updateGrant } from '@/lib/permissions';
import { api, translateMessage } from '@/lib/api';
import { money, date, otherDate, qty } from '@/lib/format';
import { FY_MONTHS, taxPeriod } from '@/lib/shared/ethiopian';
import { useT } from '@/lib/i18n';
import type { InvoiceDetail } from '@/lib/types';
import { useLookups } from './lookups';
import PrintInvoice from './PrintInvoice';
import TBadge from './TBadge';
import DateInput from './DateInput';
import { PageHeader, Card, Badge, Loading, Field, Select, useFetch, useToast } from './ui';

function WithholdingCard({ inv, base, onSaved }: { inv: InvoiceDetail; base: string; onSaved: (inv: InvoiceDetail) => void }) {
  const toast = useToast();
  const { t } = useT();
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
  const fe = (v: unknown) => (v ? translateMessage(v) : undefined);

  const save = async () => {
    setSaving(true);
    try {
      const r = await api.put<InvoiceDetail>(`${base}/${inv.id}/withholding`, f);
      toast(t('Withholding updated'));
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
    <Card title={t('Withholding tax')} actions={<TBadge value={inv.wh.status} />}>
      {isSale && vatWh && (
        <p className="small" style={{ marginTop: 0 }}>
          {t('VAT withholding (50% – agent buyer):')} <Badge tone={vatWh.applicable ? 'warn' : undefined}>{vatWh.applicable ? t('Yes') : t('No')}</Badge>
        </p>
      )}
      {!showForm ? (
        <p className="muted" style={{ margin: 0 }}>
          {inv.vat_category === 'S'
            ? t('Withholding does not apply – taxable amount {amount} is below the service threshold.', { amount: money(inv.taxable_amount) })
            : t('Withholding does not apply – taxable amount {amount} is below the goods threshold.', { amount: money(inv.taxable_amount) })}
        </p>
      ) : (
        <>
          {inv.wh.applicable && (
            <p className="small muted" style={{ marginTop: 0 }}>
              {isSale ? t('The buyer withholds tax from our payment and issues a WH receipt.') : t('We withhold tax from the seller and pay it to the tax authority.')}
            </p>
          )}
          <div className="form-grid" style={{ gridTemplateColumns: 'repeat(2, minmax(0,1fr))' }}>
            {inv.wh.applicable && (
              <>
                <Field label={t('WH receipt status')} error={fe(err.wh_receipt_type)}>
                  <Select options={lk.options('wh_receipt_type')} placeholder={t('Select RT')} value={f.wh_receipt_type} onChange={(v) => setF({ ...f, wh_receipt_type: v })} />
                </Field>
                <Field label={t('WH receipt no.')}>
                  <input value={f.wh_receipt_no} onChange={(e) => setF({ ...f, wh_receipt_no: e.target.value })} />
                </Field>
                <Field label={t('WH receipt date')} error={fe(err.wh_receipt_date)} hint={whMonth ? `${t(whMonth.month)} · ${sameMonth ? t('same month') : t('different month – penalty risk')}` : ''}>
                  <DateInput value={f.wh_receipt_date} invalid={!!err.wh_receipt_date} onChange={(v) => setF({ ...f, wh_receipt_date: v })} />
                </Field>
                <Field label={t('WH paid')} error={fe(err.wh_paid)}>
                  <input type="number" step="any" min="0" value={f.wh_paid} onChange={(e) => setF({ ...f, wh_paid: e.target.value })} />
                </Field>
                <Field label={t('WH reason / note')} error={fe(err.wh_reason_note)} hint={f.wh_receipt_type === 'Other' ? t('Explain the receipt type') : t('Optional')}>
                  <input value={f.wh_reason_note} onChange={(e) => setF({ ...f, wh_reason_note: e.target.value })} />
                </Field>
              </>
            )}
            {vatWh && vatWh.applicable && (
              <Field label={t('VAT-WH paid')} error={fe(err.vat_wh_paid)}>
                <input type="number" step="any" min="0" value={f.vat_wh_paid} onChange={(e) => setF({ ...f, vat_wh_paid: e.target.value })} />
              </Field>
            )}
          </div>
          <dl className="kv mt">
            {inv.wh.applicable && (
              <>
                <dt>{t('WH base')}</dt><dd>{money(inv.wh.base)}</dd>
                <dt>{t('Expected WH')}</dt><dd>{money(inv.wh.expected)}</dd>
                <dt>{t('Outstanding')}</dt><dd style={inv.wh.outstanding > 0 ? { color: 'var(--bad)' } : undefined}>{money(inv.wh.outstanding)}</dd>
              </>
            )}
            {vatWh && vatWh.applicable && (
              <>
                <dt>{t('VAT-WH expected')}</dt><dd>{money(vatWh.expected)}</dd>
                <dt>{t('VAT-WH outstanding')}</dt><dd style={vatWh.outstanding > 0 ? { color: 'var(--bad)' } : undefined}>{money(vatWh.outstanding)}</dd>
              </>
            )}
          </dl>
          <div className="row mt">
            {inv.wh.applicable && inv.wh.expected > 0 && <button className="btn btn-sm" onClick={() => setF({ ...f, wh_paid: inv.wh.expected })}>{t('Fill expected WH')}</button>}
            {vatWh && vatWh.applicable && vatWh.expected > 0 && <button className="btn btn-sm" onClick={() => setF({ ...f, vat_wh_paid: vatWh.expected })}>{t('Fill expected VAT-WH')}</button>}
            <span className="spacer" />
            {mayEdit && <button className="btn btn-primary" disabled={saving} onClick={save}>{t('Save withholding')}</button>}
          </div>
        </>
      )}
    </Card>
  );
}

function PaymentsCard({ inv }: { inv: InvoiceDetail }) {
  const { t } = useT();
  const isSale = inv.kind === 'S';
  return (
    <Card
      title={isSale ? t('Receipts from buyer') : t('Payments to seller')}
      actions={inv.payment_type === 'Credit' && inv.balance > 0.004 && (
        <Link className="btn btn-sm btn-primary" href={`/crv?new=credit_collection&kind=${inv.kind}&invoice_id=${inv.id}`}>{t('+ Record collection in CRV')}</Link>
      )}
    >
      {inv.payment_type === 'Cash' ? (
        <p className="muted" style={{ margin: 0 }}>{isSale ? t('Cash transaction – settled at the time of sale.') : t('Cash transaction – settled at the time of purchase.')}</p>
      ) : (
        <>
          <dl className="kv">
            <dt>{t('Invoice total')}</dt><dd>{money(inv.grand_total)}</dd>
            <dt>{t('Less withholding')}</dt><dd>{money(inv.wh.expected)}</dd>
            <dt>{t('Amount due')}</dt><dd>{money(inv.amount_due)}</dd>
            <dt>{t('Paid')}</dt><dd>{money(inv.amount_paid)}</dd>
            <dt>{t('Balance')}</dt><dd><Badge tone={inv.balance > 0.004 ? 'warn' : 'good'}>{inv.balance > 0.004 ? money(inv.balance) : t('Fully paid')}</Badge></dd>
          </dl>
          <p className="small muted">
            {isSale ? t('Collections against this sale are recorded and managed entirely in the') : t('Collections against this purchase are recorded and managed entirely in the')}{' '}
            <Link href="/crv">CRV</Link> {t('module.')}
          </p>
          {inv.payments.length > 0 && (
            <table className="mt">
              <thead><tr><th>{t('Date')}</th><th>{t('Method')}</th><th>{t('Reference')}</th><th>{t('CRV #')}</th><th className="num">{t('Amount')}</th></tr></thead>
              <tbody>
                {inv.payments.map((p) => (
                  <tr key={p.id}>
                    <td>{date(p.date)}</td><td>{t(p.method || '')}</td><td>{p.reference}</td><td>{p.crv_no}</td>
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
  const { t } = useT();
  const isSale = kind === 'S';
  const base = isSale ? '/sales' : '/purchases';
  const { data: inv, error, setData } = useFetch<InvoiceDetail>(`${base}/${id}`);
  const lk = useLookups();
  if (!inv) return <Loading error={error} />;
  const typeList = isSale ? 'sales_type' : 'purchase_type';

  const remove = async () => {
    if (!confirm(t('Delete {no}? This cannot be undone.', { no: inv.invoice_no }))) return;
    try {
      await api.del(`${base}/${inv.id}`);
      toast(t('{no} deleted', { no: inv.invoice_no }));
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

  const partyLabel = inv.party_name || (isSale ? t('Unregistered buyer') : t('Unregistered seller'));

  return (
    <>
      <PrintInvoice inv={inv} />
      <div className="no-print">
      <PageHeader title={isSale ? t('Sale {no}', { no: inv.invoice_no }) : t('Purchase {no}', { no: inv.invoice_no })} subtitle={`${partyLabel} · ${date(inv.date)} · ${otherDate(inv.date)}`}>
        <Link className="btn" href={base}>{t('← Back')}</Link>
        <button className="btn" onClick={() => window.print()}>{isSale ? t('Print invoice') : t('Print voucher')}</button>
        {canFor(resource, 'edit', inv.party_id, updateGrant(inv.kind)[2]) && <button className="btn" onClick={toggleReported}>{inv.report_status === 'Reported' ? t('Mark not reported') : t('Mark reported')}</button>}
        {canFor(resource, 'edit', inv.party_id, updateGrant(inv.kind)[2]) && <Link className="btn" href={`${base}/${inv.id}/edit`}>{t('Edit')}</Link>}
        {canFor(resource, 'delete', inv.party_id) && <button className="btn btn-danger" onClick={remove}>{t('Delete')}</button>}
      </PageHeader>

      <div className="grid grid-2">
        <Card title={t('Receipt details')} actions={<TBadge value={inv.report_status} />}>
          <dl className="kv">
            <dt>{isSale ? t('Buyer') : t('Seller')}</dt><dd>{inv.party_name || '—'}</dd>
            <dt>{t('TIN')}</dt><dd>{inv.party_tin || '—'}</dd>
            <dt>{t('Payment type')}</dt><dd><TBadge value={inv.payment_type} /></dd>
            <dt>{t('Product type')}</dt><dd>{inv.vat_category === 'G' ? t('Goods') : t('Service')}</dd>
            <dt>{t('Date')}</dt><dd>{date(inv.date)} <span className="muted">({otherDate(inv.date)})</span></dd>
            <dt>{t('Tax month')}</dt><dd>{t(FY_MONTHS[inv.fy_month])} · {t('FY {fy}', { fy: inv.fy })}</dd>
            <dt>{t('Receipt type')}</dt><dd>{t(inv.receipt_type)}{inv.mrc_number ? ` · MRC ${inv.mrc_number}` : ''}</dd>
            <dt>{t('Receipt no.')}</dt><dd>{inv.vat_receipt_no}</dd>
            {inv.created_by && <><dt>{t('Recorded by')}</dt><dd>{inv.created_by}{inv.updated_by && inv.updated_by !== inv.created_by ? <span className="muted"> · {t('last edited by {user}', { user: inv.updated_by })}</span> : null}</dd></>}
            {inv.notes && <><dt>{t('Remark')}</dt><dd>{inv.notes}</dd></>}
          </dl>
        </Card>
        <Card title={t('Amounts')}>
          <div className="totals" style={{ width: '100%' }}>
            <div><span>{t('B · Total price')}</span><span>{money(inv.total_amount)}</span></div>
            <div><span>{t('D · Excise tax amount')}</span><span>{money(inv.excise_amount)}</span></div>
            <div><span>{t('E · Other vatable service fee')}</span><span>{money(inv.vatable_service_fee)}</span></div>
            <div className="muted"><span>{t('VAT base (B + D + E)')}</span><span>{money(inv.taxable_amount)}</span></div>
            <div><span>{t('F · VAT')}</span><span>{money(inv.vat_amount)}</span></div>
            <div><span>{t('G · Other non-vatable fee')}</span><span>{money(inv.non_vatable_fee)}</span></div>
            <div className="grand"><span>{t('H · Total price')}</span><span>{t('ETB')} {money(inv.grand_total)}</span></div>
          </div>
        </Card>
      </div>

      <Card className="mt" title={t('Items')} bodyClass="">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>#</th><th>{t('Code')}</th><th>{t('Item name')}</th><th>{t('Measurement')}</th><th>{isSale ? t('Type of sales') : t('Input category')}</th><th>{t('Tax type')}</th>
                <th className="num">{t('Qty')}</th><th className="num">{t('Unit price (A)')}</th><th className="num">{t('Total price (B)')}</th>
                <th className="num">{t('Excise (C · D)')}</th><th className="num">{t('Other vatable fee (E)')}</th><th className="num">{t('VAT (F)')}</th>
                <th className="num">{t('Other non-vatable fee (G)')}</th><th className="num">{t('Total price (H)')}</th>
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
