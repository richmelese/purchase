'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, translateMessage } from '@/lib/api';
import { getLang, useT } from '@/lib/i18n';
import {
  computeLine, computeTotals, computeWithholding, typesFor,
  PURCHASE_TAX_TYPES, RECEIPT_PREFIX, receiptNumberError,
} from '@/lib/shared/calc';
import { taxPeriod, formatEthiopian } from '@/lib/shared/ethiopian';
import { money, qty as fmtQty, today, gcDate } from '@/lib/format';
import { Card, Field, Select, PageHeader, Loading, useFetch, useToast } from './ui';
import TBadge from './TBadge';
import { EthiopianDateInput } from './DateInput';
import { useLookups } from './lookups';
import type { Party, Product } from '@/lib/types';

interface LineForm {
  product_code: string;
  description: string;
  unit: number | '';
  tx_type: number;
  transaction_type: string;
  qty: number | string;
  unit_price: number | string;
  excise_rate: number | string;
  vatable_service_fee: number | string;
  non_vatable_fee: number | string;
  [key: string]: unknown;
}

interface HeaderForm {
  invoice_no: string;
  payment_type: string;
  vat_category: string;
  calendar_type: string;
  party_tin: string;
  party_name: string;
  date: string;
  receipt_type: string;
  mrc_number: string;
  vat_receipt_no: string;
  report_status: string;
  notes: string;
  vat_wh_applicable: boolean;
  [key: string]: unknown;
}

const blankLine = (kind: 'P' | 'S'): LineForm => ({
  product_code: '', description: '', unit: '', tx_type: kind === 'S' ? 1 : 3, transaction_type: 'Vatable',
  qty: 1, unit_price: '', excise_rate: '', vatable_service_fee: '', non_vatable_fee: '',
});

const blankHeader = (): HeaderForm => ({
  invoice_no: '', payment_type: 'Cash', vat_category: 'G', calendar_type: getLang() === 'am' ? 'E' : 'G',
  party_tin: '', party_name: '', date: today(), receipt_type: 'MRC', mrc_number: '',
  vat_receipt_no: RECEIPT_PREFIX.MRC, report_status: 'Not Reported', notes: '',
  vat_wh_applicable: false,
});

export default function InvoiceForm({ kind, id }: { kind: 'P' | 'S'; id?: string | number }) {
  const router = useRouter();
  const toast = useToast();
  const { t } = useT();
  const isSale = kind === 'S';
  const base = isSale ? '/sales' : '/purchases';

  const { data: settings } = useFetch<{ rules: { vat_rate: number; wh_rate: number; wh_goods_threshold: number; wh_service_threshold: number } }>('/settings');
  const { data: parties } = useFetch<Party[]>(`/parties?type=${isSale ? 'Customer' : 'Supplier'}`);
  const { data: products } = useFetch<Product[]>('/products');
  const existing = useFetch<any>(id ? `${base}/${id}` : null);

  const [h, setH] = useState<HeaderForm>(blankHeader);
  const [lines, setLines] = useState<LineForm[]>(() => [blankLine(kind)]);
  const [errors, setErrors] = useState<Record<string, any>>({});
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  // Load number for a new invoice / existing record for edit.
  useEffect(() => {
    if (id) return;
    api.get<{ number: string }>(`${base}/next-number`).then((r) => setH((x) => ({ ...x, invoice_no: x.invoice_no || r.number }))).catch(() => {});
  }, [id, base]);
  useEffect(() => {
    const inv = existing.data;
    if (!inv) return;
    setH(Object.fromEntries(Object.keys(blankHeader()).map((k) => [k, inv[k] ?? ''])) as HeaderForm);
    setLines(inv.lines.map((l: any): LineForm => ({
      product_code: l.product_code || '', description: l.description, unit: l.unit || '', tx_type: l.tx_type,
      transaction_type: l.transaction_type, qty: l.qty, unit_price: l.unit_price, excise_rate: l.excise_rate || '',
      vatable_service_fee: l.vatable_service_fee || '', non_vatable_fee: l.non_vatable_fee || '',
    })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existing.data]);

  // The tax rules the API calculates with (GET /settings → rules); the preview waits for them.
  const rules = settings?.rules;
  const productByCode = useMemo(() => new Map((products || []).map((p) => [p.code, p])), [products]);
  const party = useMemo(() => (parties || []).find((p) => p.tin && p.tin === h.party_tin), [parties, h.party_tin]);

  const computed = rules ? lines.map((l) => computeLine(l, rules as any)) : [];
  const totals = computeTotals(computed);
  const wh = rules ? computeWithholding({ ...totals, vat_category: h.vat_category, wh_receipt_type: 'With Receipt' }, rules as any) : null;
  const period = taxPeriod(h.date);
  const types = typesFor(kind);
  const lk = useLookups();
  const typeOptions = lk.options(isSale ? 'sales_type' : 'purchase_type');
  // Purchases use Vatable (15%) / Non-Vatable (0%); older records keep their stored value.
  const taxTypeOptions = (current: string) => lk.options('transaction_type')
    .filter((o) => (isSale ? o.value !== 'Non-Vatable' : PURCHASE_TAX_TYPES.includes(o.value) || o.value === current));
  const prefix = RECEIPT_PREFIX[h.receipt_type] || '';
  const receiptHint = prefix ? t('{type} receipts start with "{prefix}"', { type: t(h.receipt_type), prefix }) : '';
  const receiptLiveRaw = h.vat_receipt_no && h.vat_receipt_no.length > prefix.length ? receiptNumberError(h.receipt_type, h.vat_receipt_no) : null;
  const receiptLive = receiptLiveRaw ? translateMessage(receiptLiveRaw) : null;
  // Field errors from the server arrive in English; show them in the chosen language.
  const fe = (v: unknown) => (v ? translateMessage(v) : undefined);

  const setHeader = (k: keyof HeaderForm) => (v: any) => {
    setH((x) => {
      const next: HeaderForm = { ...x, [k]: v };
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

  const setLine = (i: number, k: keyof LineForm, v: any) => {
    setLines((ls) => ls.map((l, j) => {
      if (j !== i) return l;
      const next: LineForm = { ...l, [k]: v };
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
    setErrors((e: any) => {
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
      const inv = id ? await api.put<any>(`${base}/${id}`, body) : await api.post<any>(base, body);
      toast(isSale ? t('Sale {no} saved', { no: inv.invoice_no }) : t('Purchase {no} saved', { no: inv.invoice_no }));
      if (andNew) {
        setH({ ...blankHeader(), date: h.date, payment_type: h.payment_type, vat_category: h.vat_category });
        setLines([blankLine(kind)]);
        setErrors({});
        const r = await api.get<{ number: string }>(`${base}/next-number`);
        setH((x) => ({ ...x, invoice_no: r.number }));
        window.scrollTo(0, 0);
      } else {
        router.push(`${base}/${inv.id}`);
      }
    } catch (e: any) {
      setErrors(e.fields || {});
      setFormError(e.message);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } finally {
      setSaving(false);
    }
  };

  if ((id && !existing.data) || !rules) return <Loading error={existing.error} />;

  const lineErr = (i: number, k: string) => errors.line_items?.[i]?.[k];
  const cls = (bad: unknown) => (bad ? 'invalid' : '');

  return (
    <>
      <PageHeader
        title={id
          ? (isSale ? t('Edit sale {no}', { no: h.invoice_no }) : t('Edit purchase {no}', { no: h.invoice_no }))
          : (isSale ? t('New sale') : t('New purchase'))}
        subtitle={isSale ? t('Record a sales invoice / receipt issued to a buyer') : t('Record a purchase receipt from a seller')}
      >
        <button className="btn" onClick={() => router.back()}>{t('Cancel')}</button>
        {!id && <button className="btn" disabled={saving} onClick={() => save(true)}>{t('Save & new')}</button>}
        <button className="btn btn-primary" disabled={saving} onClick={() => save(false)}>{saving ? t('Saving…') : t('Save')}</button>
      </PageHeader>

      {formError && <div className="alert alert-error">{formError}</div>}

      <Card title={t('Receipt details')}>
        <div className="form-grid">
          <Field label={isSale ? t('Sales ID') : t('Purchase ID')} error={fe(errors.invoice_no)} hint={t('Assigned automatically; editable')}>
            <input value={h.invoice_no} onChange={(e) => setHeader('invoice_no')(e.target.value)} className={cls(errors.invoice_no)} />
          </Field>
          <Field label={t('Payment type')} required error={fe(errors.payment_type)}>
            <Select options={lk.options('payment_type')} value={h.payment_type} onChange={setHeader('payment_type')} />
          </Field>
          <Field label={t('Product type')} required error={fe(errors.vat_category)} hint={t('Goods or service (sets the withholding threshold)')}>
            <Select options={lk.options('vat_category')} value={h.vat_category} onChange={setHeader('vat_category')} />
          </Field>
          <Field label={t('Declaration status')}>
            <Select options={lk.options('report_status')} value={h.report_status} onChange={setHeader('report_status')} />
          </Field>
          {isSale && (
            <Field label={t('VAT withholding')}>
              <label className="row" style={{ alignItems: 'center', gap: 6 }}>
                <input type="checkbox" checked={!!h.vat_wh_applicable} onChange={(e) => setHeader('vat_wh_applicable')(e.target.checked)} />
                <span>{t('Customer will withhold VAT (50%, e.g. government buyer)')}</span>
              </label>
            </Field>
          )}

          <Field label={isSale ? t('Buyer TIN') : t('Seller TIN')} error={fe(errors.party_tin)} hint={party ? t('Registered: {name}', { name: party.name }) : h.party_tin ? t('New TIN – will be registered') : t('Optional (if no TIN, or imported)')}>
            <input list="party-tins" value={h.party_tin} inputMode="numeric" onChange={(e) => setHeader('party_tin')(e.target.value.trim())} className={cls(errors.party_tin)} placeholder={t('e.g. {example}', { example: '0000030603' })} />
            <datalist id="party-tins">
              {(parties || []).filter((p) => p.tin).map((p) => <option key={p.id} value={p.tin!}>{p.name}</option>)}
            </datalist>
          </Field>
          <Field label={isSale ? t('Buyer name') : t('Seller name')} error={fe(errors.party_name)} className="span-2">
            <input value={h.party_name} onChange={(e) => setHeader('party_name')(e.target.value)} readOnly={!!party} className={cls(errors.party_name)} />
          </Field>
          <Field label={t('Calendar type')} required>
            <Select options={lk.options('calendar_type')} value={h.calendar_type} onChange={setHeader('calendar_type')} />
          </Field>

          <Field label={isSale ? t('Date of sale') : t('Date of purchase')} required error={fe(errors.date)}
            hint={period ? `${h.calendar_type === 'E' ? `${gcDate(h.date)} ${t('GC')}` : `${formatEthiopian(h.date)} ${t('E.C.')}`} · ${t('Tax month')}: ${t(period.month)}` : ''}>
            {h.calendar_type === 'E'
              ? <EthiopianDateInput value={h.date} onChange={setHeader('date')} invalid={!!errors.date} />
              : <input type="date" value={h.date} onChange={(e) => setHeader('date')(e.target.value)} className={cls(errors.date)} />}
          </Field>
          <Field label={t('Receipt type')} required error={fe(errors.receipt_type)}>
            <Select options={lk.options('receipt_type')} value={h.receipt_type} onChange={setHeader('receipt_type')} />
          </Field>
          <Field label={t('MRC number')} required={h.receipt_type === 'MRC'} error={fe(errors.mrc_number)}>
            <input list="party-mrcs" value={h.mrc_number} onChange={(e) => setHeader('mrc_number')(e.target.value)} disabled={h.receipt_type !== 'MRC'} className={cls(errors.mrc_number)} />
            <datalist id="party-mrcs">
              {party && [party.mrc1, party.mrc2, party.mrc3].filter(Boolean).map((m) => <option key={m} value={m!} />)}
            </datalist>
          </Field>
          <Field label={t('Receipt no.')} required error={fe(errors.vat_receipt_no) || receiptLive} hint={receiptHint}>
            <input value={h.vat_receipt_no} onChange={(e) => setHeader('vat_receipt_no')(e.target.value)} className={cls(errors.vat_receipt_no || receiptLive)} placeholder={prefix ? `${prefix}…` : ''} />
          </Field>
          <Field label={t('Remark')} className="span-4">
            <input value={h.notes} onChange={(e) => setHeader('notes')(e.target.value)} placeholder={t('Notes or clarifications (optional)')} />
          </Field>
        </div>
      </Card>

      <Card
        className="mt"
        title={t('Item details & price calculation')}
        actions={<span className="small muted">B = A × Qty · D = B × C · F = (B + D + E) × {Math.round(rules.vat_rate * 100)}% · H = B + D + E + F + G</span>}
        bodyClass=""
      >
        <div className="table-wrap">
          <table className="lines-table">
            <thead>
              <tr>
                <th>#</th>
                <th style={{ minWidth: 120 }}>{t('Product code')}</th>
                <th style={{ minWidth: 200 }}>{t('Item name')}</th>
                <th style={{ minWidth: 124 }}>{t('Measurement')}<span className="req">*</span></th>
                <th style={{ minWidth: 250 }}>{isSale ? t('Type of sales') : t('Input category')}</th>
                <th style={{ minWidth: 140 }}>{t('Tax type')}</th>
                <th className="num" style={{ minWidth: 72 }}>{t('Qty')}</th>
                <th className="num" style={{ minWidth: 104 }}>{t('Unit price')}<br /><span className="col-letter">A</span></th>
                <th className="num">{t('Total price')}<br /><span className="col-letter">B</span></th>
                <th className="num" style={{ minWidth: 76 }}>{t('Excise %')}<br /><span className="col-letter">C</span></th>
                <th className="num">{t('Excise amt')}<br /><span className="col-letter">D</span></th>
                <th className="num" style={{ minWidth: 96 }}>{t('Other vatable fee')}<br /><span className="col-letter">E</span></th>
                <th className="num">{t('VAT')}<br /><span className="col-letter">F</span></th>
                <th className="num" style={{ minWidth: 96 }}>{t('Other non-vatable fee')}<br /><span className="col-letter">G</span></th>
                <th className="num">{t('Total price')}<br /><span className="col-letter">H</span></th>
                <th aria-label={t('Remove')} />
              </tr>
            </thead>
            <tbody>
              {computed.map((l, i) => {
                const p = productByCode.get(lines[i].product_code);
                const stockWarn = isSale && p?.track_stock && +lines[i].qty > (p.current_stock ?? 0) + (id ? Infinity : 0);
                return (
                  <tr key={i}>
                    <td className="muted" style={{ paddingTop: 11 }}>{i + 1}</td>
                    <td>
                      <input list="product-codes" value={lines[i].product_code} onChange={(e) => setLine(i, 'product_code', e.target.value)} />
                    </td>
                    <td>
                      <input value={lines[i].description} onChange={(e) => setLine(i, 'description', e.target.value)} className={cls(lineErr(i, 'description'))} />
                      {p?.track_stock ? <div className={`small ${stockWarn ? '' : 'muted'}`} style={stockWarn ? { color: 'var(--bad)' } : undefined}>{stockWarn ? t('In stock: {qty} – insufficient', { qty: fmtQty(p.current_stock) }) : t('In stock: {qty}', { qty: fmtQty(p.current_stock) })}</div> : null}
                    </td>
                    <td>
                      <Select options={lk.options('unit')} value={lines[i].unit} onChange={(v) => setLine(i, 'unit', +v)} placeholder={t('Select UM')} className={cls(lineErr(i, 'unit'))} />
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
                    <td><input type="number" step="any" min="0" value={lines[i].excise_rate} onChange={(e) => setLine(i, 'excise_rate', e.target.value)} placeholder="0" className={cls(lineErr(i, 'excise_rate'))} title={fe(lineErr(i, 'excise_rate'))} /></td>
                    <td className="num">{money(l.excise_amount)}</td>
                    <td><input type="number" step="any" min="0" value={lines[i].vatable_service_fee} onChange={(e) => setLine(i, 'vatable_service_fee', e.target.value)} placeholder="0" /></td>
                    <td className="num">{money(l.vat_amount)}</td>
                    <td><input type="number" step="any" min="0" value={lines[i].non_vatable_fee} onChange={(e) => setLine(i, 'non_vatable_fee', e.target.value)} placeholder="0" /></td>
                    <td className="num"><strong>{money(l.line_total)}</strong></td>
                    <td>
                      <button className="icon-btn" aria-label={t('Remove line')} disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>✕</button>
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
          <button className="btn" onClick={() => setLines((ls) => [...ls, { ...blankLine(kind), tx_type: ls[ls.length - 1]?.tx_type ?? blankLine(kind).tx_type, transaction_type: ls[ls.length - 1]?.transaction_type ?? 'Vatable' }])}>{t('+ Add line')}</button>
          <div className="totals">
            <div><span>{t('B · Total price (A × Qty)')}</span><span>{money(totals.total_amount)}</span></div>
            <div><span>{t('D · Excise tax amount')}</span><span>{money(totals.excise_amount)}</span></div>
            <div><span>{t('E · Other vatable service fee')}</span><span>{money(totals.vatable_service_fee)}</span></div>
            <div className="muted"><span>{t('VAT base (B + D + E)')}</span><span>{money(totals.taxable_amount)}</span></div>
            <div><span>{t('F · VAT ({rate}%)', { rate: Math.round(rules.vat_rate * 100) })}</span><span>{money(totals.vat_amount)}</span></div>
            <div><span>{t('G · Other non-vatable fee')}</span><span>{money(totals.non_vatable_fee)}</span></div>
            <div className="grand"><span>{t('H · Total price')}</span><span>{t('ETB')} {money(totals.grand_total)}</span></div>
            <div className="small muted">
              <span>{t('Withholding')}</span>
              <span>
                {wh!.applicable
                  ? <><TBadge value={wh!.status} /> {money(wh!.expected)} ({rules.wh_rate * 100}%)</>
                  : t('Not applicable (threshold {amount})', { amount: money(h.vat_category === 'S' ? rules.wh_service_threshold : rules.wh_goods_threshold) })}
              </span>
            </div>
          </div>
        </div>
      </Card>
    </>
  );
}
