'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import {
  computeLine, computeTotals, computeWithholding, typesFor,
  PURCHASE_TAX_TYPES, RECEIPT_PREFIX, receiptNumberError,
} from '@/lib/shared/calc';
import { EC_MONTHS, toEthiopian, toGregorian, taxPeriod, formatEthiopian } from '@/lib/shared/ethiopian';
import { money, qty as fmtQty, today } from '@/lib/format';
import { Card, Field, Select, PageHeader, Loading, useFetch, useToast, Badge } from './ui';
import { useLookups } from './lookups';

const blankLine = (kind) => ({
  product_code: '', description: '', unit: '', tx_type: kind === 'S' ? 1 : 3, transaction_type: 'Vatable',
  qty: 1, unit_price: '', excise_rate: '', vatable_service_fee: '', non_vatable_fee: '',
});

const blankHeader = () => ({
  invoice_no: '', payment_type: 'Cash', vat_category: 'G', calendar_type: 'G',
  party_tin: '', party_name: '', date: today(), receipt_type: 'MRC', mrc_number: '',
  vat_receipt_no: RECEIPT_PREFIX.MRC, report_status: 'Not Reported', notes: '',
});

function EthiopianDateInput({ value, onChange, invalid }) {
  const ec = toEthiopian(value) || { year: '', month: 1, day: 1 };
  const [parts, setParts] = useState(ec);
  useEffect(() => { setParts(toEthiopian(value) || parts); }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  const update = (p) => {
    const next = { ...parts, ...p };
    setParts(next);
    const g = toGregorian(next.year, next.month, next.day);
    if (g) onChange(g);
  };
  return (
    <div className="row" style={{ flexWrap: 'nowrap', gap: 6 }}>
      <input type="number" min="1" max="30" value={parts.day} onChange={(e) => update({ day: +e.target.value })} style={{ width: 64 }} aria-label="EC day" className={invalid ? 'invalid' : ''} />
      <select value={parts.month} onChange={(e) => update({ month: +e.target.value })} aria-label="EC month">
        {EC_MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
      </select>
      <input type="number" min="1900" max="2200" value={parts.year} onChange={(e) => update({ year: +e.target.value })} style={{ width: 84 }} aria-label="EC year" />
    </div>
  );
}

export default function InvoiceForm({ kind, id }) {
  const router = useRouter();
  const toast = useToast();
  const isSale = kind === 'S';
  const base = isSale ? '/sales' : '/purchases';
  const partyWord = isSale ? 'Buyer' : 'Seller';

  const { data: settings } = useFetch('/settings');
  const { data: parties } = useFetch(`/parties?type=${isSale ? 'Customer' : 'Supplier'}`);
  const { data: products } = useFetch('/products');
  const existing = useFetch(id ? `${base}/${id}` : null);

  const [h, setH] = useState(blankHeader);
  const [lines, setLines] = useState(() => [blankLine(kind)]);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  // Load number for a new invoice / existing record for edit.
  useEffect(() => {
    if (id) return;
    api.get(`${base}/next-number`).then((r) => setH((x) => ({ ...x, invoice_no: x.invoice_no || r.number }))).catch(() => {});
  }, [id, base]);
  useEffect(() => {
    const inv = existing.data;
    if (!inv) return;
    setH(Object.fromEntries(Object.keys(blankHeader()).map((k) => [k, inv[k] ?? ''])));
    setLines(inv.lines.map((l) => ({
      product_code: l.product_code || '', description: l.description, unit: l.unit || '', tx_type: l.tx_type,
      transaction_type: l.transaction_type, qty: l.qty, unit_price: l.unit_price, excise_rate: l.excise_rate || '',
      vatable_service_fee: l.vatable_service_fee || '', non_vatable_fee: l.non_vatable_fee || '',
    })));
  }, [existing.data]);

  // The tax rules the API calculates with (GET /settings → rules); the preview waits for them.
  const rules = settings?.rules;
  const productByCode = useMemo(() => new Map((products || []).map((p) => [p.code, p])), [products]);
  const party = useMemo(() => (parties || []).find((p) => p.tin && p.tin === h.party_tin), [parties, h.party_tin]);

  const computed = rules ? lines.map((l) => computeLine(l, rules)) : [];
  const totals = computeTotals(computed);
  const wh = rules ? computeWithholding({ ...totals, vat_category: h.vat_category, wh_receipt_type: 'With Receipt' }, rules) : null;
  const period = taxPeriod(h.date);
  const types = typesFor(kind);
  const lk = useLookups();
  const typeOptions = lk.options(isSale ? 'sales_type' : 'purchase_type');
  // Purchases use Vatable (15%) / Non-Vatable (0%); older records keep their stored value.
  const taxTypeOptions = (current) => lk.options('transaction_type')
    .filter((o) => (isSale ? o.value !== 'Non-Vatable' : PURCHASE_TAX_TYPES.includes(o.value) || o.value === current));
  const prefix = RECEIPT_PREFIX[h.receipt_type] || '';
  const receiptHint = prefix ? `${h.receipt_type} receipts start with “${prefix}”` : '';
  const receiptLive = h.vat_receipt_no && h.vat_receipt_no.length > prefix.length ? receiptNumberError(h.receipt_type, h.vat_receipt_no) : null;

  const setHeader = (k) => (v) => {
    setH((x) => {
      const next = { ...x, [k]: v };
      if (k === 'receipt_type') {
        // Keep the receipt number prefix in step with the receipt type (MRC → FS, Manual → M).
        const oldP = RECEIPT_PREFIX[x.receipt_type] || '';
        const newP = RECEIPT_PREFIX[v] || '';
        const no = String(x.vat_receipt_no || '').toUpperCase();
        if (!no || no === oldP) next.vat_receipt_no = newP;
        else if (oldP && no.startsWith(oldP)) next.vat_receipt_no = newP + no.slice(oldP.length);
        else if (newP && !no.startsWith(newP)) next.vat_receipt_no = newP + no;
      }
      if (k === 'vat_receipt_no') next.vat_receipt_no = String(v).toUpperCase();
      if (k === 'party_tin') {
        const p = (parties || []).find((pp) => pp.tin === v);
        if (p) {
          next.party_name = p.name;
          if (!x.mrc_number && p.mrc1) next.mrc_number = p.mrc1;
        }
      }
      return next;
    });
    setErrors((e) => ({ ...e, [k]: undefined }));
  };

  const setLine = (i, k, v) => {
    setLines((ls) => ls.map((l, j) => {
      if (j !== i) return l;
      const next = { ...l, [k]: v };
      if (k === 'product_code') {
        const p = productByCode.get(v);
        if (p) {
          next.description = p.name_en;
          next.unit = p.unit || next.unit;
          const price = isSale ? p.selling_price : p.purchase_price;
          if (price && !l.unit_price) next.unit_price = price;
        }
      }
      if (k === 'tx_type') {
        const t = types.find((tt) => tt.value === +v);
        if (t) next.transaction_type = t.tt;
      }
      return next;
    }));
    setErrors((e) => {
      if (!e.line_items?.[i]?.[k]) return e;
      const li = [...e.line_items];
      li[i] = { ...li[i], [k]: undefined };
      return { ...e, line_items: li };
    });
  };

  const save = async (andNew = false) => {
    setSaving(true);
    setFormError('');
    try {
      const body = { ...h, lines };
      const inv = id ? await api.put(`${base}/${id}`, body) : await api.post(base, body);
      toast(`${isSale ? 'Sale' : 'Purchase'} ${inv.invoice_no} saved`);
      if (andNew) {
        setH({ ...blankHeader(), date: h.date, payment_type: h.payment_type, vat_category: h.vat_category });
        setLines([blankLine(kind)]);
        setErrors({});
        const r = await api.get(`${base}/next-number`);
        setH((x) => ({ ...x, invoice_no: r.number }));
        window.scrollTo(0, 0);
      } else {
        router.push(`${base}/${inv.id}`);
      }
    } catch (e) {
      setErrors(e.fields || {});
      setFormError(e.message);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } finally {
      setSaving(false);
    }
  };

  if ((id && !existing.data) || !rules) return <Loading error={existing.error} />;

  const lineErr = (i, k) => errors.line_items?.[i]?.[k];
  const cls = (bad) => (bad ? 'invalid' : '');

  return (
    <>
      <PageHeader
        title={id ? `Edit ${isSale ? 'sale' : 'purchase'} ${h.invoice_no}` : `New ${isSale ? 'sale' : 'purchase'}`}
        subtitle={isSale ? 'Record a sales invoice / receipt issued to a buyer' : 'Record a purchase receipt from a seller'}
      >
        <button className="btn" onClick={() => router.back()}>Cancel</button>
        {!id && <button className="btn" disabled={saving} onClick={() => save(true)}>Save &amp; new</button>}
        <button className="btn btn-primary" disabled={saving} onClick={() => save(false)}>{saving ? 'Saving…' : 'Save'}</button>
      </PageHeader>

      {formError && <div className="alert alert-error">{formError}{errors.lines ? ` — ${errors.lines}` : ''}</div>}

      <Card title="Receipt details">
        <div className="form-grid">
          <Field label={`${isSale ? 'Sales' : 'Purchase'} ID`} error={errors.invoice_no} hint="Assigned automatically; editable">
            <input value={h.invoice_no} onChange={(e) => setHeader('invoice_no')(e.target.value)} className={cls(errors.invoice_no)} />
          </Field>
          <Field label="Payment type" required error={errors.payment_type}>
            <Select options={lk.options('payment_type')} value={h.payment_type} onChange={setHeader('payment_type')} />
          </Field>
          <Field label="Product type" required error={errors.vat_category} hint="Goods or service (sets the withholding threshold)">
            <Select options={lk.options('vat_category')} value={h.vat_category} onChange={setHeader('vat_category')} />
          </Field>
          <Field label="Declaration status">
            <Select options={lk.options('report_status')} value={h.report_status} onChange={setHeader('report_status')} />
          </Field>

          <Field label={`${partyWord} TIN`} error={errors.party_tin} hint={party ? `Registered: ${party.name}` : h.party_tin ? 'New TIN – will be registered' : 'Optional (if no TIN, or imported)'}>
            <input list="party-tins" value={h.party_tin} inputMode="numeric" onChange={(e) => setHeader('party_tin')(e.target.value.trim())} className={cls(errors.party_tin)} placeholder="e.g. 0000030603" />
            <datalist id="party-tins">
              {(parties || []).filter((p) => p.tin).map((p) => <option key={p.id} value={p.tin}>{p.name}</option>)}
            </datalist>
          </Field>
          <Field label={`${partyWord} name`} error={errors.party_name} className="span-2">
            <input value={h.party_name} onChange={(e) => setHeader('party_name')(e.target.value)} readOnly={!!party} className={cls(errors.party_name)} />
          </Field>
          <Field label="Calendar type" required>
            <Select options={lk.options('calendar_type')} value={h.calendar_type} onChange={setHeader('calendar_type')} />
          </Field>

          <Field label={`Date of ${isSale ? 'sale' : 'purchase'}`} required error={errors.date}
            hint={period ? `${h.calendar_type === 'E' ? h.date : formatEthiopian(h.date)} · Tax month: ${period.month}` : ''}>
            {h.calendar_type === 'E'
              ? <EthiopianDateInput value={h.date} onChange={setHeader('date')} invalid={!!errors.date} />
              : <input type="date" value={h.date} onChange={(e) => setHeader('date')(e.target.value)} className={cls(errors.date)} />}
          </Field>
          <Field label="Receipt type" required error={errors.receipt_type}>
            <Select options={lk.options('receipt_type')} value={h.receipt_type} onChange={setHeader('receipt_type')} />
          </Field>
          <Field label="MRC number" required={h.receipt_type === 'MRC'} error={errors.mrc_number}>
            <input list="party-mrcs" value={h.mrc_number} onChange={(e) => setHeader('mrc_number')(e.target.value)} disabled={h.receipt_type !== 'MRC'} className={cls(errors.mrc_number)} />
            <datalist id="party-mrcs">
              {party && [party.mrc1, party.mrc2, party.mrc3].filter(Boolean).map((m) => <option key={m} value={m} />)}
            </datalist>
          </Field>
          <Field label="Receipt no." required error={errors.vat_receipt_no || receiptLive} hint={receiptHint}>
            <input value={h.vat_receipt_no} onChange={(e) => setHeader('vat_receipt_no')(e.target.value)} className={cls(errors.vat_receipt_no || receiptLive)} placeholder={prefix ? `${prefix}…` : ''} />
          </Field>
          <Field label="Remark" className="span-4">
            <input value={h.notes} onChange={(e) => setHeader('notes')(e.target.value)} placeholder="Notes or clarifications (optional)" />
          </Field>
        </div>
      </Card>

      <Card
        className="mt"
        title="Item details & price calculation"
        actions={<span className="small muted">B = A × Qty · D = B × C · F = (B + D + E) × {Math.round(rules.vat_rate * 100)}% · H = B + D + E + F + G</span>}
        bodyClass=""
      >
        <div className="table-wrap">
          <table className="lines-table">
            <thead>
              <tr>
                <th>#</th>
                <th style={{ minWidth: 120 }}>Product code</th>
                <th style={{ minWidth: 200 }}>Item name</th>
                <th style={{ minWidth: 124 }}>Measurement<span className="req">*</span></th>
                <th style={{ minWidth: 250 }}>{isSale ? 'Type of sales' : 'Input category'}</th>
                <th style={{ minWidth: 140 }}>Tax type</th>
                <th className="num" style={{ minWidth: 72 }}>Qty</th>
                <th className="num" style={{ minWidth: 104 }}>Unit price<br /><span className="col-letter">A</span></th>
                <th className="num">Total price<br /><span className="col-letter">B</span></th>
                <th className="num" style={{ minWidth: 76 }}>Excise %<br /><span className="col-letter">C</span></th>
                <th className="num">Excise amt<br /><span className="col-letter">D</span></th>
                <th className="num" style={{ minWidth: 96 }}>Other vatable fee<br /><span className="col-letter">E</span></th>
                <th className="num">VAT<br /><span className="col-letter">F</span></th>
                <th className="num" style={{ minWidth: 96 }}>Other non-vatable fee<br /><span className="col-letter">G</span></th>
                <th className="num">Total price<br /><span className="col-letter">H</span></th>
                <th aria-label="Remove" />
              </tr>
            </thead>
            <tbody>
              {computed.map((l, i) => {
                const p = productByCode.get(lines[i].product_code);
                const stockWarn = isSale && p?.track_stock && +lines[i].qty > p.current_stock + (id ? Infinity : 0);
                return (
                  <tr key={i}>
                    <td className="muted" style={{ paddingTop: 11 }}>{i + 1}</td>
                    <td>
                      <input list="product-codes" value={lines[i].product_code} onChange={(e) => setLine(i, 'product_code', e.target.value)} />
                    </td>
                    <td>
                      <input value={lines[i].description} onChange={(e) => setLine(i, 'description', e.target.value)} className={cls(lineErr(i, 'description'))} />
                      {p?.track_stock ? <div className={`small ${stockWarn ? '' : 'muted'}`} style={stockWarn ? { color: 'var(--bad)' } : undefined}>In stock: {fmtQty(p.current_stock)}{stockWarn ? ' – insufficient' : ''}</div> : null}
                    </td>
                    <td>
                      <Select options={lk.options('unit')} value={lines[i].unit} onChange={(v) => setLine(i, 'unit', +v)} placeholder="Select UM" className={cls(lineErr(i, 'unit'))} />
                    </td>
                    <td>
                      <Select options={typeOptions} value={lines[i].tx_type} onChange={(v) => setLine(i, 'tx_type', +v)} className={cls(lineErr(i, 'tx_type'))} />
                    </td>
                    <td>
                      <Select options={taxTypeOptions(lines[i].transaction_type)} value={lines[i].transaction_type} onChange={(v) => setLine(i, 'transaction_type', v)} className={cls(lineErr(i, 'transaction_type'))} />
                    </td>
                    <td><input type="number" step="any" min="0" value={lines[i].qty} onChange={(e) => setLine(i, 'qty', e.target.value)} className={cls(lineErr(i, 'qty'))} /></td>
                    <td><input type="number" step="any" min="0" value={lines[i].unit_price} onChange={(e) => setLine(i, 'unit_price', e.target.value)} className={cls(lineErr(i, 'unit_price'))} /></td>
                    <td className="num">{money(l.total)}</td>
                    <td><input type="number" step="any" min="0" value={lines[i].excise_rate} onChange={(e) => setLine(i, 'excise_rate', e.target.value)} placeholder="0" className={cls(lineErr(i, 'excise_rate'))} title={lineErr(i, 'excise_rate') || undefined} /></td>
                    <td className="num">{money(l.excise_amount)}</td>
                    <td><input type="number" step="any" min="0" value={lines[i].vatable_service_fee} onChange={(e) => setLine(i, 'vatable_service_fee', e.target.value)} placeholder="0" /></td>
                    <td className="num">{money(l.vat_amount)}</td>
                    <td><input type="number" step="any" min="0" value={lines[i].non_vatable_fee} onChange={(e) => setLine(i, 'non_vatable_fee', e.target.value)} placeholder="0" /></td>
                    <td className="num"><strong>{money(l.line_total)}</strong></td>
                    <td>
                      <button className="icon-btn" aria-label="Remove line" disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>✕</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <datalist id="product-codes">
            {(products || []).map((p) => <option key={p.id} value={p.code}>{p.name_en}</option>)}
          </datalist>
        </div>
        <div className="card-body row" style={{ alignItems: 'flex-start' }}>
          <button className="btn" onClick={() => setLines((ls) => [...ls, { ...blankLine(kind), tx_type: ls[ls.length - 1]?.tx_type ?? blankLine(kind).tx_type, transaction_type: ls[ls.length - 1]?.transaction_type ?? 'Vatable' }])}>+ Add line</button>
          <div className="totals">
            <div><span>B · Total price (A × Qty)</span><span>{money(totals.total_amount)}</span></div>
            <div><span>D · Excise tax amount</span><span>{money(totals.excise_amount)}</span></div>
            <div><span>E · Other vatable service fee</span><span>{money(totals.vatable_service_fee)}</span></div>
            <div className="muted"><span>VAT base (B + D + E)</span><span>{money(totals.taxable_amount)}</span></div>
            <div><span>F · VAT ({Math.round(rules.vat_rate * 100)}%)</span><span>{money(totals.vat_amount)}</span></div>
            <div><span>G · Other non-vatable fee</span><span>{money(totals.non_vatable_fee)}</span></div>
            <div className="grand"><span>H · Total price</span><span>ETB {money(totals.grand_total)}</span></div>
            <div className="small muted">
              <span>Withholding</span>
              <span>
                {wh.applicable
                  ? <><Badge>{wh.status}</Badge> {money(wh.expected)} ({rules.wh_rate * 100}%)</>
                  : `Not applicable (threshold ${money(h.vat_category === 'S' ? rules.wh_service_threshold : rules.wh_goods_threshold)})`}
              </span>
            </div>
          </div>
        </div>
      </Card>
    </>
  );
}
