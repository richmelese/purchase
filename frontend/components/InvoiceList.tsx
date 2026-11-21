'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSession } from '@/components/session';
import { updateGrant } from '@/lib/permissions';
import { api, qs } from '@/lib/api';
import { money, date } from '@/lib/format';
import { FY_MONTHS } from '@/lib/shared/ethiopian';
import { useLookups } from './lookups';
import { PageHeader, Card, Loading, Empty, PeriodFilter, useFetch, useCurrentFy, useToast } from './ui';
import TBadge from './TBadge';
import { useT } from '@/lib/i18n';

interface InvoiceListRow {
  id: number;
  invoice_no: string;
  date: string;
  fy_month: number;
  party_name?: string | null;
  party_tin?: string | null;
  receipt_type: string;
  vat_receipt_no?: string | null;
  payment_type: string;
  balance: number;
  taxable_amount: number;
  vat_amount: number;
  grand_total: number;
  wh: { applicable: boolean; status: string; expected: number };
  report_status: string;
}

export default function InvoiceList({ kind }: { kind: 'P' | 'S' }) {
  const isSale = kind === 'S';
  const base = isSale ? '/sales' : '/purchases';
  const resource = isSale ? 'sales' : 'purchases';
  const { can } = useSession();
  const router = useRouter();
  const toast = useToast();
  const { t } = useT();
  const lk = useLookups();
  const currentFy = useCurrentFy();
  const [filter, setFilter] = useState<{ fy: number | null; month: number | ''; q: string; status: string; payment: string }>({ fy: null, month: '', q: '', status: '', payment: '' });
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<Set<number>>(new Set());

  useEffect(() => { if (currentFy && !filter.fy) setFilter((f) => ({ ...f, fy: currentFy })); }, [currentFy, filter.fy]);
  useEffect(() => {
    const timer = setTimeout(() => setFilter((f) => ({ ...f, q })), 250);
    return () => clearTimeout(timer);
  }, [q]);

  const { data, error, reload } = useFetch<InvoiceListRow[]>(filter.fy ? `${base}${qs(filter)}` : null);
  useEffect(() => setSelected(new Set()), [data]);

  const markStatus = async (status: string) => {
    try {
      await api.post(`${base}/report-status`, { ids: [...selected], status });
      toast(t('{n} marked as {status}', { n: selected.size, status: t(status) }));
      reload();
    } catch (e: any) {
      toast(e.message, 'error');
    }
  };

  const totals = (data || []).reduce((a, r) => ({
    taxable: a.taxable + r.taxable_amount, vat: a.vat + r.vat_amount, total: a.total + r.grand_total, wh: a.wh + r.wh.expected,
  }), { taxable: 0, vat: 0, total: 0, wh: 0 });
  const allChecked = (data?.length ?? 0) > 0 && selected.size === data!.length;

  return (
    <>
      <PageHeader title={isSale ? t('Sales') : t('Purchases')} subtitle={isSale ? t('Sales detail & summary (S. Detail / S. Summery)') : t('Purchase detail & summary (P. Detail / P. Summery)')}>
        {can(resource, 'export') && <a className="btn" href={`/api/export/${isSale ? 'sales' : 'purchases'}${qs({ fy: filter.fy, month: filter.month })}`}>{t('Export Excel')}</a>}
        {can(resource, 'create') && <Link className="btn btn-primary" href={`${base}/new`}>{isSale ? t('+ New sale') : t('+ New purchase')}</Link>}
      </PageHeader>

      <Card
        fill
        bodyClass=""
        title={(
          <div className="row">
            <PeriodFilter fy={filter.fy} month={filter.month} onChange={(p) => setFilter((f) => ({ ...f, ...p }))} />
            <select value={filter.payment} onChange={(e) => setFilter((f) => ({ ...f, payment: e.target.value }))} aria-label={t('Payment type')}>
              <option value="">{t('Cash & credit')}</option>
              {lk.options('payment_type').map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <select value={filter.status} onChange={(e) => setFilter((f) => ({ ...f, status: e.target.value }))} aria-label={t('Report status')}>
              <option value="">{t('Any status')}</option>
              {lk.options('report_status').map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <input type="search" placeholder={t('Search number, TIN, name, item…')} value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 260 }} />
          </div>
        )}
        actions={selected.size > 0 && can(...updateGrant(kind)) && (
          <>
            <span className="small muted">{t('{n} selected', { n: selected.size })}</span>
            <button className="btn btn-sm" onClick={() => markStatus('Reported')}>{t('Mark reported')}</button>
            <button className="btn btn-sm" onClick={() => markStatus('Not Reported')}>{t('Mark not reported')}</button>
          </>
        )}
      >
        {!data ? <Loading error={error} /> : !data.length ? (
          <Empty>{isSale ? t('No sales for this period.') : t('No purchases for this period.')} <Link href={`${base}/new`}>{t('Record one')}</Link>.</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th><input type="checkbox" checked={allChecked} onChange={() => setSelected(allChecked ? new Set() : new Set(data.map((r) => r.id)))} aria-label={t('Select all')} /></th>
                  <th>{t('ID')}</th>
                  <th>{t('Date')}</th>
                  <th>{t('Month')}</th>
                  <th>{isSale ? t('Buyer') : t('Seller')}</th>
                  <th>{t('TIN')}</th>
                  <th>{t('Receipt')}</th>
                  <th>{t('Payment')}</th>
                  <th className="num">{t('Taxable')}</th>
                  <th className="num">{t('VAT')}</th>
                  <th className="num">{t('Total')}</th>
                  <th>{t('WH')}</th>
                  <th>{t('Status')}</th>
                </tr>
              </thead>
              <tbody>
                {data.map((r) => (
                  <tr key={r.id} className="clickable" onClick={() => router.push(`${base}/${r.id}`)}>
                    <td onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={selected.has(r.id)} onChange={() => setSelected((s) => { const n = new Set(s); n.has(r.id) ? n.delete(r.id) : n.add(r.id); return n; })} aria-label={t('Select {no}', { no: r.invoice_no })} />
                    </td>
                    <td><Link href={`${base}/${r.id}`} onClick={(e) => e.stopPropagation()}>{r.invoice_no}</Link></td>
                    <td>{date(r.date)}</td>
                    <td>{t(FY_MONTHS[r.fy_month])}</td>
                    <td>{r.party_name || <span className="muted">—</span>}</td>
                    <td>{r.party_tin || ''}</td>
                    <td className="small">{t(r.receipt_type)} · {r.vat_receipt_no}</td>
                    <td>
                      <TBadge value={r.payment_type} />
                      {r.payment_type === 'Credit' && r.balance > 0.004 && <div className="small muted">{t('Due {amount}', { amount: money(r.balance) })}</div>}
                    </td>
                    <td className="num">{money(r.taxable_amount)}</td>
                    <td className="num">{money(r.vat_amount)}</td>
                    <td className="num"><strong>{money(r.grand_total)}</strong></td>
                    <td>{r.wh.applicable ? <TBadge value={r.wh.status} /> : <span className="muted small">{t('No WH')}</span>}</td>
                    <td><TBadge value={r.report_status} /></td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={8}>{isSale ? t('{n} sales', { n: data.length }) : t('{n} purchases', { n: data.length })}</td>
                  <td className="num">{money(totals.taxable)}</td>
                  <td className="num">{money(totals.vat)}</td>
                  <td className="num">{money(totals.total)}</td>
                  <td colSpan={2} className="small">{t('WH')} {money(totals.wh)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
