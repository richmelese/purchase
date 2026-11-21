'use client';

import { money, qty, date, otherDate, dateTime, amountInWords } from '@/lib/format';
import { FY_MONTHS } from '@/lib/shared/ethiopian';
import { useT } from '@/lib/i18n';
import type { InvoiceDetail } from '@/lib/types';
import { useFetch } from './ui';
import { useLookups } from './lookups';

export interface PrintInvoiceIssuer {
  company_name?: string;
  company_tin?: string;
  company_address?: string;
  wh_rate?: number;
}

/**
 * A4 document shown only when printing (Sales invoice / Purchase voucher).
 * `issuer` (letterhead: company_name, company_tin, company_address, wh_rate) skips loading /settings,
 * e.g. in the company portal.
 * Follows the chosen UI language; the amount in words (lib/format amountInWords) is English only.
 */
export default function PrintInvoice({ inv, issuer }: { inv: InvoiceDetail; issuer?: PrintInvoiceIssuer }) {
  const { data: fetched } = useFetch<PrintInvoiceIssuer>(issuer ? null : '/settings');
  const { t, lang } = useT();
  const s = issuer || fetched;
  const lk = useLookups();
  const isSale = inv.kind === 'S';
  const title = isSale ? t('SALES INVOICE') : t('PURCHASE VOUCHER');
  const partyWord = isSale ? t('Customer') : t('Supplier');
  const signs: [string, unknown?][] = [
    [t('Prepared by'), inv.created_by], [t('Checked by')], [t('Approved by')],
    [isSale ? t('Received by (customer)') : t('Received by (store)')],
  ];

  return (
    <div className="print-doc" aria-hidden="true">
      <header className="pd-head">
        <div>
          <div className="pd-company">{s?.company_name}</div>
          {s?.company_tin && <div>{t('TIN')}: {s.company_tin}</div>}
          {s?.company_address && <div>{s.company_address}</div>}
        </div>
        <div className="pd-title-box">
          <div className="pd-title">{title}</div>
          <table className="pd-meta">
            <tbody>
              <tr><th>{t('No.')}</th><td>{inv.invoice_no}</td></tr>
              <tr><th>{t('Date')}</th><td>{date(inv.date)}</td></tr>
              <tr><th>{t(lang === 'am' ? 'GC date' : 'E.C. date')}</th><td>{otherDate(inv.date)}</td></tr>
              <tr><th>{t('Tax month')}</th><td>{t(FY_MONTHS[inv.fy_month])} · {t('FY {fy}', { fy: inv.fy })}</td></tr>
            </tbody>
          </table>
        </div>
      </header>

      <section className="pd-parties">
        <div>
          <div className="pd-label">{partyWord}</div>
          <div className="pd-strong">{inv.party_name || '—'}</div>
          <div>{t('TIN')}: {inv.party_tin || '—'}</div>
        </div>
        <div>
          <div className="pd-label">{t('Receipt')}</div>
          <div>{t(inv.receipt_type)}{inv.mrc_number ? ` · MRC ${inv.mrc_number}` : ''}</div>
          <div>{t('Receipt no')}: {inv.vat_receipt_no}</div>
          <div>{t('Payment')}: {t(inv.payment_type)} · {inv.vat_category === 'G' ? t('Goods') : t('Service')}</div>
        </div>
      </section>

      <table className="pd-items">
        <thead>
          <tr>
            <th>#</th><th>{t('Code')}</th><th>{t('Item name')}</th><th>{t('Unit')}</th>
            <th className="num">{t('Qty')}</th><th className="num">{t('Unit price')}</th><th className="num">{t('Total price')}</th>
            <th className="num">{t('Excise')}</th><th className="num">{t('VAT')}</th><th className="num">{t('Total')}</th>
          </tr>
        </thead>
        <tbody>
          {inv.lines.map((l) => (
            <tr key={l.id}>
              <td>{l.line_no}</td>
              <td>{l.product_code}</td>
              <td>{l.description}</td>
              <td>{lk.unitLabel(l.unit)}</td>
              <td className="num">{qty(l.qty)}</td>
              <td className="num">{money(l.unit_price)}</td>
              <td className="num">{money(l.total)}</td>
              <td className="num">{money(l.excise_amount)}</td>
              <td className="num">{money(l.vat_amount)}</td>
              <td className="num">{money(l.line_total)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <section className="pd-bottom">
        <div className="pd-words">
          <div className="pd-label">{t('Amount in words')}</div>
          <div className="pd-strong">{amountInWords(inv.grand_total)}</div>
          {inv.wh.applicable && (
            <div className="pd-wh">
              {inv.wh.expected > 0
                ? <>
                    {t('Withholding tax ({status}): {amount} on {base}', { status: t(inv.wh.status), amount: money(inv.wh.expected), base: money(inv.wh.base) })}
                    {inv.wh_receipt_no ? ` · ${t('WH receipt {no}', { no: inv.wh_receipt_no })}` : ''}
                  </>
                : t('Subject to {rate}% withholding tax ({status}) on {base}.', {
                  rate: Math.round((+(s?.wh_rate ?? 0) || 0.03) * 1000) / 10, status: t(inv.wh.status), base: money(inv.wh.base),
                })}
            </div>
          )}
          {inv.notes && <div className="pd-notes">{t('Remark')}: {inv.notes}</div>}
        </div>
        <table className="pd-totals">
          <tbody>
            <tr><th>{t('Total price')}</th><td>{money(inv.total_amount)}</td></tr>
            {inv.excise_amount > 0 && <tr><th>{t('Excise tax')}</th><td>{money(inv.excise_amount)}</td></tr>}
            {inv.vatable_service_fee > 0 && <tr><th>{t('Other vatable service fee')}</th><td>{money(inv.vatable_service_fee)}</td></tr>}
            <tr><th>{t('VAT base')}</th><td>{money(inv.taxable_amount)}</td></tr>
            <tr><th>{t('VAT')}</th><td>{money(inv.vat_amount)}</td></tr>
            {inv.non_vatable_fee > 0 && <tr><th>{t('Other non-vatable fee')}</th><td>{money(inv.non_vatable_fee)}</td></tr>}
            <tr className="pd-grand"><th>{t('Total (ETB)')}</th><td>{money(inv.grand_total)}</td></tr>
            {inv.payment_type === 'Credit' && <tr><th>{t('Balance due')}</th><td>{money(inv.balance)}</td></tr>}
          </tbody>
        </table>
      </section>

      <section className="pd-signs">
        {signs.map(([label, name]) => (
          <div key={label}>
            <div className="pd-sign-name">{name ? String(name) : ''}</div>
            <div className="pd-sign-line">{label}</div>
            <div className="pd-sign-sub">{t('Signature & date')}</div>
          </div>
        ))}
      </section>

      <footer className="pd-foot">
        {t('Printed {when}', { when: dateTime(new Date()) })} · {s?.company_name} · {t(inv.report_status)}
      </footer>
    </div>
  );
}
