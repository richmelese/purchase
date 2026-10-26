'use client';

import { money, qty, date, ecDate, amountInWords } from '@/lib/format';
import { FY_MONTHS } from '@/lib/shared/ethiopian';
import { useFetch } from './ui';
import { useLookups } from './lookups';

/**
 * A4 document shown only when printing (Sales invoice / Purchase voucher).
 * `issuer` (letterhead: company_name, company_tin, company_address, wh_rate) skips loading /settings,
 * e.g. in the company portal.
 */
export default function PrintInvoice({ inv, issuer }) {
  const { data: fetched } = useFetch(issuer ? null : '/settings');
  const s = issuer || fetched;
  const lk = useLookups();
  const isSale = inv.kind === 'S';
  const title = isSale ? 'SALES INVOICE' : 'PURCHASE VOUCHER';
  const partyWord = isSale ? 'Customer' : 'Supplier';

  return (
    <div className="print-doc" aria-hidden="true">
      <header className="pd-head">
        <div>
          <div className="pd-company">{s?.company_name}</div>
          {s?.company_tin && <div>TIN: {s.company_tin}</div>}
          {s?.company_address && <div>{s.company_address}</div>}
        </div>
        <div className="pd-title-box">
          <div className="pd-title">{title}</div>
          <table className="pd-meta">
            <tbody>
              <tr><th>No.</th><td>{inv.invoice_no}</td></tr>
              <tr><th>Date</th><td>{date(inv.date)}</td></tr>
              <tr><th>E.C. date</th><td>{ecDate(inv.date)}</td></tr>
              <tr><th>Tax month</th><td>{FY_MONTHS[inv.fy_month]} · FY {inv.fy}</td></tr>
            </tbody>
          </table>
        </div>
      </header>

      <section className="pd-parties">
        <div>
          <div className="pd-label">{partyWord}</div>
          <div className="pd-strong">{inv.party_name || '—'}</div>
          <div>TIN: {inv.party_tin || '—'}</div>
        </div>
        <div>
          <div className="pd-label">Receipt</div>
          <div>{inv.receipt_type}{inv.mrc_number ? ` · MRC ${inv.mrc_number}` : ''}</div>
          <div>Receipt no: {inv.vat_receipt_no}</div>
          <div>Payment: {inv.payment_type} · {inv.vat_category === 'G' ? 'Goods' : 'Service'}</div>
        </div>
      </section>

      <table className="pd-items">
        <thead>
          <tr>
            <th>#</th><th>Code</th><th>Item name</th><th>Unit</th>
            <th className="num">Qty</th><th className="num">Unit price</th><th className="num">Total price</th>
            <th className="num">Excise</th><th className="num">VAT</th><th className="num">Total</th>
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
          <div className="pd-label">Amount in words</div>
          <div className="pd-strong">{amountInWords(inv.grand_total)}</div>
          {inv.wh.applicable && (
            <div className="pd-wh">
              {inv.wh.expected > 0
                ? <>Withholding tax ({inv.wh.status}): {money(inv.wh.expected)} on {money(inv.wh.base)}{inv.wh_receipt_no ? ` · WH receipt ${inv.wh_receipt_no}` : ''}</>
                : <>Subject to {Math.round((+s?.wh_rate || 0.03) * 1000) / 10}% withholding tax ({inv.wh.status}) on {money(inv.wh.base)}.</>}
            </div>
          )}
          {inv.notes && <div className="pd-notes">Remark: {inv.notes}</div>}
        </div>
        <table className="pd-totals">
          <tbody>
            <tr><th>Total price</th><td>{money(inv.total_amount)}</td></tr>
            {inv.excise_amount > 0 && <tr><th>Excise tax</th><td>{money(inv.excise_amount)}</td></tr>}
            {inv.vatable_service_fee > 0 && <tr><th>Other vatable service fee</th><td>{money(inv.vatable_service_fee)}</td></tr>}
            <tr><th>VAT base</th><td>{money(inv.taxable_amount)}</td></tr>
            <tr><th>VAT</th><td>{money(inv.vat_amount)}</td></tr>
            {inv.non_vatable_fee > 0 && <tr><th>Other non-vatable fee</th><td>{money(inv.non_vatable_fee)}</td></tr>}
            <tr className="pd-grand"><th>Total (ETB)</th><td>{money(inv.grand_total)}</td></tr>
            {inv.payment_type === 'Credit' && <tr><th>Balance due</th><td>{money(inv.balance)}</td></tr>}
          </tbody>
        </table>
      </section>

      <section className="pd-signs">
        {[['Prepared by', inv.created_by], ['Checked by'], ['Approved by'], [isSale ? 'Received by (customer)' : 'Received by (store)']].map(([label, name]) => (
          <div key={label}>
            <div className="pd-sign-name">{name || ''}</div>
            <div className="pd-sign-line">{label}</div>
            <div className="pd-sign-sub">Signature &amp; date</div>
          </div>
        ))}
      </section>

      <footer className="pd-foot">
        Printed {new Date().toLocaleString()} · {s?.company_name} · {inv.report_status}
      </footer>
    </div>
  );
}
