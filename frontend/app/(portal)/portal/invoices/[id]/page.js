'use client';

import { use } from 'react';
import Link from 'next/link';
import { Badge, Card, Loading, useFetch } from '@/components/ui';
import { usePortal } from '@/components/portal';
import { useLookups } from '@/components/lookups';
import PrintInvoice from '@/components/PrintInvoice';
import { money, qty, date, ecDate } from '@/lib/format';

export default function PortalInvoice({ params }) {
  const { id } = use(params);
  const { issuer } = usePortal();
  const lk = useLookups();
  const { data: inv, error } = useFetch(`/portal/invoices/${id}`);
  if (!inv) return <Loading error={error} />;
  const isSale = inv.kind === 'S';

  return (
    <>
      <div className="no-print portal-stack">
        <div className="row portal-crumbs">
          <Link href="/portal">← Back to overview</Link>
        </div>
        <div className="card portal-hero">
          <div>
            <div className="small muted">{isSale ? `Sale by ${issuer.company_name} to you` : `Purchase by ${issuer.company_name} from you`}</div>
            <h1>{isSale ? 'Sales invoice' : 'Purchase voucher'} {inv.invoice_no}</h1>
            <div className="row small muted">
              <span>{date(inv.date)} · {ecDate(inv.date)} E.C.</span>
              <Badge>{inv.payment_type}</Badge>
              <span>{inv.receipt_type} {inv.vat_receipt_no}</span>
            </div>
          </div>
          <button className="btn btn-primary" onClick={() => window.print()}>Print</button>
        </div>

        <Card title="Items" bodyClass="">
          <div className="table-wrap">
            <table>
              <thead><tr><th>#</th><th>Description</th><th>Unit</th><th className="num">Qty</th><th className="num">Unit price</th><th className="num">VAT</th><th className="num">Total</th></tr></thead>
              <tbody>
                {inv.lines.map((l) => (
                  <tr key={l.id}>
                    <td className="muted">{l.line_no}</td>
                    <td className="wrap">{l.description}{l.product_code ? <div className="small muted">{l.product_code}</div> : null}</td>
                    <td>{lk.unitLabel(l.unit)}</td>
                    <td className="num">{qty(l.qty)}</td>
                    <td className="num">{money(l.unit_price)}</td>
                    <td className="num">{money(l.vat_amount)}</td>
                    <td className="num">{money(l.line_total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <div className="grid grid-2">
          <Card title="Totals">
            <table className="portal-totals">
              <tbody>
                <tr><th>Total price</th><td>{money(inv.total_amount)}</td></tr>
                {inv.excise_amount > 0 && <tr><th>Excise tax</th><td>{money(inv.excise_amount)}</td></tr>}
                <tr><th>VAT base</th><td>{money(inv.taxable_amount)}</td></tr>
                <tr><th>VAT</th><td>{money(inv.vat_amount)}</td></tr>
                <tr className="grand"><th>Total (ETB)</th><td>{money(inv.grand_total)}</td></tr>
                {inv.wh?.expected > 0 && <tr><th>Withholding ({inv.wh.status})</th><td>− {money(inv.wh.expected)}</td></tr>}
                {inv.payment_type === 'Credit' && <tr className="grand"><th>Balance</th><td>{money(inv.balance)}</td></tr>}
              </tbody>
            </table>
          </Card>
          <Card title="Payments" bodyClass="">
            {inv.payment_type === 'Cash' ? <p className="card-body muted">Settled in cash on {date(inv.date)}.</p>
              : !inv.payments.length ? <p className="card-body muted">No payments recorded yet.</p> : (
                <div className="table-wrap">
                  <table>
                    <thead><tr><th>Date</th><th>Method</th><th>Reference</th><th className="num">Amount</th></tr></thead>
                    <tbody>
                      {inv.payments.map((p) => (
                        <tr key={p.id}><td>{date(p.date)}</td><td>{p.method}</td><td>{p.reference}</td><td className="num">{money(p.amount)}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
          </Card>
        </div>
      </div>
      <PrintInvoice inv={inv} issuer={issuer} />
    </>
  );
}
