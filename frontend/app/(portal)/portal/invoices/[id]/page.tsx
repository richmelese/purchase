'use client';

import { use } from 'react';
import Link from 'next/link';
import { Badge, Card, Loading, useFetch } from '@/components/ui';
import { usePortal } from '@/components/portal';
import { useLookups } from '@/components/lookups';
import PrintInvoice, { type PrintInvoiceIssuer } from '@/components/PrintInvoice';
import { money, qty, date, otherDate } from '@/lib/format';
import type { InvoiceDetail } from '@/lib/types';
import { useT } from '@/lib/i18n';

export default function PortalInvoice({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { issuer } = usePortal();
  const lk = useLookups();
  const { t } = useT();
  const { data: inv, error } = useFetch<InvoiceDetail>(`/portal/invoices/${id}`);
  if (!inv) return <Loading error={error} />;
  const isSale = inv.kind === 'S';

  return (
    <>
      <div className="no-print portal-stack">
        <div className="row portal-crumbs">
          <Link href="/portal">← {t('Back to overview')}</Link>
        </div>
        <div className="card portal-hero">
          <div>
            <div className="small muted">{isSale ? t('Sale by {company} to you', { company: issuer.company_name }) : t('Purchase by {company} from you', { company: issuer.company_name })}</div>
            <h1>{isSale ? t('Sales invoice') : t('Purchase voucher')} {inv.invoice_no}</h1>
            <div className="row small muted">
              <span>{date(inv.date)} · {otherDate(inv.date)}</span>
              <Badge>{inv.payment_type}</Badge>
              <span>{t(inv.receipt_type)} {inv.vat_receipt_no}</span>
            </div>
          </div>
          <button className="btn btn-primary" onClick={() => window.print()}>{t('Print')}</button>
        </div>

        <Card title={t('Items')} bodyClass="">
          <div className="table-wrap">
            <table>
              <thead><tr><th>#</th><th>{t('Description')}</th><th>{t('Unit')}</th><th className="num">{t('Qty')}</th><th className="num">{t('Unit price')}</th><th className="num">{t('VAT')}</th><th className="num">{t('Total')}</th></tr></thead>
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
          <Card title={t('Totals')}>
            <table className="portal-totals">
              <tbody>
                <tr><th>{t('Total price')}</th><td>{money(inv.total_amount)}</td></tr>
                {inv.excise_amount > 0 && <tr><th>{t('Excise tax')}</th><td>{money(inv.excise_amount)}</td></tr>}
                <tr><th>{t('VAT base')}</th><td>{money(inv.taxable_amount)}</td></tr>
                <tr><th>{t('VAT')}</th><td>{money(inv.vat_amount)}</td></tr>
                <tr className="grand"><th>{t('Total (ETB)')}</th><td>{money(inv.grand_total)}</td></tr>
                {inv.wh?.expected > 0 && <tr><th>{t('Withholding ({status})', { status: t(inv.wh.status) })}</th><td>− {money(inv.wh.expected)}</td></tr>}
                {inv.payment_type === 'Credit' && <tr className="grand"><th>{t('Balance')}</th><td>{money(inv.balance)}</td></tr>}
              </tbody>
            </table>
          </Card>
          <Card title={t('Payments')} bodyClass="">
            {inv.payment_type === 'Cash' ? <p className="card-body muted">{t('Settled in cash on {date}.', { date: date(inv.date) })}</p>
              : !inv.payments.length ? <p className="card-body muted">{t('No payments recorded yet.')}</p> : (
                <div className="table-wrap">
                  <table>
                    <thead><tr><th>{t('Date')}</th><th>{t('Method')}</th><th>{t('Reference')}</th><th className="num">{t('Amount')}</th></tr></thead>
                    <tbody>
                      {inv.payments.map((p) => (
                        <tr key={p.id}><td>{date(p.date)}</td><td>{t(p.method || '')}</td><td>{p.reference}</td><td className="num">{money(p.amount)}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
          </Card>
        </div>
      </div>
      <PrintInvoice inv={inv} issuer={issuer as PrintInvoiceIssuer} />
    </>
  );
}
