'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { qs } from '@/lib/api';
import { money, date } from '@/lib/format';
import { FY_MONTHS } from '@/lib/shared/ethiopian';
import { PageHeader, Card, Loading, Empty, PeriodFilter, useFetch, useCurrentFy, type PeriodValue } from '@/components/ui';
import { useSession } from '@/components/session';
import TBadge from '@/components/TBadge';
import { useT } from '@/lib/i18n';

interface WithholdingInfo {
  status: string;
  base: number;
  expected: number;
  paid: number;
  outstanding: number;
}

interface WithholdingRow {
  id: number;
  invoice_no: string;
  date: string;
  fy_month: number;
  party_name: string | null;
  party_tin: string | null;
  wh: WithholdingInfo;
  wh_receipt_type: string | null;
  wh_receipt_no: string | null;
  wh_receipt_date: string | null;
  wh_month: number | string | null;
  penalty: string | null;
}

export default function WithholdingPage() {
  const { can } = useSession();
  const { t } = useT();
  const currentFy = useCurrentFy();
  const [kind, setKind] = useState<'P' | 'S'>('P');
  const [period, setPeriod] = useState<PeriodValue>({ fy: null as unknown as number, month: '' });
  useEffect(() => { if (currentFy && !period.fy) setPeriod((p) => ({ ...p, fy: currentFy })); }, [currentFy, period.fy]);
  const { data, error } = useFetch<WithholdingRow[]>(period.fy ? `/withholding/${kind === 'P' ? 'purchases' : 'sales'}${qs(period)}` : null);
  const base = kind === 'P' ? '/purchases' : '/sales';
  const sum = (f: (r: WithholdingRow) => number) => (data || []).reduce((a, r) => a + f(r), 0);

  return (
    <>
      <PageHeader title={t('Withholding tax')} subtitle={t('Goods above 20,000 and services above 10,000 (taxable amount) are subject to 3% withholding')}>
        {can('withholding', 'export') && <a className="btn" href={`/api/export/withholding${qs(period)}`}>{t('Export Excel')}</a>}
      </PageHeader>

      <div className="tabs">
        <button className={`tab ${kind === 'P' ? 'active' : ''}`} onClick={() => setKind('P')}>{t('On purchases (we withhold)')}</button>
        <button className={`tab ${kind === 'S' ? 'active' : ''}`} onClick={() => setKind('S')}>{t('On sales (withheld from us)')}</button>
      </div>

      <Card fill bodyClass="" title={<PeriodFilter fy={period.fy} month={period.month} onChange={setPeriod} />}>
        {!data ? <Loading error={error} /> : !data.length ? <Empty>{t('No transactions subject to withholding in this period.')}</Empty> : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t('ID')}</th><th>{t('Date')}</th><th>{t('Month')}</th><th>{kind === 'P' ? t('Seller') : t('Buyer')}</th><th>{t('TIN')}</th>
                  <th>{t('WH status')}</th><th>{t('Receipt status')}</th><th className="num">{t('WH base')}</th><th className="num">{t('Expected')}</th>
                  <th>{t('WH receipt')}</th><th>{t('WH month')}</th><th className="num">{t('Paid')}</th><th className="num">{t('Outstanding')}</th><th>{t('Check')}</th>
                </tr>
              </thead>
              <tbody>
                {data.map((r) => (
                  <tr key={r.id}>
                    <td><Link href={`${base}/${r.id}`}>{r.invoice_no}</Link></td>
                    <td>{date(r.date)}</td>
                    <td>{t(FY_MONTHS[r.fy_month])}</td>
                    <td>{r.party_name}</td>
                    <td>{r.party_tin}</td>
                    <td><TBadge value={r.wh.status} /></td>
                    <td>{r.wh_receipt_type ? t(r.wh_receipt_type) : <span className="muted">{t('Not set')}</span>}</td>
                    <td className="num">{money(r.wh.base)}</td>
                    <td className="num">{money(r.wh.expected)}</td>
                    <td>{r.wh_receipt_no ? `${r.wh_receipt_no} · ${date(r.wh_receipt_date)}` : <span className="muted">—</span>}</td>
                    <td>{r.wh_month != null && r.wh_month !== '' ? t(String(r.wh_month)) : ''}</td>
                    <td className="num">{money(r.wh.paid)}</td>
                    <td className="num" style={r.wh.outstanding > 0 ? { color: 'var(--bad)' } : undefined}>{money(r.wh.outstanding)}</td>
                    <td>{r.penalty ? <TBadge value={r.penalty} /> : ''}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={7}>{t('{n} transactions', { n: data.length })}</td>
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
      <p className="small muted">{t('Open a transaction to record its withholding receipt number, date and amount paid. A receipt dated in a different tax month than the transaction is flagged as a penalty risk.')}</p>
    </>
  );
}
