// Browser-side API client.
import { tx } from './i18n/core';

export class ApiError extends Error {
  status: number;
  fields: Record<string, unknown>;

  constructor(message: string, status: number, fields?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.fields = fields || {};
  }
}

/** Screen labels for the field keys the API returns in `fields`, so error messages name what the user sees. */
const FIELD_LABELS: Record<string, string> = {
  invoice_no: 'Purchase/Sales ID', payment_type: 'Payment type', vat_category: 'Product type', date: 'Date',
  receipt_type: 'Receipt type', mrc_number: 'MRC number', vat_receipt_no: 'Receipt no.', party_tin: 'TIN',
  party_name: 'Name', lines: 'Items', tin: 'TIN', name: 'Name', name_en: 'Item name (English)', code: 'Code',
  qty: 'Qty', amount: 'Amount', category: 'Category', invoice_id: 'Invoice', party_id: 'Company',
  product_id: 'Product', account_no: 'Account no.', full_name: 'Full name', username: 'User name',
  password: 'Password', label: 'Label', vat_rate: 'VAT rate', wh_rate: 'Withholding rate',
  wh_goods_threshold: 'Goods WH threshold', wh_service_threshold: 'Service WH threshold', vat_wh_rate: 'VAT-WH rate',
  wh_receipt_type: 'WH receipt status', wh_receipt_date: 'WH receipt date', wh_paid: 'WH paid',
  // invoice line columns
  unit: 'Measurement', description: 'Item name', unit_price: 'Unit price', tx_type: 'Input/sales category',
  transaction_type: 'Tax type', excise_rate: 'Excise %',
};
const labelFor = (k: string) => tx(FIELD_LABELS[k] || k.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()));

// Server messages that carry a variable part; everything else is looked up verbatim in the dictionary.
const PATTERNS: [RegExp, string][] = [
  [/^(\w+) receipt numbers must start with "(.+)"$/, '{0} receipt numbers must start with "{1}"'],
  [/^Enter the receipt number after "(.+)"$/, 'Enter the receipt number after "{0}"'],
  [/^Must be one of: (.+)$/, 'Must be one of: {0}'],
];
/** Show a server message in the current language. */
export function translateMessage(msg: unknown): string {
  const s = String(msg ?? '');
  for (const [re, key] of PATTERNS) {
    const m = s.match(re);
    if (m) return tx(key, Object.fromEntries(m.slice(1).map((v, i) => [String(i), tx(v)])));
  }
  return tx(s);
}

/** Turns `{ vat_receipt_no: '…', line_items: [{ unit: 'Required' }] }` into readable sentences. */
export function describeFieldErrors(fields?: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(fields || {})) {
    if (v == null || v === '') continue;
    if (Array.isArray(v)) {
      v.forEach((row, i) => {
        if (row && typeof row === 'object') {
          for (const [rk, rv] of Object.entries(row)) if (rv) out.push(`${tx('Line')} ${i + 1}: ${labelFor(rk)} – ${translateMessage(rv)}`);
        } else if (row) out.push(`${labelFor(k)} ${i + 1} – ${translateMessage(row)}`);
      });
    } else if (typeof v === 'object') {
      for (const [rk, rv] of Object.entries(v as Record<string, unknown>)) if (rv) out.push(`${labelFor(k)} ${labelFor(rk)} – ${translateMessage(rv)}`);
    } else {
      out.push(`${labelFor(k)} – ${translateMessage(v)}`);
    }
  }
  return out;
}

/** `file`: a File/Blob sent as the raw request body (Excel imports) instead of JSON. */
async function request<T = any>(method: string, url: string, body?: unknown, file?: Blob): Promise<T> {
  const res = await fetch(`/api${url}`, {
    method,
    headers: file ? { 'Content-Type': 'application/octet-stream' } : body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: file ?? (body !== undefined ? JSON.stringify(body) : undefined),
    cache: 'no-store',
  });
  if (res.status === 401 && !url.startsWith('/auth/') && typeof window !== 'undefined') {
    window.location.href = `/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
    return new Promise<T>(() => {});
  }
  if (res.status === 204) return null as T;
  const data = await res.json().catch(() => ({}));
  // The API refuses everything else until a generated password is replaced, and keeps company
  // accounts inside their portal: send the browser to the right page.
  const goTo = res.status === 403 && typeof window !== 'undefined'
    && ({ PASSWORD_CHANGE_REQUIRED: '/change-password', COMPANY_ACCOUNT: '/portal' } as Record<string, string>)[data.code];
  if (goTo && window.location.pathname !== goTo) {
    window.location.href = goTo;
    return new Promise<T>(() => {});
  }
  if (!res.ok) {
    // Spell out *which* fields failed, so a banner/toast never shows just "Please check the form".
    const raw = typeof data.error === 'string' ? data.error : data.error?.message || data.message;
    const base = raw ? translateMessage(raw) : tx('Request failed ({status})', { status: res.status });
    const details = describeFieldErrors(data.fields);
    throw new ApiError(details.length ? `${base}: ${details.join('; ')}` : base, res.status, data.fields);
  }
  return data as T;
}

export const api = {
  get: <T = any>(url: string) => request<T>('GET', url),
  post: <T = any>(url: string, body?: unknown) => request<T>('POST', url, body ?? {}),
  put: <T = any>(url: string, body?: unknown) => request<T>('PUT', url, body ?? {}),
  del: <T = any>(url: string) => request<T>('DELETE', url),
  /** Uploads a file (e.g. an .xlsx import) as the raw body. */
  upload: <T = any>(url: string, file: Blob) => request<T>('POST', url, undefined, file),
};

// `object` (not `Record<string, unknown>`) so a plain interface without its own index signature
// (e.g. a local `{fy, month}` filter type) can still be passed without every caller needing one.
export const qs = (params: object): string => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params as Record<string, unknown>)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};
