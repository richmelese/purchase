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
import { PageHeader, Card, Badge, Loading, Empty, PeriodFilter, useFetch, useCurrentFy, useToast } from './ui';

export default function InvoiceList({ kind }) {
  const isSale = kind === 'S';
  const base = isSale ? '/sales' : '/purchases';
  const resource = isSale ? 'sales' : 'purchases';
  const { can } = useSession();
  const router = useRouter();
  const toast = useToast();
  const lk = useLookups();
  const currentFy = useCurrentFy();
  const [filter, setFilter] = useState({ fy: null, month: '', q: '', status: '', payment: '' });
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState(new Set());

  useEffect(() => { if (currentFy && !filter.fy) setFilter((f) => ({ ...f, fy: currentFy })); }, [currentFy, filter.fy]);
  useEffect(() => {
    const t = setTimeout(() => setFilter((f) => ({ ...f, q })), 250);
    return () => clearTimeout(t);
  }, [q]);

  const { data, error, reload } = useFetch(filter.fy ? `${base}${qs(filter)}` : null);
  useEffect(() => setSelected(new Set()), [data]);

  const markStatus = async (status) => {
    try {
      await api.post(`${base}/report-status`, { ids: [...selected], status });
      toast(`${selected.size} marked as ${status}`);
      reload();
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  const totals = (data || []).reduce((a, r) => ({
    taxable: a.taxable + r.taxable_amount, vat: a.vat + r.vat_amount, total: a.total + r.grand_total, wh: a.wh + r.wh.expected,
  }), { taxable: 0, vat: 0, total: 0, wh: 0 });
  const allChecked = data?.length > 0 && selected.size === data.length;

  return (
    <>
      <PageHeader title={isSale ? 'Sales' : 'Purchases'} subtitle={isSale ? 'Sales detail & summary (S. Detail / S. Summery)' : 'Purchase detail & summary (P. Detail / P. Summery)'}>
        {can(resource, 'export') && <a className="btn" href={`/api/export/${isSale ? 'sales' : 'purchases'}${qs({ fy: filter.fy, month: filter.month })}`}>Export Excel</a>}
        {can(resource, 'create') && <Link className="btn btn-primary" href={`${base}/new`}>+ New {isSale ? 'sale' : 'purchase'}</Link>}
      </PageHeader>

      <Card
        fill
        bodyClass=""
        title={(
          <div className="row">
            <PeriodFilter fy={filter.fy} month={filter.month} onChange={(p) => setFilter((f) => ({ ...f, ...p }))} />
            <select value={filter.payment} onChange={(e) => setFilter((f) => ({ ...f, payment: e.target.value }))} aria-label="Payment type">
              <option value="">Cash & credit</option>
              {lk.options('payment_type').map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <select value={filter.status} onChange={(e) => setFilter((f) => ({ ...f, status: e.target.value }))} aria-label="Report status">
              <option value="">Any status</option>
              {lk.options('report_status').map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <input type="search" placeholder="Search number, TIN, name, item…" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 260 }} />
          </div>
        )}
        actions={selected.size > 0 && can(...updateGrant(kind)) && (
          <>
            <span className="small muted">{selected.size} selected</span>
            <button className="btn btn-sm" onClick={() => markStatus('Reported')}>Mark reported</button>
            <button className="btn btn-sm" onClick={() => markStatus('Not Reported')}>Mark not reported</button>
          </>
        )}
      >
        {!data ? <Loading error={error} /> : !data.length ? (
          <Empty>No {isSale ? 'sales' : 'purchases'} for this period. <Link href={`${base}/new`}>Record one</Link>.</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th><input type="checkbox" checked={allChecked} onChange={() => setSelected(allChecked ? new Set() : new Set(data.map((r) => r.id)))} aria-label="Select all" /></th>
                  <th>ID</th>
                  <th>Date</th>
                  <th>Month</th>
                  <th>{isSale ? 'Buyer' : 'Seller'}</th>
                  <th>TIN</th>
                  <th>Receipt</th>
                  <th>Payment</th>
                  <th className="num">Taxable</th>
                  <th className="num">VAT</th>
                  <th className="num">Total</th>
                  <th>WH</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {data.map((r) => (
                  <tr key={r.id} className="clickable" onClick={() => router.push(`${base}/${r.id}`)}>
                    <td onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={selected.has(r.id)} onChange={() => setSelected((s) => { const n = new Set(s); n.has(r.id) ? n.delete(r.id) : n.add(r.id); return n; })} aria-label={`Select ${r.invoice_no}`} />
                    </td>
                    <td><Link href={`${base}/${r.id}`} onClick={(e) => e.stopPropagation()}>{r.invoice_no}</Link></td>
                    <td>{date(r.date)}</td>
                    <td>{FY_MONTHS[r.fy_month]}</td>
                    <td>{r.party_name || <span className="muted">—</span>}</td>
                    <td>{r.party_tin || ''}</td>
                    <td className="small">{r.receipt_type} · {r.vat_receipt_no}</td>
                    <td>
                      <Badge>{r.payment_type}</Badge>
                      {r.payment_type === 'Credit' && r.balance > 0.004 && <div className="small muted">Due {money(r.balance)}</div>}
                    </td>
                    <td className="num">{money(r.taxable_amount)}</td>
                    <td className="num">{money(r.vat_amount)}</td>
                    <td className="num"><strong>{money(r.grand_total)}</strong></td>
                    <td>{r.wh.applicable ? <Badge>{r.wh.status}</Badge> : <span className="muted small">No WH</span>}</td>
                    <td><Badge>{r.report_status}</Badge></td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={8}>{data.length} {isSale ? 'sales' : 'purchases'}</td>
                  <td className="num">{money(totals.taxable)}</td>
                  <td className="num">{money(totals.vat)}</td>
                  <td className="num">{money(totals.total)}</td>
                  <td colSpan={2} className="small">WH {money(totals.wh)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
