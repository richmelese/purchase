'use client';

import { useState } from 'react';
import { api, type ApiError } from '@/lib/api';
import { useSession } from '@/components/session';
import { money, qty, date, today } from '@/lib/format';
import Link from 'next/link';
import { useT } from '@/lib/i18n';
import { useLookups } from '@/components/lookups';
import { PageHeader, Card, Badge, Loading, Empty, Field, Select, Modal, useFetch, useToast } from '@/components/ui';
import type { Product } from '@/lib/types';
import DateInput from '@/components/DateInput';

interface StockRow extends Product {
  stock_in: number;
  stock_out: number;
  status: string;
  unit_cost: number;
  stock_value: number;
}

interface IssueRow {
  id: number;
  issue_no: string;
  date: string;
  code: string;
  name_en: string;
  qty: number;
  department?: string | null;
  purpose?: string | null;
  approved_by?: string | null;
}

interface StockInRow {
  invoice_id: number;
  purchase_code: string;
  product_code: string;
  date: string;
  grn_no?: string | null;
  product_name: string;
  supplier_tin?: string | null;
  supplier_name?: string | null;
  quantity: number;
  unit_cost: number;
  total_cost: number;
  remark?: string | null;
}

interface StockOutRow {
  date: string;
  source: string;
  ref_id: number;
  ref_no: string;
  product_code: string;
  product_name: string;
  issued_to?: string | null;
  quantity: number;
  purpose?: string | null;
  approved_by?: string | null;
}

interface RegView<T> {
  data: T[] | null;
  error: ApiError | null;
}

/** Badge colour by the (English) stock status, so the tone survives translation of the label. */
const STATUS_TONE: Record<string, string> = { 'In stock': 'good', 'Low stock': 'warn', 'Out of stock': 'bad' };

function IssueModal({ products, onClose, onSaved }: { products: StockRow[]; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const { t } = useT();
  const { options, unitLabel } = useLookups();
  const [f, setF] = useState({ date: today(), product_id: '', qty: 1, department: '', purpose: '', approved_by: '' });
  const [err, setErr] = useState<Record<string, string>>({});
  const product = products.find((p) => p.id === +f.product_id);
  const save = async () => {
    try {
      const r = await api.post<{ issue_no: string }>('/issues', f);
      toast(t('Issue {no} recorded', { no: r.issue_no }));
      onSaved();
    } catch (e: any) { setErr({ ...(e.fields || {}), _: e.message }); }
  };
  return (
    <Modal title={t('Issue stock')} onClose={onClose} footer={<><button className="btn" onClick={onClose}>{t('Cancel')}</button><button className="btn btn-primary" onClick={save}>{t('Save issue')}</button></>}>
      {err._ && <div className="alert alert-error">{err._}</div>}
      <div className="form-grid" style={{ gridTemplateColumns: 'repeat(2, minmax(0,1fr))' }}>
        <Field label={t('Product')} required error={err.product_id} className="span-4" hint={product ? t('Available: {qty} {unit}', { qty: qty(product.current_stock), unit: unitLabel(product.unit) }) : ''}>
          <select value={f.product_id} onChange={(e) => setF({ ...f, product_id: e.target.value })}>
            <option value="">{t('Select a product…')}</option>
            {products.filter((p) => p.track_stock).map((p) => <option key={p.id} value={p.id}>{p.code} – {p.name_en} ({qty(p.current_stock)})</option>)}
          </select>
        </Field>
        <Field label={t('Date')} required error={err.date}><DateInput value={f.date} invalid={!!err.date} onChange={(v) => setF({ ...f, date: v })} /></Field>
        <Field label={t('Quantity')} required error={err.qty}><input type="number" step="any" min="0" value={f.qty} onChange={(e) => setF({ ...f, qty: +e.target.value })} /></Field>
        <Field label={t('Department')}><Select options={options('department')} placeholder={t('Select department')} value={f.department} onChange={(v) => setF({ ...f, department: v })} /></Field>
        <Field label={t('Approved by')}><input value={f.approved_by} onChange={(e) => setF({ ...f, approved_by: e.target.value })} /></Field>
        <Field label={t('Purpose')} className="span-4"><input value={f.purpose} onChange={(e) => setF({ ...f, purpose: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

export default function InventoryPage() {
  const { can } = useSession();
  const toast = useToast();
  const { t } = useT();
  const { unitLabel } = useLookups();
  const [tab, setTab] = useState<'stock' | 'in' | 'out' | 'issues'>('stock');
  const [q, setQ] = useState('');
  const [onlyLow, setOnlyLow] = useState(false);
  const [issuing, setIssuing] = useState(false);
  const stock = useFetch<StockRow[]>('/products');
  const issues = useFetch<IssueRow[]>('/issues');
  const inReg = useFetch<StockInRow[]>(tab === 'in' ? '/stock/in' : null);
  const outReg = useFetch<StockOutRow[]>(tab === 'out' ? '/stock/out' : null);

  const rows = (stock.data || []).filter((p) => p.track_stock)
    .filter((p) => !onlyLow || p.status === 'Low stock' || p.status === 'Out of stock')
    .filter((p) => !q || `${p.code} ${p.name_en} ${p.category || ''} ${p.brand || ''}`.toLowerCase().includes(q.toLowerCase()));
  const value = rows.reduce((a, r) => a + r.stock_value, 0);

  const removeIssue = async (id: number) => {
    if (!confirm(t('Delete this issue? The quantity returns to stock.'))) return;
    try {
      await api.del(`/issues/${id}`);
      issues.reload(); stock.reload();
    } catch (e: any) {
      toast(e.message, 'error');
    }
  };

  return (
    <>
      <PageHeader title={t('Inventory')} subtitle={t('Current stock = opening stock + purchases − sales − internal issues')}>
        {can('inventory', 'export') && <a className="btn" href="/api/export/stock">{t('Export Excel')}</a>}
        {can('inventory', 'create') && <button className="btn btn-primary" onClick={() => setIssuing(true)}>{t('Issue stock')}</button>}
      </PageHeader>
      <div className="tabs">
        <button className={`tab ${tab === 'stock' ? 'active' : ''}`} onClick={() => setTab('stock')}>{t('Current stock')}</button>
        <button className={`tab ${tab === 'in' ? 'active' : ''}`} onClick={() => setTab('in')}>{t('Stock IN (purchase register)')}</button>
        <button className={`tab ${tab === 'out' ? 'active' : ''}`} onClick={() => setTab('out')}>{t('Stock Out')}</button>
        <button className={`tab ${tab === 'issues' ? 'active' : ''}`} onClick={() => setTab('issues')}>{t('Issue register')}</button>
      </div>

      {tab === 'in' && <StockIn reg={inReg} />}
      {tab === 'out' && <StockOut reg={outReg} />}
      {tab === 'stock' ? (
        <Card fill bodyClass="" title={(
          <div className="row">
            <input type="search" placeholder={t('Search code, name, category…')} value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 280 }} />
            <label className="check small"><input type="checkbox" checked={onlyLow} onChange={(e) => setOnlyLow(e.target.checked)} />{t('Only low / out of stock')}</label>
          </div>
        )} actions={<span className="small muted">{t('Stock value')} <strong>ETB {money(value)}</strong></span>}>
          {!stock.data ? <Loading error={stock.error} /> : !rows.length ? <Empty>{t('No stock items match.')}</Empty> : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>{t('Code')}</th><th>{t('Product')}</th><th>{t('Category')}</th><th>{t('Unit')}</th><th className="num">{t('Opening')}</th><th className="num">{t('In')}</th><th className="num">{t('Out')}</th><th className="num">{t('Remaining')}</th><th className="num">{t('Min')}</th><th className="num">{t('Avg cost')}</th><th className="num">{t('Stock value')}</th><th>{t('Status')}</th></tr>
                </thead>
                <tbody>
                  {rows.map((p) => (
                    <tr key={p.id}>
                      <td>{p.code}</td><td className="wrap">{p.name_en}{p.name_am ? <div className="small muted">{p.name_am}</div> : null}</td>
                      <td>{p.category ? t(p.category) : p.category}</td><td>{p.unit ? `${p.unit} – ${unitLabel(p.unit)}` : ''}</td>
                      <td className="num">{qty(p.opening_stock)}</td><td className="num">{qty(p.stock_in)}</td><td className="num">{qty(p.stock_out)}</td>
                      <td className="num"><strong>{qty(p.current_stock)}</strong></td><td className="num">{qty(p.min_stock)}</td>
                      <td className="num">{money(p.unit_cost)}</td><td className="num">{money(p.stock_value)}</td>
                      <td><Badge tone={STATUS_TONE[p.status]}>{t(p.status)}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      ) : tab === 'issues' && (
        <Card fill bodyClass="">
          {!issues.data ? <Loading error={issues.error} /> : !issues.data.length ? <Empty>{t('No stock issued yet.')}</Empty> : (
            <table>
              <thead><tr><th>{t('Issue no')}</th><th>{t('Date')}</th><th>{t('Product')}</th><th className="num">{t('Qty')}</th><th>{t('Department')}</th><th>{t('Purpose')}</th><th>{t('Approved by')}</th><th /></tr></thead>
              <tbody>
                {issues.data.map((s) => (
                  <tr key={s.id}>
                    <td>{s.issue_no}</td><td>{date(s.date)}</td><td>{s.code} – {s.name_en}</td><td className="num">{qty(s.qty)}</td>
                    <td>{s.department ? t(s.department) : s.department}</td><td>{s.purpose}</td><td>{s.approved_by}</td>
                    <td>{can('inventory', 'delete') && <button className="icon-btn" aria-label={t('Delete issue')} onClick={() => removeIssue(s.id)}>✕</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}
      {issuing && stock.data && <IssueModal products={stock.data} onClose={() => setIssuing(false)} onSaved={() => { setIssuing(false); issues.reload(); stock.reload(); }} />}
    </>
  );
}

function StockIn({ reg }: { reg: RegView<StockInRow> }) {
  const { can } = useSession();
  const { t } = useT();
  const total = (reg.data || []).reduce((a, r) => a + r.total_cost, 0);
  return (
    <Card fill bodyClass="" title={t('Stock IN (Purchase Register)')} actions={can('inventory', 'export') && <a className="btn btn-sm" href="/api/export/list/stock-in">{t('Export Excel')}</a>}>
      {!reg.data ? <Loading error={reg.error} /> : !reg.data.length ? <Empty>{t('No stock items purchased yet. Purchases of tracked products appear here automatically.')}</Empty> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>{t('Purchase code')}</th><th>{t('Product code')}</th><th>{t('Date')}</th><th>{t('GRN / receipt no')}</th><th>{t('Product English name')}</th><th>{t('Supplier TIN')}</th><th>{t('Supplier name')}</th><th className="num">{t('Qty received')}</th><th className="num">{t('Unit cost')}</th><th className="num">{t('Total cost')}</th><th>{t('Remark')}</th></tr></thead>
            <tbody>
              {reg.data.map((r, i) => (
                <tr key={i}>
                  <td><Link href={`/purchases/${r.invoice_id}`}>{r.purchase_code}</Link></td><td>{r.product_code}</td><td>{date(r.date)}</td><td>{r.grn_no}</td>
                  <td className="wrap">{r.product_name}</td><td>{r.supplier_tin}</td><td>{r.supplier_name}</td>
                  <td className="num">{qty(r.quantity)}</td><td className="num">{money(r.unit_cost)}</td><td className="num">{money(r.total_cost)}</td><td>{r.remark}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td colSpan={9}>{t('{n} lines', { n: reg.data.length })}</td><td className="num">{money(total)}</td><td /></tr></tfoot>
          </table>
        </div>
      )}
    </Card>
  );
}

function StockOut({ reg }: { reg: RegView<StockOutRow> }) {
  const { can } = useSession();
  const { t } = useT();
  return (
    <Card fill bodyClass="" title={t('Stock Out (sales and issues)')} actions={can('inventory', 'export') && <a className="btn btn-sm" href="/api/export/list/stock-out">{t('Export Excel')}</a>}>
      {!reg.data ? <Loading error={reg.error} /> : !reg.data.length ? <Empty>{t('Nothing has left stock yet.')}</Empty> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>{t('Date')}</th><th>{t('Issue / sales no')}</th><th>{t('Source')}</th><th>{t('Product code')}</th><th>{t('Product name')}</th><th>{t('Department / customer')}</th><th className="num">{t('Qty issued')}</th><th>{t('Purpose')}</th><th>{t('Approved by')}</th></tr></thead>
            <tbody>
              {reg.data.map((r, i) => (
                <tr key={i}>
                  <td>{date(r.date)}</td>
                  <td>{r.source === 'Sale' ? <Link href={`/sales/${r.ref_id}`}>{r.ref_no}</Link> : r.ref_no}</td>
                  <td><Badge tone={r.source === 'Sale' ? 'info' : undefined}>{t(r.source)}</Badge></td>
                  <td>{r.product_code}</td><td className="wrap">{r.product_name}</td><td>{r.issued_to ? t(r.issued_to) : r.issued_to}</td>
                  <td className="num">{qty(r.quantity)}</td><td>{r.purpose}</td><td>{r.approved_by}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
