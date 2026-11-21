'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useSession } from '@/components/session';
import { api } from '@/lib/api';
import { money, date, today } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { PageHeader, Card, Stat, Badge, Loading, Empty, Field, Select, Modal, useFetch, useToast } from '@/components/ui';
import type { Party } from '@/lib/types';

interface MergeModalProps {
  party: { id: number; name: string };
  onClose: () => void;
}

/** Picks the surviving party and confirms the merge; `party` is `{ id, name }` of the one being merged away. */
function MergeModal({ party, onClose }: MergeModalProps) {
  const router = useRouter();
  const toast = useToast();
  const { t } = useT();
  const { data: parties } = useFetch<Party[]>('/parties');
  const [intoId, setIntoId] = useState('');
  const [busy, setBusy] = useState(false);

  const candidates = (parties || []).filter((p) => p.id !== party.id);
  const options = candidates.map((p) => ({ value: p.id, label: `${p.name}${p.tin ? ` · ${t('TIN')} ${p.tin}` : ''}` }));
  const target = candidates.find((p) => p.id === Number(intoId));

  const merge = async () => {
    if (!intoId || !target) return;
    if (!confirm(t('Merge "{from}" into "{into}"? This cannot be undone.', { from: party.name, into: target.name }))) return;
    setBusy(true);
    try {
      await api.post(`/parties/${party.id}/merge`, { into_id: Number(intoId) });
      toast(t('{from} merged into {into}', { from: party.name, into: target.name }));
      router.push(`/parties/${intoId}`);
    } catch (e: any) {
      toast(e.message, 'error');
      setBusy(false);
    }
  };

  return (
    <Modal
      icon="suppliers"
      title={t('Merge into another party')}
      subtitle={t('"{name}" will be kept only as history; its purchases and sales move to the party you pick.', { name: party.name })}
      onClose={onClose}
      footer={(
        <>
          <button className="btn" onClick={onClose}>{t('Cancel')}</button>
          <button className="btn btn-primary" onClick={merge} disabled={!intoId || busy}>{busy ? t('Merging…') : t('Merge')}</button>
        </>
      )}
    >
      {!parties ? <Loading /> : !options.length ? <Empty>{t('No other companies to merge into.')}</Empty> : (
        <Field label={t('Merge into')} hint={t('Pick the party that should survive the merge.')}>
          <Select placeholder={t('Select a party…')} options={options} value={intoId} onChange={setIntoId} />
        </Field>
      )}
    </Modal>
  );
}

interface LedgerRow {
  date: string;
  type: string;
  ref: string;
  detail?: string | null;
  invoice_id: number;
  charge?: number;
  payment?: number;
  balance: number;
}

interface LedgerProps {
  title: string;
  rows: LedgerRow[];
  kind: 'P' | 'S';
  outstanding: number;
}

function Ledger({ title, rows, kind, outstanding }: LedgerProps) {
  const { t } = useT();
  if (!rows.length) return null;
  const base = kind === 'P' ? '/purchases' : '/sales';
  return (
    <Card className="mt statement-card" bodyClass="" title={title} actions={<span className="small">{t('Outstanding')} <strong>ETB {money(outstanding)}</strong></span>}>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{t('Date')}</th><th>{t('Type')}</th><th>{t('Reference')}</th><th>{t('Details')}</th>
              <th className="num">{kind === 'P' ? t('Amount owed') : t('Amount charged')}</th>
              <th className="num">{kind === 'P' ? t('Paid') : t('Received')}</th>
              <th className="num">{t('Balance')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td>{date(r.date)}</td>
                <td><Badge tone={r.charge ? 'info' : 'good'}>{t(r.type)}</Badge></td>
                <td><Link href={`${base}/${r.invoice_id}`}>{r.ref}</Link></td>
                <td className="small">{r.detail ? t(r.detail) : r.detail}</td>
                <td className="num">{r.charge ? money(r.charge) : ''}</td>
                <td className="num">{r.payment ? money(r.payment) : ''}</td>
                <td className="num"><strong>{money(r.balance)}</strong></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

interface StatementTotals {
  purchased: number;
  purchaseCount: number;
  whWithheld: number;
  payable: number;
  sold: number;
  saleCount: number;
  whByCustomer: number;
  receivable: number;
}

interface StatementParty {
  name: string;
  tin: string | null;
  type: string;
  mrc1?: string | null;
  mrc2?: string | null;
  mrc3?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
}

interface StatementData {
  party: StatementParty;
  totals: StatementTotals;
  purchases: LedgerRow[];
  sales: LedgerRow[];
}

interface SettingsData {
  company_name?: string;
  company_tin?: string;
  [key: string]: unknown;
}

export default function StatementPage() {
  const { can, canFor } = useSession();
  const { t } = useT();
  const { id } = useParams<{ id: string }>();
  const partyId = Number(id);
  const { data, error } = useFetch<StatementData>(`/parties/${id}/statement`);
  const { data: full } = useFetch<Party>(`/parties/${id}`);
  const { data: s } = useFetch<SettingsData>('/settings');
  const [printedOn] = useState(today());
  const [merging, setMerging] = useState(false);
  if (!data) return <Loading error={error} />;
  const { party, totals } = data;
  const mergedIntoId = full?.merged_into_id ?? null;

  return (
    <>
      <div className="print-only statement-head">
        <div className="pd-company">{s?.company_name}</div>
        {s?.company_tin && <div>{t('TIN')}: {s.company_tin}</div>}
        <h2 style={{ margin: '12px 0 2px' }}>{t('Statement of account – {name}', { name: party.name })}</h2>
        <div>{t('TIN {tin} · printed {date}', { tin: party.tin || '—', date: date(printedOn) })}</div>
      </div>

      {mergedIntoId != null && (
        <div className="alert alert-warn no-print">
          {t('This company was merged into another party and is kept only as history.')}{' '}
          <Link href={`/parties/${mergedIntoId}`}>{t('View the surviving party →')}</Link>
        </div>
      )}

      <PageHeader title={party.name} subtitle={t('Statement of account · TIN {tin} · {type}', { tin: party.tin || '—', type: t(party.type) })}>
        <Link className="btn" href="/parties">{t('← Customer list')}</Link>
        <button className="btn" onClick={() => window.print()}>{t('Print statement')}</button>
        <Link className="btn" href="/purchases/new">{t('+ Purchase')}</Link>
        {can('sales', 'create') && <Link className="btn btn-primary" href="/sales/new">{t('+ Sale')}</Link>}
        {mergedIntoId == null && canFor('parties', 'delete', partyId) && (
          <button className="btn" onClick={() => setMerging(true)}>{t('Merge into another party…')}</button>
        )}
      </PageHeader>

      {merging && <MergeModal party={{ id: partyId, name: party.name }} onClose={() => setMerging(false)} />}

      <div className="grid grid-4">
        <Stat label={t('Total purchased from them')} value={`ETB ${money(totals.purchased)}`} sub={t('{n} receipts · WH withheld {amount}', { n: totals.purchaseCount, amount: money(totals.whWithheld) })} />
        <Stat label={t('We owe them (payable)')} value={`ETB ${money(totals.payable)}`} tone={totals.payable > 0 ? 'bad' : undefined} />
        <Stat label={t('Total sold to them')} value={`ETB ${money(totals.sold)}`} sub={t('{n} invoices · WH by customer {amount}', { n: totals.saleCount, amount: money(totals.whByCustomer) })} />
        <Stat label={t('They owe us (receivable)')} value={`ETB ${money(totals.receivable)}`} tone={totals.receivable > 0 ? 'bad' : undefined} />
      </div>

      <Card className="mt" title={t('Company details')}>
        <dl className="kv">
          <dt>{t('TIN')}</dt><dd>{party.tin || '—'}</dd>
          <dt>{t('MRC numbers')}</dt><dd>{[party.mrc1, party.mrc2, party.mrc3].filter(Boolean).join(', ') || '—'}</dd>
          <dt>{t('Phone')}</dt><dd>{party.phone || '—'}</dd>
          <dt>{t('Email')}</dt><dd>{party.email || '—'}</dd>
          <dt>{t('Address')}</dt><dd>{party.address || '—'}</dd>
        </dl>
      </Card>

      {!data.purchases.length && !data.sales.length && <Card className="mt"><Empty>{t('No transactions with this company yet.')}</Empty></Card>}
      <Ledger title={t('Purchases & payments (payable)')} rows={data.purchases} kind="P" outstanding={totals.payable} />
      <Ledger title={t('Sales & receipts (receivable)')} rows={data.sales} kind="S" outstanding={totals.receivable} />
      <p className="small muted no-print">{t('Amounts are invoice totals less withholding tax. Cash transactions are shown as settled on the same day.')}</p>
    </>
  );
}
