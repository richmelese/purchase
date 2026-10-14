'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { money, qty, date } from '@/lib/format';
import { PageHeader, Card, Badge, Loading, Empty, Field, Select, Modal, useFetch, useToast } from '@/components/ui';
import { useLookups } from '@/components/lookups';
import ImportButton from '@/components/ImportButton';
import { useSession } from '@/components/session';

const blank = {
  code: '', name_en: '', name_am: '', category: '', brand: '', model: '', serial_no: '', unit: 7, track_stock: true,
  min_stock: 0, opening_stock: 0, purchase_price: 0, selling_price: 0, notes: '',
};

function ProductModal({ product, onClose, onSaved }) {
  const toast = useToast();
  const lk = useLookups();
  const [f, setF] = useState(() => (product
    ? { ...blank, ...Object.fromEntries(Object.keys(blank).map((k) => [k, product[k] ?? blank[k]])), track_stock: !!product.track_stock }
    : blank));
  const [err, setErr] = useState({});
  const set = (k) => (e) => setF({ ...f, [k]: e?.target ? e.target.value : e });

  useEffect(() => {
    if (product) return;
    api.get('/products/next-code').then((r) => setF((x) => (x.code ? x : { ...x, code: r.code }))).catch(() => {});
  }, [product]);

  const save = async () => {
    try {
      if (product) await api.put(`/products/${product.id}`, f); else await api.post('/products', f);
      toast(`${f.code} saved`);
      onSaved();
    } catch (e) { setErr({ ...(e.fields || {}), _: e.message }); }
  };
  const categories = lk.options('product_category');
  return (
    <Modal width={780} title={product ? `Edit ${product.code}` : 'New product'} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={save}>Save</button></>}>
      {err._ && <div className="alert alert-error">{err._}</div>}
      <div className="form-grid" style={{ gridTemplateColumns: 'repeat(3, minmax(0,1fr))' }}>
        <Field label="Product code" required error={err.code} hint={!product ? 'Suggested next code – editable' : ''}><input value={f.code} onChange={set('code')} /></Field>
        <Field label="Product English name" required error={err.name_en} className="span-2"><input value={f.name_en} onChange={set('name_en')} autoFocus /></Field>
        <Field label="Product Amharic name" className="span-2"><input value={f.name_am} onChange={set('name_am')} lang="am" /></Field>
        <Field label="Category">
          <Select options={categories.some((c) => c.value === f.category) || !f.category ? categories : [...categories, { value: f.category, label: f.category }]}
            placeholder="Select category" value={f.category} onChange={set('category')} />
        </Field>
        <Field label="Brand"><input value={f.brand} onChange={set('brand')} /></Field>
        <Field label="Model"><input value={f.model} onChange={set('model')} /></Field>
        <Field label="Serial No."><input value={f.serial_no} onChange={set('serial_no')} /></Field>
        <Field label="Unit of measurement" required error={err.unit}><Select options={lk.options('unit')} value={f.unit} onChange={(v) => setF({ ...f, unit: +v })} /></Field>
        <Field label="Purchase price" error={err.purchase_price}><input type="number" step="any" min="0" value={f.purchase_price} onChange={set('purchase_price')} /></Field>
        <Field label="Selling price" error={err.selling_price}><input type="number" step="any" min="0" value={f.selling_price} onChange={set('selling_price')} /></Field>
        <Field label="Stock"><label className="check" style={{ paddingTop: 6 }}><input type="checkbox" checked={f.track_stock} onChange={(e) => setF({ ...f, track_stock: e.target.checked })} />Track stock</label></Field>
        <Field label="Opening stock" error={err.opening_stock}><input type="number" step="any" min="0" value={f.opening_stock} onChange={set('opening_stock')} disabled={!f.track_stock} /></Field>
        <Field label="Minimum stock" error={err.min_stock} hint="Reorder alert level"><input type="number" step="any" min="0" value={f.min_stock} onChange={set('min_stock')} disabled={!f.track_stock} /></Field>
        <Field label="Notes" className="span-4"><input value={f.notes} onChange={set('notes')} /></Field>
      </div>
      <p className="small muted">Untick “Track stock” for services and expense items (rent, utilities, fees…). Add more categories and units under Settings › Dropdown lists.</p>
    </Modal>
  );
}

function MovementsModal({ product, onClose }) {
  const { data, error } = useFetch(`/products/${product.id}/movements`);
  return (
    <Modal width={900} title={`${product.code} – ${product.name_en}`} onClose={onClose}>
      <div className="grid grid-4" style={{ marginBottom: 16 }}>
        <div className="card stat"><div className="stat-label">Opening</div><div className="stat-value">{qty(product.opening_stock)}</div></div>
        <div className="card stat"><div className="stat-label">Stock in</div><div className="stat-value">{qty(product.stock_in)}</div></div>
        <div className="card stat"><div className="stat-label">Stock out</div><div className="stat-value">{qty(product.stock_out)}</div></div>
        <div className="card stat"><div className="stat-label">Current</div><div className="stat-value">{qty(product.current_stock)}</div></div>
      </div>
      {!data ? <Loading error={error} /> : (
        <>
          <h3>Stock IN</h3>
          {!data.in.length ? <Empty>No purchases of this item yet.</Empty> : (
            <div className="table-wrap"><table>
              <thead><tr><th>Purchase</th><th>Date</th><th>Receipt</th><th>Supplier</th><th className="num">Qty</th><th className="num">Unit cost</th><th className="num">Total</th></tr></thead>
              <tbody>{data.in.map((r, i) => (
                <tr key={i}><td><Link href={`/purchases/${r.invoice_id}`}>{r.purchase_code}</Link></td><td>{date(r.date)}</td><td>{r.grn_no}</td><td>{r.supplier_name}</td>
                  <td className="num">{qty(r.quantity)}</td><td className="num">{money(r.unit_cost)}</td><td className="num">{money(r.total_cost)}</td></tr>
              ))}</tbody>
            </table></div>
          )}
          <h3 className="mt">Stock Out</h3>
          {!data.out.length ? <Empty>No sales or issues of this item yet.</Empty> : (
            <div className="table-wrap"><table>
              <thead><tr><th>Ref</th><th>Source</th><th>Date</th><th>Customer / department</th><th className="num">Qty</th><th>Purpose</th></tr></thead>
              <tbody>{data.out.map((r, i) => (
                <tr key={i}>
                  <td>{r.source === 'Sale' ? <Link href={`/sales/${r.ref_id}`}>{r.ref_no}</Link> : r.ref_no}</td>
                  <td><Badge tone={r.source === 'Sale' ? 'info' : undefined}>{r.source}</Badge></td>
                  <td>{date(r.date)}</td><td>{r.issued_to}</td><td className="num">{qty(r.quantity)}</td><td>{r.purpose}</td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </>
      )}
    </Modal>
  );
}

export default function ProductsPage() {
  const { can } = useSession();
  const toast = useToast();
  const lk = useLookups();
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [editing, setEditing] = useState(null);
  const [viewing, setViewing] = useState(null);
  const { data, error, reload } = useFetch('/products');
  const rows = (data || [])
    .filter((p) => !category || (category === '__none' ? !p.category : p.category === category))
    .filter((p) => !q || `${p.code} ${p.name_en} ${p.name_am || ''} ${p.category || ''} ${p.brand || ''} ${p.model || ''} ${p.serial_no || ''}`.toLowerCase().includes(q.toLowerCase()));

  const remove = async (p) => {
    if (!confirm(`Delete ${p.code} – ${p.name_en}?`)) return;
    try {
      await api.del(`/products/${p.id}`);
      toast(`${p.code} deleted`);
      reload();
    } catch (e) { toast(e.message, 'error'); }
  };

  return (
    <>
      <PageHeader title="Product list" subtitle="Product Master – codes are looked up when entering purchase and sales lines">
        {can('products', 'create') && <ImportButton url="/import/products" onDone={reload} />}
        {can('products', 'export') && <a className="btn" href="/api/export/list/products">Export Excel</a>}
        {can('products', 'create') && <button className="btn btn-primary" onClick={() => setEditing({})}>+ New product</button>}
      </PageHeader>
      <Card
        fill
        bodyClass=""
        title={(
          <div className="row">
            <input type="search" placeholder="Search code, name, brand, model, serial…" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 300 }} />
            <select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category">
              <option value="">All categories</option>
              {lk.options('product_category').map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              <option value="__none">No category</option>
            </select>
          </div>
        )}
        actions={<span className="small muted">{rows.length} of {data?.length || 0} items</span>}
      >
        {!data ? <Loading error={error} /> : !rows.length ? <Empty>No products match.</Empty> : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th className="num">No</th><th>Product code</th><th>Product English name</th><th>Amharic name</th><th>Category</th>
                  <th>Brand</th><th>Model</th><th>Serial No.</th><th>Unit</th><th className="num">Min</th><th className="num">Opening</th>
                  <th className="num">Current</th><th>Status</th><th className="num">Purchase price</th><th className="num">Selling price</th><th />
                </tr>
              </thead>
              <tbody>
                {rows.map((p, i) => (
                  <tr key={p.id}>
                    <td className="num muted">{i + 1}</td>
                    <td><button className="link-btn" onClick={() => setViewing(p)}>{p.code}</button></td>
                    <td className="wrap">{p.name_en}</td>
                    <td>{p.name_am}</td>
                    <td>{p.category}</td>
                    <td>{p.brand}</td>
                    <td>{p.model}</td>
                    <td>{p.serial_no}</td>
                    <td>{p.unit ? `${p.unit} – ${lk.unitLabel(p.unit)}` : ''}</td>
                    <td className="num">{p.track_stock ? qty(p.min_stock) : ''}</td>
                    <td className="num">{p.track_stock ? qty(p.opening_stock) : ''}</td>
                    <td className="num"><strong>{p.track_stock ? qty(p.current_stock) : ''}</strong></td>
                    <td>{p.track_stock ? <Badge>{p.status}</Badge> : <span className="muted small">Service / expense</span>}</td>
                    <td className="num">{money(p.purchase_price)}</td>
                    <td className="num">{money(p.selling_price)}</td>
                    <td className="right">
                      {can('products', 'edit') && <button className="btn btn-sm btn-ghost" onClick={() => setEditing(p)}>Edit</button>}
                      {can('products', 'delete') && <button className="btn btn-sm btn-ghost" onClick={() => remove(p)} disabled={p.stock_in > 0 || p.stock_out > 0} title={p.stock_in || p.stock_out ? 'Has stock movements' : ''}>Delete</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <p className="small muted">Click a product code to see its Stock IN / Stock Out history. Import accepts the workbook&apos;s “Product Lists” sheet or a file exported from here.</p>
      {editing && <ProductModal product={editing.id ? editing : null} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
      {viewing && <MovementsModal product={viewing} onClose={() => setViewing(null)} />}
    </>
  );
}
