'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { useSession } from '@/components/session';
import { money, qty, date, today } from '@/lib/format';
import Link from 'next/link';
import { useLookups } from '@/components/lookups';
import { PageHeader, Card, Badge, Loading, Empty, Field, Select, Modal, useFetch, useToast } from '@/components/ui';

function IssueModal({ products, onClose, onSaved }) {
  const toast = useToast();
  const { options, unitLabel } = useLookups();
  const [f, setF] = useState({ date: today(), product_id: '', qty: 1, department: '', purpose: '', approved_by: '' });
  const [err, setErr] = useState({});
  const product = products.find((p) => p.id === +f.product_id);
  const save = async () => {
    try {
      const r = await api.post('/issues', f);
      toast(`Issue ${r.issue_no} recorded`);
      onSaved();
    } catch (e) { setErr({ ...(e.fields || {}), _: e.message }); }
  };
  return (
    <Modal title="Issue stock" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={save}>Save issue</button></>}>
      {err._ && <div className="alert alert-error">{err._}</div>}
      <div className="form-grid" style={{ gridTemplateColumns: 'repeat(2, minmax(0,1fr))' }}>
        <Field label="Product" required error={err.product_id} className="span-4" hint={product ? `Available: ${qty(product.current_stock)} ${unitLabel(product.unit)}` : ''}>
          <select value={f.product_id} onChange={(e) => setF({ ...f, product_id: e.target.value })}>
            <option value="">Select a product…</option>
            {products.filter((p) => p.track_stock).map((p) => <option key={p.id} value={p.id}>{p.code} – {p.name_en} ({qty(p.current_stock)})</option>)}
          </select>
        </Field>
        <Field label="Date" required error={err.date}><input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
        <Field label="Quantity" required error={err.qty}><input type="number" step="any" min="0" value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} /></Field>
        <Field label="Department"><Select options={options('department')} placeholder="Select department" value={f.department} onChange={(v) => setF({ ...f, department: v })} /></Field>
        <Field label="Approved by"><input value={f.approved_by} onChange={(e) => setF({ ...f, approved_by: e.target.value })} /></Field>
        <Field label="Purpose" className="span-4"><input value={f.purpose} onChange={(e) => setF({ ...f, purpose: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

export default function InventoryPage() {
  const { can } = useSession();
  const toast = useToast();
  const { unitLabel } = useLookups();
  const [tab, setTab] = useState('stock');
  const [q, setQ] = useState('');
  const [onlyLow, setOnlyLow] = useState(false);
  const [issuing, setIssuing] = useState(false);
  const stock = useFetch('/products');
  const issues = useFetch('/issues');
  const inReg = useFetch(tab === 'in' ? '/stock/in' : null);
  const outReg = useFetch(tab === 'out' ? '/stock/out' : null);

  const rows = (stock.data || []).filter((p) => p.track_stock)
    .filter((p) => !onlyLow || p.status === 'Low stock' || p.status === 'Out of stock')
    .filter((p) => !q || `${p.code} ${p.name_en} ${p.category || ''} ${p.brand || ''}`.toLowerCase().includes(q.toLowerCase()));
  const value = rows.reduce((a, r) => a + r.stock_value, 0);

  const removeIssue = async (id) => {
    if (!confirm('Delete this issue? The quantity returns to stock.')) return;
    try {
      await api.del(`/issues/${id}`);
      issues.reload(); stock.reload();
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  return (
    <>
      <PageHeader title="Inventory" subtitle="Current stock = opening stock + purchases − sales − internal issues">
        {can('inventory', 'export') && <a className="btn" href="/api/export/stock">Export Excel</a>}
        {can('inventory', 'create') && <button className="btn btn-primary" onClick={() => setIssuing(true)}>Issue stock</button>}
      </PageHeader>
      <div className="tabs">
        <button className={`tab ${tab === 'stock' ? 'active' : ''}`} onClick={() => setTab('stock')}>Current stock</button>
        <button className={`tab ${tab === 'in' ? 'active' : ''}`} onClick={() => setTab('in')}>Stock IN (purchase register)</button>
        <button className={`tab ${tab === 'out' ? 'active' : ''}`} onClick={() => setTab('out')}>Stock Out</button>
        <button className={`tab ${tab === 'issues' ? 'active' : ''}`} onClick={() => setTab('issues')}>Issue register</button>
      </div>

      {tab === 'in' && <StockIn reg={inReg} />}
      {tab === 'out' && <StockOut reg={outReg} />}
      {tab === 'stock' ? (
        <Card fill bodyClass="" title={(
          <div className="row">
            <input type="search" placeholder="Search code, name, category…" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 280 }} />
            <label className="check small"><input type="checkbox" checked={onlyLow} onChange={(e) => setOnlyLow(e.target.checked)} />Only low / out of stock</label>
          </div>
        )} actions={<span className="small muted">Stock value <strong>ETB {money(value)}</strong></span>}>
          {!stock.data ? <Loading error={stock.error} /> : !rows.length ? <Empty>No stock items match.</Empty> : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Code</th><th>Product</th><th>Category</th><th>Unit</th><th className="num">Opening</th><th className="num">In</th><th className="num">Out</th><th className="num">Remaining</th><th className="num">Min</th><th className="num">Avg cost</th><th className="num">Value</th><th>Status</th></tr>
                </thead>
                <tbody>
                  {rows.map((p) => (
                    <tr key={p.id}>
                      <td>{p.code}</td><td className="wrap">{p.name_en}{p.name_am ? <div className="small muted">{p.name_am}</div> : null}</td>
                      <td>{p.category}</td><td>{p.unit ? `${p.unit} – ${unitLabel(p.unit)}` : ''}</td>
                      <td className="num">{qty(p.opening_stock)}</td><td className="num">{qty(p.stock_in)}</td><td className="num">{qty(p.stock_out)}</td>
                      <td className="num"><strong>{qty(p.current_stock)}</strong></td><td className="num">{qty(p.min_stock)}</td>
                      <td className="num">{money(p.unit_cost)}</td><td className="num">{money(p.stock_value)}</td>
                      <td><Badge>{p.status}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      ) : tab === 'issues' && (
        <Card fill bodyClass="">
          {!issues.data ? <Loading error={issues.error} /> : !issues.data.length ? <Empty>No stock issued yet.</Empty> : (
            <table>
              <thead><tr><th>Issue no</th><th>Date</th><th>Product</th><th className="num">Qty</th><th>Department</th><th>Purpose</th><th>Approved by</th><th /></tr></thead>
              <tbody>
                {issues.data.map((s) => (
                  <tr key={s.id}>
                    <td>{s.issue_no}</td><td>{date(s.date)}</td><td>{s.code} – {s.name_en}</td><td className="num">{qty(s.qty)}</td>
                    <td>{s.department}</td><td>{s.purpose}</td><td>{s.approved_by}</td>
                    <td>{can('inventory', 'delete') && <button className="icon-btn" aria-label="Delete issue" onClick={() => removeIssue(s.id)}>✕</button>}</td>
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

function StockIn({ reg }) {
  const { can } = useSession();
  const total = (reg.data || []).reduce((a, r) => a + r.total_cost, 0);
  return (
    <Card fill bodyClass="" title="Stock IN (Purchase Register)" actions={can('inventory', 'export') && <a className="btn btn-sm" href="/api/export/list/stock-in">Export Excel</a>}>
      {!reg.data ? <Loading error={reg.error} /> : !reg.data.length ? <Empty>No stock items purchased yet. Purchases of tracked products appear here automatically.</Empty> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Purchase code</th><th>Product code</th><th>Date</th><th>GRN / receipt no</th><th>Product English name</th><th>Supplier TIN</th><th>Supplier name</th><th className="num">Qty received</th><th className="num">Unit cost</th><th className="num">Total cost</th><th>Remark</th></tr></thead>
            <tbody>
              {reg.data.map((r, i) => (
                <tr key={i}>
                  <td><Link href={`/purchases/${r.invoice_id}`}>{r.purchase_code}</Link></td><td>{r.product_code}</td><td>{date(r.date)}</td><td>{r.grn_no}</td>
                  <td className="wrap">{r.product_name}</td><td>{r.supplier_tin}</td><td>{r.supplier_name}</td>
                  <td className="num">{qty(r.quantity)}</td><td className="num">{money(r.unit_cost)}</td><td className="num">{money(r.total_cost)}</td><td>{r.remark}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td colSpan={9}>{reg.data.length} lines</td><td className="num">{money(total)}</td><td /></tr></tfoot>
          </table>
        </div>
      )}
    </Card>
  );
}

function StockOut({ reg }) {
  const { can } = useSession();
  return (
    <Card fill bodyClass="" title="Stock Out (sales and issues)" actions={can('inventory', 'export') && <a className="btn btn-sm" href="/api/export/list/stock-out">Export Excel</a>}>
      {!reg.data ? <Loading error={reg.error} /> : !reg.data.length ? <Empty>Nothing has left stock yet.</Empty> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Date</th><th>Issue / sales no</th><th>Source</th><th>Product code</th><th>Product name</th><th>Department / customer</th><th className="num">Qty issued</th><th>Purpose</th><th>Approved by</th></tr></thead>
            <tbody>
              {reg.data.map((r, i) => (
                <tr key={i}>
                  <td>{date(r.date)}</td>
                  <td>{r.source === 'Sale' ? <Link href={`/sales/${r.ref_id}`}>{r.ref_no}</Link> : r.ref_no}</td>
                  <td><Badge tone={r.source === 'Sale' ? 'info' : undefined}>{r.source}</Badge></td>
                  <td>{r.product_code}</td><td className="wrap">{r.product_name}</td><td>{r.issued_to}</td>
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
