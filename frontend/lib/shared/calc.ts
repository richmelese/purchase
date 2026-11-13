// Tax calculation rules (from "All In One Sales.xlsx"). Shared by server and browser. Kept in
// step with backend/src/common/calc.ts.

export const DEFAULT_RULES = {
  vat_rate: 0.15,
  wh_rate: 0.03,
  wh_goods_threshold: 20000,
  wh_service_threshold: 10000,
  vat_wh_rate: 0.5,
};

export type Rules = typeof DEFAULT_RULES;

export const PAYMENT_TYPES = ['Cash', 'Credit'];
export const VAT_CATEGORIES = [
  { value: 'G', label: 'G – Goods' },
  { value: 'S', label: 'S – Service' },
];
export const CALENDAR_TYPES = [
  { value: 'E', label: 'E – Ethiopian' },
  { value: 'G', label: 'G – Gregorian' },
];
export const RECEIPT_TYPES = ['MRC', 'Manual', 'Electronics'];
export const UNITS = [
  { value: 2, label: 'KG' }, { value: 3, label: 'ML' }, { value: 4, label: 'GM' },
  { value: 5, label: 'LIT' }, { value: 6, label: 'MT' }, { value: 7, label: 'PCS' },
  { value: 8, label: 'CT' }, { value: 9, label: 'OTHER' }, { value: 10, label: 'PC' },
];
export const TRANSACTION_TYPES = ['Vatable', 'Non-Vatable', 'Zero Rated', 'Tax Exempt'];
// Tax type offered on purchase lines (Purchase Declaration Format): Vatable (15%) / Non-Vatable (0%).
export const PURCHASE_TAX_TYPES = ['Vatable', 'Non-Vatable'];

// Receipt numbering (Purchase Declaration Format): MRC receipts start with "FS", manual receipts with "M".
export const RECEIPT_PREFIX: Record<string, string> = { MRC: 'FS', Manual: 'M' };
export function receiptNumberError(receiptType: string, receiptNo: unknown): string | null {
  const prefix = RECEIPT_PREFIX[receiptType];
  if (!prefix || !receiptNo) return null;
  const no = String(receiptNo).toUpperCase();
  if (!no.startsWith(prefix)) return `${receiptType} receipt numbers must start with "${prefix}"`;
  if (no.length === prefix.length) return `Enter the receipt number after "${prefix}"`;
  return null;
}
export const REPORT_STATUSES = ['Not Reported', 'Reported'];
/** Doubles as "reason withholding wasn't applied" when status isn't 'With Receipt': Government and
 * Exempt are specific known reasons, 'Other' pairs with the invoice's free-text `wh_reason_note`. */
export const WH_RECEIPT_TYPES = ['With Receipt', 'Without Receipt', 'Government', 'Exempt', 'Other'];

export interface TypeDef {
  value: number;
  label: string;
  line: number;
  tt: string;
}

// Input categories, in declaration order. IDs 1–6 come from the workbook; 7 separates line 85 from 130.
export const PURCHASE_TYPES: TypeDef[] = [
  { value: 1, label: 'Local Purchase Capital Asset', line: 65, tt: 'Vatable' },
  { value: 2, label: 'Imported Capital Asset', line: 75, tt: 'Vatable' },
  { value: 7, label: 'Purchase No VAT or Unclaimed Input (capital)', line: 85, tt: 'Non-Vatable' },
  { value: 3, label: 'Local Purchase Input', line: 100, tt: 'Vatable' },
  { value: 4, label: 'Imported Input', line: 110, tt: 'Vatable' },
  { value: 5, label: 'General Expense Input Purchase', line: 120, tt: 'Vatable' },
  { value: 6, label: 'Purchase No VAT or Unclaimed Input', line: 130, tt: 'Non-Vatable' },
];
export const SALES_TYPES: TypeDef[] = [
  { value: 1, label: 'Taxable sale', line: 5, tt: 'Vatable' },
  { value: 2, label: 'Zero-rated sale', line: 15, tt: 'Zero Rated' },
  { value: 3, label: 'Tax-exempt sale', line: 20, tt: 'Tax Exempt' },
];

export const typesFor = (kind: 'P' | 'S'): TypeDef[] => (kind === 'S' ? SALES_TYPES : PURCHASE_TYPES);
export const unitLabel = (v: unknown): string => (UNITS.find((u) => u.value === +(v as any))?.label) || '';

export const round2 = (n: unknown): number => Math.round((Number(n) || 0) * 100 + Number.EPSILON) / 100;
const num = (v: unknown): number => {
  const n = Number(String(v ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
};

export interface RawLine {
  qty?: unknown;
  unit_price?: unknown;
  excise_rate?: unknown;
  vatable_service_fee?: unknown;
  non_vatable_fee?: unknown;
  transaction_type?: string;
  [key: string]: unknown;
}

export interface ComputedLine extends RawLine {
  qty: number; unit_price: number; excise_rate: number; vatable_service_fee: number; non_vatable_fee: number;
  total: number; excise_amount: number; taxable_amount: number; vat_amount: number; line_total: number;
}

/**
 * One invoice line (Price Calculations table):
 *   A Unit price
 *   B Total price               = A × Quantity
 *   C Excise tax rate           (depends on the item)
 *   D Excise tax amount         = B × C
 *   E Other vatable service fee
 *   F VAT                       = (B + D + E) × 15%   (only when the tax type is "Vatable")
 *   G Other non-vatable fee
 *   H Total price               = B + D + E + F + G
 *
 * Note: the workbook's column W used "=U+V" (excise + fee only), which
 * dropped the purchase amount itself. The base here includes it.
 */
export function computeLine(line: RawLine, rules: Rules = DEFAULT_RULES): ComputedLine {
  const qty = num(line.qty);
  const unit_price = num(line.unit_price);
  const excise_rate = num(line.excise_rate);
  const vatable_service_fee = num(line.vatable_service_fee);
  const non_vatable_fee = num(line.non_vatable_fee);
  const total = round2(qty * unit_price);
  const excise_amount = round2((total * excise_rate) / 100);
  const taxable_amount = round2(total + excise_amount + vatable_service_fee);
  const vat_amount = line.transaction_type === 'Vatable' ? round2(taxable_amount * rules.vat_rate) : 0;
  const line_total = round2(taxable_amount + vat_amount + non_vatable_fee);
  return {
    ...line, qty, unit_price, excise_rate, vatable_service_fee, non_vatable_fee,
    total, excise_amount, taxable_amount, vat_amount, line_total,
  };
}

export interface Totals {
  total_amount: number; excise_amount: number; vatable_service_fee: number; taxable_amount: number;
  vat_amount: number; non_vatable_fee: number; grand_total: number;
}

export function computeTotals(lines: ComputedLine[]): Totals {
  const t: Totals = {
    total_amount: 0, excise_amount: 0, vatable_service_fee: 0, taxable_amount: 0,
    vat_amount: 0, non_vatable_fee: 0, grand_total: 0,
  };
  for (const l of lines) {
    t.total_amount += l.total;
    t.excise_amount += l.excise_amount;
    t.vatable_service_fee += l.vatable_service_fee;
    t.taxable_amount += l.taxable_amount;
    t.vat_amount += l.vat_amount;
    t.non_vatable_fee += l.non_vatable_fee;
    t.grand_total += l.line_total;
  }
  (Object.keys(t) as (keyof Totals)[]).forEach((k) => { t[k] = round2(t[k]); });
  return t;
}

export interface WithholdingInput {
  taxable_amount?: unknown;
  vat_category?: string;
  wh_receipt_type?: string | null;
  wh_paid?: unknown;
}

export interface WithholdingResult {
  status: 'No WH' | 'No Data' | 'Goods WH' | 'Service WH';
  applicable: boolean;
  base: number;
  expected: number;
  paid: number;
  outstanding: number;
}

/**
 * Withholding (P. Summery columns U–X).
 *   Goods   > 20,000 taxable  -> "Goods WH"
 *   Service > 10,000 taxable  -> "Service WH"  (workbook mislabelled this "Goods WH")
 *   Expected WH = base × 3% when the WH receipt type is "With Receipt"
 */
export function computeWithholding(inv: WithholdingInput, rules: Rules = DEFAULT_RULES): WithholdingResult {
  const base = num(inv.taxable_amount);
  let status: WithholdingResult['status'] = 'No WH';
  if (base < 1) status = 'No Data';
  else if (inv.vat_category === 'G' && base > rules.wh_goods_threshold) status = 'Goods WH';
  else if (inv.vat_category === 'S' && base > rules.wh_service_threshold) status = 'Service WH';
  const applicable = status === 'Goods WH' || status === 'Service WH';
  const wh_base = applicable ? base : 0;
  const expected = applicable && inv.wh_receipt_type === 'With Receipt' ? round2(wh_base * rules.wh_rate) : 0;
  const paid = num(inv.wh_paid);
  return {
    status, applicable, base: wh_base, expected, paid,
    outstanding: round2(expected - paid),
  };
}

export interface VatWithholdingInput {
  vat_amount?: unknown;
  vat_wh_applicable?: unknown;
  vat_wh_paid?: unknown;
}

export interface VatWithholdingResult {
  applicable: boolean;
  expected: number;
  paid: number;
  outstanding: number;
}

/**
 * VAT withholding by appointed agents (e.g. government bodies): when the counterparty on a SALE
 * withholds VAT instead of paying it in cash, they remit `vat_wh_rate` (50% by default) of the
 * line VAT directly to the tax authority on the seller's behalf — independent of, and able to
 * coexist with, the 3% income-tax `computeWithholding()` above.
 */
export function computeVatWithholding(inv: VatWithholdingInput, rules: Rules = DEFAULT_RULES): VatWithholdingResult {
  const applicable = !!inv.vat_wh_applicable;
  const vat = num(inv.vat_amount);
  const expected = applicable ? round2(vat * rules.vat_wh_rate) : 0;
  const paid = num(inv.vat_wh_paid);
  return { applicable, expected, paid, outstanding: round2(expected - paid) };
}
