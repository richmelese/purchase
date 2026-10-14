'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { qs } from '@/lib/api';
import { money, date } from '@/lib/format';
import { FY_MONTHS } from '@/lib/shared/ethiopian';
import { PageHeader, Card, Badge, Loading, Empty, PeriodFilter, useFetch, useCurrentFy } from '@/components/ui';
import { useSession } from '@/components/session';

export default function WithholdingPage() {
  const { can } = useSession();
  const currentFy = useCurrentFy();
  const [kind, setKind] = useState('P');
  const [period, setPeriod] = useState({ fy: null, month: '' });
  useEffect(() => { if (currentFy && !period.fy) setPeriod((p) => ({ ...p, fy: currentFy })); }, [currentFy, period.fy]);
  const { data, error } = useFetch(period.fy ? `/withholding/${kind === 'P' ? 'purchases' : 'sales'}${qs(period)}` : null);
  const base = kind === 'P' ? '/purchases' : '/sales';
  const sum = (f) => (data || []).reduce((a, r) => a + f(r), 0);

  return (
    <>
      <PageHeader title="Withholding tax" subtitle="Goods above 20,000 and services above 10,000 (taxable amount) are subject to 3% withholding">
        {can('withholding', 'export') && <a className="btn" href={`/api/export/withholding${qs(period)}`}>Export Excel</a>}
      </PageHeader>

      <div className="tabs">
        <button className={`tab ${kind === 'P' ? 'active' : ''}`} onClick={() => setKind('P')}>On purchases (we withhold)</button>
        <button className={`tab ${kind === 'S' ? 'active' : ''}`} onClick={() => setKind('S')}>On sales (withheld from us)</button>
      </div>

      <Card fill bodyClass="" title={<PeriodFilter fy={period.fy} month={period.month} onChange={setPeriod} />}>
        {!data ? <Loading error={error} /> : !data.length ? <Empty>No transactions subject to withholding in this period.</Empty> : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>ID</th><th>Date</th><th>Month</th><th>{kind === 'P' ? 'Seller' : 'Buyer'}</th><th>TIN</th>
                  <th>WH status</th><th>Receipt status</th><th className="num">WH base</th><th className="num">Expected</th>
                  <th>WH receipt</th><th>WH month</th><th className="num">Paid</th><th className="num">Outstanding</th><th>Check</th>
                </tr>
              </thead>
              <tbody>
                {data.map((r) => (
                  <tr key={r.id}>
                    <td><Link href={`${base}/${r.id}`}>{r.invoice_no}</Link></td>
                    <td>{date(r.date)}</td>
                    <td>{FY_MONTHS[r.fy_month]}</td>
                    <td>{r.party_name}</td>
                    <td>{r.party_tin}</td>
                    <td><Badge>{r.wh.status}</Badge></td>
                    <td>{r.wh_receipt_type || <span className="muted">Not set</span>}</td>
                    <td className="num">{money(r.wh.base)}</td>
                    <td className="num">{money(r.wh.expected)}</td>
                    <td>{r.wh_receipt_no ? `${r.wh_receipt_no} · ${date(r.wh_receipt_date)}` : <span className="muted">—</span>}</td>
                    <td>{r.wh_month}</td>
                    <td className="num">{money(r.wh.paid)}</td>
                    <td className="num" style={r.wh.outstanding > 0 ? { color: 'var(--bad)' } : undefined}>{money(r.wh.outstanding)}</td>
                    <td>{r.penalty ? <Badge>{r.penalty}</Badge> : ''}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={7}>{data.length} transactions</td>
                  <td className="num">{money(sum((r) => r.wh.base))}</td>
                  <td className="num">{money(sum((r) => r.wh.expected))}</td>
                  <td colSpan={2} />
                  <td className="num">{money(sum((r) => r.wh.paid))}</td>
                  <td className="num">{money(sum((r) => r.wh.outstanding))}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>
      <p className="small muted">Open a transaction to record its withholding receipt number, date and amount paid. A receipt dated in a different tax month than the transaction is flagged as a penalty risk.</p>
    </>
  );
}
