# API contract — Purchase & Sales Management backend

This document is the complete, literal specification of every HTTP call the Next.js frontend (`frontend/`)
makes to the backend. It was produced by reading **every** file under `frontend/app/**`, `frontend/components/**`
and `frontend/lib/**`. The original NestJS backend source was lost (unrecoverable); this is the from-scratch
implementation spec. Build the backend purely from this document.

## Transport / proxy model

- Browser calls `fetch('/api' + url, ...)` (see `frontend/lib/api.js`) — always same-origin, JSON in/out except
  uploads (raw `application/octet-stream` body for `.xlsx` files).
- The Next.js route `frontend/app/api/[...path]/route.js` forwards **every** method (GET/HEAD/POST/PUT/PATCH/DELETE)
  verbatim to `${BACKEND_URL}${pathname}${search}` — i.e. the backend must implement routes at the exact same
  paths, under `/api/...` (NOT stripped — the backend receives the full `/api/...` path, e.g. `/api/purchases`).
- Headers forwarded to backend: `accept`, `accept-language`, `content-type`, `cookie`, `if-none-match`, `user-agent`,
  plus `x-bff-secret` (set to `BFF_SHARED_SECRET` env var when configured) and `x-forwarded-for`/`x-forwarded-proto`/
  `x-forwarded-host`. **The backend must reject any request missing/mismatching `x-bff-secret` when that env var
  is configured**, except it must always serve `GET /api/auth/me` used by the BFF itself for session resolution.
- Response headers dropped by the proxy: connection, keep-alive, transfer-encoding, content-encoding, content-length,
  set-cookie (re-appended individually), x-powered-by, access-control-*, vary. The backend sets `set-cookie` itself
  for auth.
- Timeout: 120s (Excel import/export can be slow).
- Client-side error handling (`frontend/lib/api.js`):
  - `401` on any non-`/auth/*` call → browser redirected to `/login?next=...`. So **every protected endpoint must
    return plain HTTP 401** (not a redirect) when not authenticated.
  - `403` with JSON body `{ code: 'PASSWORD_CHANGE_REQUIRED' }` → redirects to `/change-password`.
  - `403` with JSON body `{ code: 'COMPANY_ACCOUNT' }` → redirects to `/portal`.
  - Any other non-2xx → body `{ error: string, fields?: { [fieldName]: string } }`; `error` is shown as a toast /
    banner, `fields` populates per-field inline errors (field names are dotted paths for nested objects, e.g.
    `profile.general.tin`, or `line_items.<index>.<field>` for invoice line errors — see `errors.line_items[i][k]`
    usage in `InvoiceForm.js`).
  - `204 No Content` → treated as `null` response body (used for most DELETEs, and logout).
- Session cookie: name **`psm_session`** (`SESSION_COOKIE` constant). Login page has a "Remember me" checkbox
  (`remember: true` sent on `POST /auth/login`) — per README: remember-me keeps the session 30 days; otherwise it
  expires when the browser closes, max 12 hours. 5 wrong password attempts from one machine lock that username
  there for 5 minutes; 20 from anywhere lock it everywhere (per README — enforce server-side, not found explicitly
  in frontend code but documented product behavior).
- `sessionUser()` (used by the BFF middleware and layouts) calls `GET /api/auth/me` with the cookie forwarded and
  `x-bff-secret`; must return the user JSON on 200, or 401 when not signed in. Any other failure (network/5xx) is
  treated as "API unreachable" by the frontend (renders the page anyway, letting client-side calls show the error).

## Auth / role model (critical — implement exactly)

From `frontend/lib/permissions.js` (client mirror of server rules — the comment in that file literally says
*"The API enforces the same rules (backend/src/common/permissions.ts)"*):

```js
// frontend/lib/permissions.js (verbatim)
// Role permissions on the client: which menu items, pages and buttons a user gets.
// The API enforces the same rules (backend/src/common/permissions.ts); this only hides
// what the server would refuse anyway.

export const isAdmin = (user) => user?.role === 'admin';

/** `task` (optional): a task of the role editor, e.g. can(u, 'purchases', 'edit', 'record_payment_p'). */
export function can(user, resource, right, task) {
  if (!user) return false;
  if (isAdmin(user)) return true;
  const perms = user.permissions?.[resource];
  return !!perms?.[right] && (!task || perms[task] !== false);
}

export const canAny = (user, ...grants) => grants.some(([resource, right, task]) => can(user, resource, right, task));

// Purchases split "edit" into two role-editor tasks (same rule as invoices.controller.ts).
/** Changing an invoice: editing it, its report status or withholding. */
export const updateGrant = (kind) => (kind === 'P' ? ['purchases', 'edit', 'update_purchase'] : ['sales', 'edit']);
/** Recording or deleting a credit payment on an invoice. */
export const paymentGrant = (kind) => (kind === 'P' ? ['purchases', 'edit', 'record_payment_p'] : ['sales', 'edit']);

/** Settings tabs and what each needs. */
export const SETTINGS_TABS = [
  { id: 'company', label: 'Company profile & tax rules', grants: [['settings', 'view']] },
  { id: 'lists', label: 'Dropdown lists (Setting)', grants: [['lookups', 'view'], ['lookups', 'edit']] },
  { id: 'users', label: 'Users', grants: [['users', 'view']] },
  { id: 'roles', label: 'Roles & Permissions', grants: [['roles', 'view']] },
  { id: 'activity', label: 'Activity log', grants: [['audit', 'view']] },
  { id: 'export', label: 'Export & backup', grants: [['export', 'view'], ['export', 'export']] },
];
export const settingsTabsFor = (user) => SETTINGS_TABS.filter((t) => canAny(user, ...t.grants));

export const COMPANY_RIGHTS = [
  { id: 'view', label: 'View' },
  { id: 'create', label: 'Create' },
  { id: 'edit', label: 'Edit' },
  { id: 'delete', label: 'Delete' },
  { id: 'export', label: 'Export' },
];

/**
 * Right for records of one company (an invoice's party, a supplier): users with access to all
 * companies have every right; otherwise the rights given for that company when the user was set up.
 * Records without a company follow the role alone.
 */
export function canCompany(user, partyId, right) {
  if (!user) return false;
  if (isAdmin(user) || user.access_all_parties || partyId == null) return true;
  return !!user.party_rights?.[partyId]?.[right];
}
```

**Resources** seen across the app (role permission keys): `purchases`, `sales`, `reconciliation`, `withholding`,
`credit`, `inventory`, `vat`, `parties`, `products`, `reports`, `settings`, `lookups`, `users`, `roles`, `audit`,
`export`. **Rights** per resource: `view`, `create`, `edit`, `delete`, `export`. Some resources have extra named
**tasks** that gate a right more finely (seen in code): `purchases.update_purchase`, `purchases.record_payment_p`,
`users.update_user`, `users.assign_roles_companies`, `reconciliation.create_bank_tx`, `reconciliation.run_automatch`,
`reconciliation.import_bank`. `GET /api/roles/resources` must return the full catalog of resources (with
`description` and their `tasks: [{id, label, right}]`) and the list of `rights` (with `label`) — this drives the
Roles & Permissions editor UI dynamically, so **the backend is the single source of truth for this catalog**, not
the frontend.

A user object (`GET /api/auth/me`, and rows in `GET /api/users`) has (fields referenced anywhere in the frontend):
```
{
  id, username, full_name, role, role_label, role_id,
  permissions: { [resource]: { [right_or_task]: boolean } },
  access_all_parties: boolean,
  party_rights: { [partyId]: { view, create, edit, delete, export } },   // only when access_all_parties=false
  assigned_parties: [{ id, name, rights: {...} }],                       // for display
  assigned_party_ids: [id],                                              // convenience array
  party_id: number|null,          // set ONLY for a company-portal login (that party's own account)
  company_name: string,           // when party_id set — the company's own name (shown on change-password page)
  must_change_password: boolean,  // forces redirect to /change-password everywhere
  active: boolean,
  last_login: isoDatetime|null,
  created_at: isoDatetime,
}
```

Three kinds of signed-in identity:
1. **Staff user**, `party_id = null`: role + optional company restriction (`access_all_parties` / `party_ids` / `party_rights`) as above.
2. **Administrator**: `role === 'admin'` → implicitly all rights everywhere, `isAdmin()` true, bypasses all checks.
3. **Company portal account**: `party_id` set — represents one `parties` row's own login. Can ONLY reach `/api/portal/*`
   and `/api/auth/*` (and change-password). Middleware forces these accounts to `/portal` and blocks staff from it.

Page-level guard (`frontend/middleware.js` + `canOpenPage`) — mirror server-side on each matching endpoint's `view`
right:
```
/purchases/new        -> purchases.create
/purchases/:id/edit   -> purchases.edit (task update_purchase)
/purchases, /purchases/:id -> purchases.view
/sales/new            -> sales.create
/sales/:id/edit       -> sales.edit
/sales, /sales/:id    -> sales.view
/reconciliation*      -> reconciliation.view
/withholding*         -> withholding.view
/credit*              -> credit.view
/inventory*           -> inventory.view
/vat*                 -> vat.view
/parties*             -> parties.view
/products*            -> products.view
/reports*             -> reports.view
/admin*               -> users.view (redirects to /settings?tab=users)
/settings?tab=X        -> settingsTabsFor(user) must include tab X
```
Admins bypass all of the above. A signed-in user who must change password is blocked from everything except
`/change-password` and `/api/auth/*`.

## Entities (inferred from every endpoint below)

- **User**: id, username (unique), full_name, password_hash, role (fk→Role.name or role_id fk), active,
  must_change_password, access_all_parties, last_login, created_at, party_id (nullable fk→Party, for company logins).
- **UserPartyRight**: user_id, party_id, view/create/edit/delete/export booleans (only rows for restricted users).
- **Role**: id, name (unique code), label, description, permissions (JSON: `{resource: {right/task: bool}}`),
  is_system (bool — `admin`, and presumably `viewer`/others seeded), user_count (computed).
- **Party** (suppliers/customers — "Supplier list"): id, tin, name, type (`Supplier`|`Customer`|`Both`), mrc1, mrc2,
  mrc3, phone, email, address, profile (JSON — the 7-section Company Profile form, see below), login_username,
  login_password_hash, login_active, created_at.
- **CompanyProfile** (embedded JSON on Party AND on the owning Company/Settings row — same shape, see "Company
  Profile" section below): general, address, contacts, licenses, banks, receipts, receipt_status — each with a
  `round` field and most with an `items: []` array; updated_at, updated_by.
- **Product**: id, code (unique, user-editable but suggested), name_en, name_am, category, brand, model, serial_no,
  unit (fk→unit lookup id), track_stock (bool), min_stock, opening_stock, purchase_price, selling_price, notes,
  created_at. Computed (not stored, derived from purchase/sale/issue lines): stock_in, stock_out, current_stock
  (= opening + stock_in − stock_out), unit_cost (average purchase cost), stock_value (current_stock × unit_cost),
  status (`In stock`|`Low stock`|`Out of stock`, from current_stock vs min_stock / 0).
- **Invoice** (purchases AND sales share one shape, discriminated by `kind`: `'P'`|`'S'`): id, kind, invoice_no
  (editable, e.g. `P0001`/`S0001`), payment_type (`Cash`|`Credit`), vat_category (`G`|`S`), calendar_type (`E`|`G`,
  display-only — date is always stored as Gregorian ISO), party_tin, party_name, party_id (fk→Party, resolved by
  TIN if it matches; nullable for unregistered), date (ISO), fy (int), fy_month (0–11 index into FY_MONTHS),
  receipt_type (`MRC`|`Manual`|`Electronics`), mrc_number, vat_receipt_no, report_status (`Not Reported`|`Reported`),
  notes, wh_receipt_type (`With Receipt`|`Without Receipt`|`Government`|`Exempt`|null), wh_receipt_no,
  wh_receipt_date, wh_paid, created_by (user), updated_by (user), created_at, updated_at. Computed: total_amount,
  excise_amount, vatable_service_fee, taxable_amount, vat_amount, non_vatable_fee, grand_total (sums of lines — see
  calc.js below), wh (object, see `computeWithholding`), amount_due (= grand_total − wh.expected), amount_paid (sum
  of payments), balance (= amount_due − amount_paid).
- **InvoiceLine**: id, invoice_id, line_no, product_code (optional, fk by code→Product), description, unit (fk→unit
  lookup id), tx_type (int — purchase/sales type id, see PURCHASE_TYPES/SALES_TYPES below), transaction_type
  (`Vatable`|`Non-Vatable`|`Zero Rated`|`Tax Exempt`), qty, unit_price, excise_rate (%), vatable_service_fee,
  non_vatable_fee. Computed (see calc.js): total, excise_amount, taxable_amount, vat_amount, line_total.
- **Payment**: id, invoice_id (fk, either purchase or sale), date, amount, method (lookup `payment_method`),
  reference.
- **StockIssue**: id, issue_no, date, product_id, department, purpose, approved_by, qty.
- **Setting** (singleton row): company_name, company_tin, company_address, vat_rate (fraction, default 0.15),
  wh_rate (fraction, default 0.03), wh_goods_threshold (default 20000), wh_service_threshold (default 10000),
  plus the company's own CompanyProfile JSON.
- **LookupList / LookupValue**: list (string id, e.g. `unit`, `payment_type`, `product_category`, `department`,
  `payment_method`, `receipt_type`, `vat_category`, `calendar_type`, `purchase_type`, `sales_type`,
  `transaction_type`, `report_status`, `wh_receipt_type`, `bank`), each with metadata {title, sheet (nullable —
  which workbook "Setting" column it maps to), editable (bool), numeric (bool — IDs like `unit`), locked per-value
  flag for system values that can't be removed. Value row: {value, label, locked}.
- **AuditLog**: id, at (datetime, format `YYYY-MM-DD HH:MM:SS` UTC naive — frontend does
  `new Date(a.at.replace(' ', 'T') + 'Z')`), user_id/username, action (`create`|`update`|`delete`|`other`), entity
  (string id matching `GET /audit/entities`), summary (human text).
- **BankAccount** (reconciliation): id, account_no (1–10, unique "tab" number), bank_name (from `bank` lookup),
  account_name, account_number, currency (default `ETB`), opening_balance, notes. Computed: total_debit,
  total_credit, current_balance (= opening + credits − debits), tx_count.
- **BankTransaction**: id, bank_account_id (fk), row_no, bank_code (auto-generated if blank), value_date,
  purchase_code_1, purchase_code_2 (optional links to Invoice.invoice_no, kind=P), debit, purchase_remark,
  sales_code_1, sales_code_2 (links to Invoice.invoice_no, kind=S), credit, sales_remark. Computed per matched
  purchase/sale: purchase_expected / purchase_difference, sales_expected / sales_difference.
- **VatAdjustment**: fy, line_no, fy_month (0–11), amount (manual-only lines + line 195 opening credit for Hamle).

## Shared business logic — copy these formulas EXACTLY

### `frontend/lib/shared/calc.js` (verbatim — port 1:1 to backend, same rounding)

```js
// Tax calculation rules (from "All In One Sales.xlsx"). Shared by server and browser.

export const DEFAULT_RULES = {
  vat_rate: 0.15,
  wh_rate: 0.03,
  wh_goods_threshold: 20000,
  wh_service_threshold: 10000,
};

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
export const RECEIPT_PREFIX = { MRC: 'FS', Manual: 'M' };
export function receiptNumberError(receiptType, receiptNo) {
  const prefix = RECEIPT_PREFIX[receiptType];
  if (!prefix || !receiptNo) return null;
  const no = String(receiptNo).toUpperCase();
  if (!no.startsWith(prefix)) return `${receiptType} receipt numbers must start with “${prefix}”`;
  if (no.length === prefix.length) return `Enter the receipt number after “${prefix}”`;
  return null;
}
export const REPORT_STATUSES = ['Not Reported', 'Reported'];
export const WH_RECEIPT_TYPES = ['With Receipt', 'Without Receipt', 'Government', 'Exempt'];

// Input categories, in declaration order. IDs 1–6 come from the workbook; 7 separates line 85 from 130.
export const PURCHASE_TYPES = [
  { value: 1, label: 'Local Purchase Capital Asset', line: 65, tt: 'Vatable' },
  { value: 2, label: 'Imported Capital Asset', line: 75, tt: 'Vatable' },
  { value: 7, label: 'Purchase No VAT or Unclaimed Input (capital)', line: 85, tt: 'Non-Vatable' },
  { value: 3, label: 'Local Purchase Input', line: 100, tt: 'Vatable' },
  { value: 4, label: 'Imported Input', line: 110, tt: 'Vatable' },
  { value: 5, label: 'General Expense Input Purchase', line: 120, tt: 'Vatable' },
  { value: 6, label: 'Purchase No VAT or Unclaimed Input', line: 130, tt: 'Non-Vatable' },
];
export const SALES_TYPES = [
  { value: 1, label: 'Taxable sale', line: 5, tt: 'Vatable' },
  { value: 2, label: 'Zero-rated sale', line: 15, tt: 'Zero Rated' },
  { value: 3, label: 'Tax-exempt sale', line: 20, tt: 'Tax Exempt' },
];

export const typesFor = (kind) => (kind === 'S' ? SALES_TYPES : PURCHASE_TYPES);
export const unitLabel = (v) => (UNITS.find((u) => u.value === +v) || {}).label || '';

export const round2 = (n) => Math.round((Number(n) || 0) * 100 + Number.EPSILON) / 100;
const num = (v) => {
  const n = Number(String(v ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
};

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
export function computeLine(line, rules = DEFAULT_RULES) {
  const qty = num(line.qty);
  const unit_price = num(line.unit_price);
  const excise_rate = num(line.excise_rate);
  const vatable_service_fee = num(line.vatable_service_fee);
  const non_vatable_fee = num(line.non_vatable_fee);
  const total = round2(qty * unit_price);
  const excise_amount = round2(total * excise_rate / 100);
  const taxable_amount = round2(total + excise_amount + vatable_service_fee);
  const vat_amount = line.transaction_type === 'Vatable' ? round2(taxable_amount * rules.vat_rate) : 0;
  const line_total = round2(taxable_amount + vat_amount + non_vatable_fee);
  return {
    ...line, qty, unit_price, excise_rate, vatable_service_fee, non_vatable_fee,
    total, excise_amount, taxable_amount, vat_amount, line_total,
  };
}

export function computeTotals(lines) {
  const t = {
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
  for (const k of Object.keys(t)) t[k] = round2(t[k]);
  return t;
}

/**
 * Withholding (P. Summery columns U–X).
 *   Goods   > 20,000 taxable  -> "Goods WH"
 *   Service > 10,000 taxable  -> "Service WH"  (workbook mislabelled this "Goods WH")
 *   Expected WH = base × 3% when the WH receipt type is "With Receipt"
 */
export function computeWithholding(inv, rules = DEFAULT_RULES) {
  const base = num(inv.taxable_amount);
  let status = 'No WH';
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
```

Note: `wh.status` display values used across the UI: `'No WH'`, `'No Data'`, `'Goods WH'`, `'Service WH'`. A
transaction is "subject to withholding" (shows in `/api/withholding/*`) only when `applicable` is true.
"Penalty" flag (`r.penalty` in Withholding page) = truthy badge text when the WH receipt's tax month differs from
the invoice's tax month — compute via `taxPeriod(wh_receipt_date)` vs the invoice's own `{fy, fy_month}` (see
`WithholdingCard` in `InvoiceView.js`: `sameMonth = whMonth && whMonth.fy === inv.fy && whMonth.idx === inv.fy_month`,
penalty label shown is presumably `'Penalty risk'` when not same month and a receipt date is set).

### `frontend/lib/shared/ethiopian.js` (verbatim — port 1:1 to backend)

```js
// Ethiopian calendar conversion and tax-period helpers.
// Shared by the server (Node) and the browser.
//
// The Ethiopian fiscal / VAT year runs Hamle (month 11) -> Sene (month 10).
// Pagume (month 13, 5-6 days) is folded into Nehase for tax reporting,
// exactly as the original workbook does (Nehase = Aug 7 - Sep 10).

export const EC_MONTHS = [
  'Meskerem', 'Tikimt', 'Hidar', 'Tahsas', 'Tir', 'Yekatit',
  'Megabit', 'Miazia', 'Ginbot', 'Sene', 'Hamle', 'Nehase', 'Pagume',
];

// Order of months inside one fiscal year (index 0..11).
export const FY_MONTHS = [
  'Hamle', 'Nehase', 'Meskerem', 'Tikimt', 'Hidar', 'Tahsas',
  'Tir', 'Yekatit', 'Megabit', 'Miazia', 'Ginbot', 'Sene',
];

const EC_EPOCH = 1723856; // JDN offset used by the standard conversion

function gregorianToJdn(y, m, d) {
  const a = Math.floor((14 - m) / 12);
  const yy = y + 4800 - a;
  const mm = m + 12 * a - 3;
  return d + Math.floor((153 * mm + 2) / 5) + 365 * yy + Math.floor(yy / 4)
    - Math.floor(yy / 100) + Math.floor(yy / 400) - 32045;
}

function jdnToGregorian(jdn) {
  const a = jdn + 32044;
  const b = Math.floor((4 * a + 3) / 146097);
  const c = a - Math.floor(146097 * b / 4);
  const d = Math.floor((4 * c + 3) / 1461);
  const e = c - Math.floor(1461 * d / 4);
  const m = Math.floor((5 * e + 2) / 153);
  return {
    day: e - Math.floor((153 * m + 2) / 5) + 1,
    month: m + 3 - 12 * Math.floor(m / 10),
    year: 100 * b + d - 4800 + Math.floor(m / 10),
  };
}

function ethiopianToJdn(y, m, d) {
  return EC_EPOCH + 365 + 365 * (y - 1) + Math.floor(y / 4) + 30 * m + d - 31;
}

function jdnToEthiopian(jdn) {
  const r = (jdn - EC_EPOCH) % 1461;
  const n = (r % 365) + 365 * Math.floor(r / 1460);
  return {
    year: 4 * Math.floor((jdn - EC_EPOCH) / 1461) + Math.floor(r / 365) - Math.floor(r / 1460),
    month: Math.floor(n / 30) + 1,
    day: (n % 30) + 1,
  };
}

function parseIso(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  if (!m) return null;
  return { year: +m[1], month: +m[2], day: +m[3] };
}

const pad = (n, w = 2) => String(n).padStart(w, '0');

/** '2026-09-30' -> { year: 2019, month: 1, day: 20 } */
export function toEthiopian(iso) {
  const g = parseIso(iso);
  if (!g) return null;
  return jdnToEthiopian(gregorianToJdn(g.year, g.month, g.day));
}

/** Ethiopian y/m/d -> '2026-09-30' (returns null for an invalid EC date) */
export function toGregorian(year, month, day) {
  year = +year; month = +month; day = +day;
  if (!year || month < 1 || month > 13 || day < 1) return null;
  const maxDay = month === 13 ? (year % 4 === 3 ? 6 : 5) : 30;
  if (day > maxDay) return null;
  const g = jdnToGregorian(ethiopianToJdn(year, month, day));
  return `${g.year}-${pad(g.month)}-${pad(g.day)}`;
}

/** Human-readable Ethiopian date: '20 Meskerem 2019' */
export function formatEthiopian(iso) {
  const e = toEthiopian(iso);
  return e ? `${e.day} ${EC_MONTHS[e.month - 1]} ${e.year}` : '';
}

/**
 * Tax period for a Gregorian date.
 * fy      – fiscal year number (the EC year in which Sene falls, e.g. 2019)
 * idx     – 0..11 position inside FY_MONTHS
 * month   – month name used for the declaration
 */
export function taxPeriod(iso) {
  const e = toEthiopian(iso);
  if (!e) return null;
  const m = e.month === 13 ? 12 : e.month; // Pagume -> Nehase
  const fy = m >= 11 ? e.year + 1 : e.year;
  const idx = m >= 11 ? m - 11 : m + 1;
  return { fy, idx, month: FY_MONTHS[idx], ecYear: e.year };
}

/** Fiscal year of today's date (or a given ISO date). */
export function currentFiscalYear(iso) {
  const d = iso || new Date().toISOString().slice(0, 10);
  return taxPeriod(d).fy;
}

/** Gregorian start/end (inclusive) of a fiscal-year month. */
export function periodRange(fy, idx) {
  const ecMonth = idx < 2 ? idx + 11 : idx - 1;
  const ecYear = idx < 2 ? fy - 1 : fy;
  const start = toGregorian(ecYear, ecMonth, 1);
  let end;
  if (idx === 1) end = toGregorian(ecYear, 13, ecYear % 4 === 3 ? 6 : 5); // Nehase incl. Pagume
  else end = toGregorian(ecYear, ecMonth, 30);
  return { start, end };
}

export function fiscalYearLabel(fy) {
  return `FY ${fy - 1}/${String(fy).slice(-2)} E.C.`;
}
```

`fy_month` stored on an invoice = `taxPeriod(date).idx` (0–11); `fy` stored = `taxPeriod(date).fy`. `GET
/api/fiscal-years` returns the distinct list of `fy` values that have any data, for the period-filter dropdown
(at minimum the current fiscal year, per `useCurrentFy` depending on `GET /settings` → `current_fy`).

VAT declaration mapping (from README, authoritative for `/api/vat`):
| Purchase type (`tx_type`) | Line |
|---|---|
| 1 Local capital assets | 65 / VAT 70 |
| 2 Imported capital assets | 75 / VAT 80 |
| 3 Local inputs | 100 / VAT 105 |
| 4 Imported inputs | 110 / VAT 115 |
| 5 General expense inputs | 120 / VAT 125 |
| 6 No VAT / uncollectible | 130 |
| 7 No VAT / uncollectible (capital) | 85 |

| Sales type (`tx_type`) | Line |
|---|---|
| 1 Taxable | 5 / VAT 10 |
| 2 Zero-rated | 15 |
| 3 Exempt | 20 |

Line 185/190 = line 60 − (95 + 170 + 175 + 180) (due if positive → 185, credit if negative → 190); line 195 is
carried forward from the previous month's line 205 (manually entered as the opening credit for the fiscal year's
first month, Hamle, via `PUT /vat/adjustments` with `line_no: 195, fy_month: 0`); line 200 is the net VAT payable.
Lines with `kind: 'manual'` (reverse taxation, debit/credit notes, government vouchers, other credits/refunds) are
free-entry per month via `PUT /vat/adjustments`; all other lines are computed from recorded transactions.
`VAT_TOTAL` lines (rendered bold, from `VatPage` client code): `{55, 60, 90, 95, 165, 170, 185, 190, 200, 205}`.

## Company Profile JSON shape ("Other Detail Registration Format", Form 00001)

Used identically for the company's own profile (`/api/company-profile`), each Party's profile
(`profile` field on `/api/parties/:id` and `/api/parties/profile-template`), and read-only in the portal
(`/api/portal/company` → `company.profile`). Shape (inferred from every field path referenced in
`frontend/components/CompanyProfile.js`):

```
{
  general: {
    round, company_name, tin_copy: bool, vat_copy: bool, tin, tin_issue_date,
    vat_registered: true|false|null, vat_number, vat_registration_date,
    tax_center, commercial_reg_no, commercial_reg_date, license_count, first_license_date,
    business_type: 'PLC'|'SOL'|'SC'|'Other', business_type_other,
  },
  address: { round, region, zone, woreda, house_no, location, email, phone, phone2 },
  contacts: {
    round,
    // one entry per `options.contact_roles` key (server-defined roster, e.g. owner/manager/accountant/other)
    [roleKey]: { name, phone, phone2, email, remark, title? }  // `title` only present on the `other` role
  },
  licenses: {
    round, commercial_certificate: bool, license_total, license_collected,
    items: [{ license_no, field, status, registration_date }]   // max = options.max_licenses
  },
  banks: {
    round,
    items: [{ bank_name, account_number, opened, closed, branch }]   // max = options.max_banks
  },
  receipts: {
    round,
    items: [{ type, requirement, print_status }]   // one row per fixed receipt type, server-defined list
  },
  receipt_status: {
    round, mor_old_ordered, mor_old_collected, mor_new_ordered, mor_new_collected,
    items: [{ type, current, collection, old_void }]   // same receipt-type roster as `receipts.items`
  },
  updated_at, updated_by,   // only on GET, not editable by client
}
```

`GET /company-profile` and `GET /parties/:id` / `GET /parties/profile-template` must also return an `options`
object alongside the profile data (NOT persisted, server-computed catalog):
```
options: {
  rounds: [...],                 // choices for the "Round" selector per section, e.g. [1,2,3] or similar
  business_types: ['PLC','SOL','SC','Other'],
  contact_roles: [{ key, label }, ...],   // roster used to render `contacts.*`
  max_licenses: number,
  max_banks: number,
  choices: {
    requirement: [...],   // options for receipts.items[].requirement
    print_status: [...],  // options for receipts.items[].print_status
    current: [...], collection: [...], old_void: [...],  // for receipt_status.items[]
  },
}
```
(Exact option values aren't visible in the frontend — it only renders whatever `opt.*` arrays the server sends via
`<Choice options={...}>` — so these are free to define sensibly, e.g. `rounds: [1,2,3]`, `requirement: ['Required','Not required']`, `print_status: ['Printed','Not printed']`, `current: ['Yes','No']`, `collection: ['Yes','No']`, `old_void: ['Voided','Not voided']` — but the SAME roster must be used consistently for `receipts.items` and `receipt_status.items` since they're rendered keyed by `r.type`.)

`PUT /company-profile` and `POST`/`PUT /parties[/:id]` return the same shape minus `options` is fine too (frontend
destructures `const { options, ...profile } = await api.put(...)` and tolerates `options` being absent by keeping
the previous `opt`).

---

## Endpoints by feature area

### Auth (`/api/auth/*`) — reachable without a session except `/me`, `/password`, `/logout`

| Method & path | Body | Response | Notes |
|---|---|---|---|
| `GET /api/auth/status` | – | `{ hasUsers: boolean, company_name: string }` | Used by login/signup pages to show "first run" messaging and the auth shell's company name. |
| `POST /api/auth/signup` | `{ full_name, username, password, confirm }` | 200 `{ first: boolean }` on success; else non-2xx `{ error, fields? }` with fields among `full_name`, `username`, `password`, `confirm` | First-ever signup becomes `role: 'admin'`, `active: true`. Subsequent signups created `active: false` (pending) with default role (e.g. `viewer`). `first` tells the client which toast to show. |
| `POST /api/auth/login` | `{ username, password, remember: boolean }` | 200 + `set-cookie: psm_session=...` (no body needed, client ignores it beyond `res.ok`); else `{ error }` | Reject inactive/pending users and locked-out usernames with a clear `error` message. `remember` controls cookie `Max-Age` (30d vs session/12h per README). |
| `GET /api/auth/me` | – | 200 user object (shape above) or **401** (no body needed, but client only checks `res.ok`) | Called by BFF (`sessionUser`) on every page load AND by `SessionProvider` client-side. Must be fast and side-effect-free. |
| `POST /api/auth/password` | `{ current_password, new_password }` OR `{ current_password, new_password, confirm }` (both call sites used; backend should ignore `confirm`, it's a client-only check) | 200 (any truthy body ok, frontend ignores it) or `{ error, fields: { current_password?, password?, confirm? } }` | Verifies `current_password`, sets new hash, clears `must_change_password`. Min length 8 enforced both client and server. |
| `POST /api/auth/logout` | – | 204 (clear cookie) | |

### Dashboard

| `GET /api/dashboard?fy=<int>` | – | see shape below | Requires `reports.view`. |

```
{
  totals: { sales, salesCount, salesVat, purchases, purchaseCount, purchaseVat, vatPayable, creditCarried },
  stock: { value, items, low: [{ code, name, current, min }] },
  payables: { amount, count },      // open credit purchases
  receivables: { amount, count },   // open credit sales
  whPending: { amount, count },     // outstanding withholding across purchases
  months: [string x12],             // FY_MONTHS labels for the selected fy
  series: { S: number[12], P: number[12] },  // taxable amount by month
  unreported: { P: number, S: number },      // count of report_status='Not Reported'
  topSuppliers: [{ name, n, amount }],       // top purchase parties by amount
  topCustomers: [{ name, n, amount }],       // top sale parties by amount
  recent: [{ id, kind: 'P'|'S', invoice_no, date, party_name, payment_type, grand_total }],
}
```

### Purchases / Sales (`/api/purchases/*`, `/api/sales/*`) — identical shape, `kind` implied by path

| Method & path | Body | Response |
|---|---|---|
| `GET /api/purchases?fy=&month=&q=&status=&payment=` | – | array of list rows (below) |
| `GET /api/sales?fy=&month=&q=&status=&payment=` | – | same shape |
| `GET /api/purchases/next-number` / `/api/sales/next-number` | – | `{ number: string }` (e.g. next `P0007`) |
| `POST /api/purchases` / `POST /api/sales` | header + `lines[]` (shape below) | created full invoice (detail shape) |
| `GET /api/purchases/:id` / `GET /api/sales/:id` | – | full invoice (detail shape) |
| `PUT /api/purchases/:id` / `PUT /api/sales/:id` | header + `lines[]` | updated full invoice |
| `DELETE /api/purchases/:id` / `DELETE /api/sales/:id` | – | 204. Requires `canFor(resource,'delete',party_id)` — i.e. role `delete` right AND company-level delete right. |
| `POST /api/purchases/report-status` / `POST /api/sales/report-status` | `{ ids: number[], status: 'Reported'|'Not Reported' }` | 200 (bulk update; list reloads after) |
| `PUT /api/purchases/:id/withholding` / `PUT /api/sales/:id/withholding` | `{ wh_receipt_type, wh_receipt_no, wh_receipt_date, wh_paid }` | updated full invoice |
| `POST /api/purchases/:id/payments` / `POST /api/sales/:id/payments` | `{ date, amount, method, reference }` | updated full invoice (with new payment in `payments[]`) |
| `DELETE /api/payments/:id` | – | updated full invoice (payment removed) — note: shared route, not nested under purchases/sales |

List row shape (`GET /purchases` / `GET /sales`):
```
{
  id, invoice_no, date, fy, fy_month, party_name, party_tin, party_id,
  receipt_type, vat_receipt_no, payment_type, report_status,
  taxable_amount, vat_amount, grand_total, balance,
  wh: { status, applicable, base, expected, paid, outstanding },
}
```
Query params: `fy` (required for the list to actually fetch, per `InvoiceList`), `month` (0–11 fy-month index,
omit/blank = whole year), `q` (free-text over invoice_no/party name/TIN/line descriptions), `status` (= report_status
exact match), `payment` (= payment_type exact match).

Header fields accepted on create/update (`POST`/`PUT`):
```
{
  invoice_no, payment_type: 'Cash'|'Credit', vat_category: 'G'|'S', calendar_type: 'E'|'G',
  party_tin, party_name, date (ISO Gregorian), receipt_type: 'MRC'|'Manual'|'Electronics',
  mrc_number, vat_receipt_no, report_status, notes,
  lines: [{ product_code, description, unit, tx_type, transaction_type, qty, unit_price,
            excise_rate, vatable_service_fee, non_vatable_fee }]
}
```
Validation implied by the form: `invoice_no` required unique-ish (editable, not strictly enforced unique by UI),
`payment_type` required, `vat_category` required, `party_tin` optional but if it matches an existing Party, resolve
`party_id` and keep `party_name` in sync; if TIN is new and non-empty, the party should be auto-registered (README:
"New TIN – will be registered", seen as a hint in `InvoiceForm.js`). `date` required. `receipt_type` required.
`mrc_number` required only when `receipt_type === 'MRC'`. `vat_receipt_no` required and must match the
`RECEIPT_PREFIX` rule (`receiptNumberError`) for `MRC`/`Manual` receipt types (no prefix check for `Electronics`).
Each line requires `unit` and at least `description`, `qty`, `unit_price` — surface errors as
`fields['line_items'][index][fieldName]` per `errors.line_items?.[i]?.[k]` usage, and a top-level `fields.lines`
message is also read (`formError + ' — ' + errors.lines`).

Full/detail shape (`GET`/`POST`/`PUT` response for one invoice) — superset of list row:
```
{
  ...list row fields..., kind: 'P'|'S',
  total_amount, excise_amount, vatable_service_fee, non_vatable_fee,
  amount_due, amount_paid,
  wh_receipt_type, wh_receipt_no, wh_receipt_date, wh_paid,
  notes, created_by, updated_by, updated_at,
  lines: [{ id, line_no, product_code, description, unit, tx_type, transaction_type, qty, unit_price,
            excise_rate, vatable_service_fee, non_vatable_fee, total, excise_amount, taxable_amount,
            vat_amount, line_total }],
  payments: [{ id, date, method, reference, amount }],
}
```

### Withholding (`/api/withholding/*`) — read-only summary; edits happen via the invoice's own `/withholding` route

| `GET /api/withholding/purchases?fy=&month=` | – | array (below) |
| `GET /api/withholding/sales?fy=&month=` | – | array (below) |

```
[{
  id, invoice_no, date, fy_month, party_name, party_tin,
  wh: { status, base, expected, paid, outstanding },
  wh_receipt_type, wh_receipt_no, wh_receipt_date, wh_month (string month name of the receipt date, via taxPeriod),
  penalty: string|''  // e.g. 'Penalty risk' when wh_receipt_date's tax month != invoice's tax month
}]
```
Only rows where `wh.applicable` is true should be returned (list excludes non-applicable transactions — page copy
says "No transactions subject to withholding in this period" when empty).

### Credit & Payments (`/api/credit/*`)

| `GET /api/credit/purchases?all=1` (omit `all` for open-only) | – | array (below) |
| `GET /api/credit/sales?all=1` | – | array (below) |
| `GET /api/credit/buckets` | – | `[{ label: string }]` — aging bucket definitions, e.g. `0-30`,`31-60`,`61-90`,`90+` (README) |

```
[{ id, invoice_no, date, party_name, party_tin, amount_due, amount_paid, balance, age_days: number,
   age_bucket: string (must exactly match one of the labels from GET /credit/buckets) }]
```
Only `payment_type === 'Credit'` invoices. Without `all=1`, only `balance > 0` (open) rows. `age_days` = days since
invoice date (or since due date if one is modeled — frontend has no separate due-date field, so compute from
`date`). Last bucket (90+) highlighted red on the UI when non-zero.

### Inventory (`/api/products`, `/api/issues`, `/api/stock/*`)

| `GET /api/products` | – | array of Product rows (full shape incl. computed stock fields, see Entities) |
| `GET /api/products/next-code` | – | `{ code: string }` |
| `POST /api/products` | `{ code, name_en, name_am, category, brand, model, serial_no, unit, track_stock, min_stock, opening_stock, purchase_price, selling_price, notes }` | created product |
| `PUT /api/products/:id` | same body | updated product |
| `DELETE /api/products/:id` | – | 204. UI disables delete when `stock_in>0 \|\| stock_out>0` — enforce the same server-side (return an error otherwise). |
| `GET /api/products/:id/movements` | – | `{ in: StockInRow[], out: StockOutRow[] }` scoped to that product |
| `GET /api/issues` | – | `[{ id, issue_no, date, code, name_en, qty, department, purpose, approved_by }]` (product code/name joined in) |
| `POST /api/issues` | `{ date, product_id, qty, department, purpose, approved_by }` | `{ issue_no, ... }`; decrements stock |
| `DELETE /api/issues/:id` | – | 204; returns the qty to stock |
| `GET /api/stock/in` | – | `StockInRow[]` — ALL tracked-product purchase lines (purchase register) |
| `GET /api/stock/out` | – | `StockOutRow[]` — ALL stock-out movements (sales lines of tracked products + issues) |

```
StockInRow  = { purchase_code, product_code, date, grn_no, product_name, supplier_tin, supplier_name,
                quantity, unit_cost, total_cost, remark, invoice_id }
StockOutRow = { date, source: 'Sale'|'Issue', ref_id, ref_no, product_code, product_name, issued_to,
                quantity, purpose, approved_by }
```
`grn_no` = goods-received note number — likely the purchase's `vat_receipt_no` or a dedicated field; since no
separate GRN field exists elsewhere, map it from the purchase receipt number. `source: 'Sale'` rows link to
`/sales/:ref_id`; `source: 'Issue'` (or similar) rows don't link. `issued_to` = customer name for sales, department
for issues.

Product `status` (string, exactly these 3 values used in `Badge` tone lookups): `'In stock'`, `'Low stock'`
(current_stock ≤ min_stock and > 0), `'Out of stock'` (current_stock ≤ 0). `unit_cost` = weighted-average purchase
cost (fallback to `purchase_price` when never purchased, per Reports note: *"Cost uses the average purchase cost of
each product (or its purchase price when it has never been bought)"*). `stock_value = current_stock * unit_cost`.

### Supplier list / Parties (`/api/parties/*`)

| `GET /api/parties?type=&q=` | – | array (below) |
| `GET /api/parties/profile-template` | – | `{ ...blank profile fields incl. profile:{...defaults}, options:{...} }` |
| `GET /api/parties/:id` | – | `{ tin, name, type, mrc1, mrc2, mrc3, profile:{...}, options:{...} }` |
| `POST /api/parties` | `{ tin, name, type, mrc1, mrc2, mrc3, profile }` | created party row (list shape) |
| `PUT /api/parties/:id` | same body | updated party row |
| `DELETE /api/parties/:id` | – | 204. Must fail (`invoice_count > 0` check pre-empted client-side) if the party has any invoices. |
| `POST /api/parties/:id/account` | – | `{ username, password, created: boolean }` — generates a login if none exists (created=true) or issues a new temp password (created=false); invalidates old sessions for that company account |
| `GET /api/parties/:id/statement` | – | `{ party: {...}, totals: {...}, purchases: [...], sales: [...] }` (shape below) |

List row (`GET /parties`):
```
{ id, tin, name, mrc1, mrc2, mrc3, type: 'Supplier'|'Customer'|'Both', phone, address, email,
  login_username: string|null, login_active: boolean, purchased: number, sold: number, invoice_count: number }
```

Statement (`GET /parties/:id/statement`, and the near-identical `GET /portal/statement`):
```
{
  party: { name, tin, mrc1, mrc2, mrc3, phone, email, address, type },
  totals: {
    purchased, purchaseCount, whWithheld, payable,     // our purchases FROM them
    sold, saleCount, whByCustomer, receivable,          // our sales TO them
  },
  purchases: [{ date, type: string, charge: number|0, payment: number|0, balance, invoice_id, ref: invoice_no,
                detail: string }],   // merged ledger: one row per invoice (charge) + one per payment (payment)
  sales: [...same shape...],
}
```
`type` column values seen rendered with `Badge tone={r.charge ? 'info' : 'good'}`: charge rows get a type label
like `'Purchase'`/`'Sale'`, payment rows get `'Payment'` (exact free-text, just needs `charge`/`payment` populated
correctly so the ledger & badge tone work). `detail` is a short description (e.g. item summary or payment method).

Import: `POST /api/import/parties?type=Supplier` (or `?type=Customer`) — raw `.xlsx` body
(`Content-Type: application/octet-stream`) → `{ sheet: string, added: number, updated: number, skipped?: number }`.
Reads the workbook's **"Supplier Lists"** sheet columns: Company TIN, Company Name, MRC-1/2/3 (README), OR a file
previously exported from `/api/export/list/parties` (round-trip). Existing TINs are updated, not duplicated.

### Product list (`/api/products`, `/api/import/products`)

Covered above under Inventory for the CRUD; additionally:
`POST /api/import/products` — raw `.xlsx` body → `{ sheet, added, updated, skipped? }`. Reads the workbook's
**"Product Lists"** sheet (README: No, code, English/Amharic name, category, brand, model, serial no, unit,
min/opening/current stock, status, prices) or a file exported from `/api/export/list/products`.

### Settings

| `GET /api/settings` | – | `{ company_name, company_tin, company_address, vat_rate, wh_rate, wh_goods_threshold, wh_service_threshold, current_fy, rules: { vat_rate, wh_rate, wh_goods_threshold, wh_service_threshold } }` |
| `PUT /api/settings` | `{ vat_rate, wh_rate, wh_goods_threshold, wh_service_threshold }` (fractions, e.g. 0.15 not 15) | updated settings (same shape) |
| `GET /api/company-profile` | – | `{ ...CompanyProfile fields..., options:{...}, updated_at, updated_by }` |
| `PUT /api/company-profile` | full CompanyProfile object (minus `options`/`updated_at`/`updated_by`) | updated `{ ...profile, options, updated_at, updated_by }` |
| `GET /api/lookups` | – | `{ lists: [{ list, title, sheet, editable, numeric }], values: { [list]: [{ value, label, locked }] } }` |
| `POST /api/lookups/:list` | `{ value?, label }` (value optional/omit for non-numeric lists — server assigns next id for numeric lists like `unit`) | full updated `values` map `{ [list]: [...] }` (client calls `lk.set(response)`, replacing its entire values cache) |
| `PUT /api/lookups/:list/:value` | `{ label }` | full updated `values` map |
| `DELETE /api/lookups/:list/:value` | – | full updated `values` map. Must reject (error) if that value is referenced by any existing record and/or if `locked`. |
| `POST /api/lookups/:list/:value/move` | `{ dir: 'up'\|'down' }` | full updated `values` map (reorders display order) |

`GET /lookups` must cover at least these list ids (used directly by name in the frontend):
`unit` (numeric, `editable:false`? — actually units ARE extendable per README "Unit of Measurement... can be
extended" — so `editable:true`, `numeric:true`), `payment_type`, `vat_category`, `calendar_type`, `receipt_type`,
`report_status`, `wh_receipt_type`, `purchase_type`, `sales_type`, `transaction_type`, `product_category`,
`department`, `payment_method`, `bank` (Ethiopian banks list, used by Bank Reconciliation account setup — label
shown as `"{value} — {label}"`). Per README: "Lists the tax calculations depend on are fixed (shown read-only)"
→ `payment_type, vat_category, calendar_type, receipt_type, purchase_type (1-6), wh_receipt_type, transaction_type,
report_status, sales_type (1-3)` should have `editable: false`; "Unit of Measurement, Receipt Type, Product
Category, Department, Payment Method can be extended" — note README calls out Receipt Type as extendable too, so
treat `unit, receipt_type, product_category, department, payment_method, bank` as `editable: true`. `sheet` is the
workbook column name for lists that map to the "Setting" sheet (falsy/absent for "Additional lists" like
`product_category`, `department`, `payment_method`, `bank`).

### Users (`/api/users/*`) — requires `users.view` to list

| `GET /api/users` | – | array of User rows (shape under Entities) |
| `POST /api/users` | `{ username, full_name, role_id, role, access_all_parties, party_ids, party_rights, password }` | created user |
| `PUT /api/users/:id` | partial body: any of `{ full_name, active, password }` (requires task `update_user`) and/or `{ role_id, role, access_all_parties, party_ids, party_rights }` (requires task `assign_roles_companies`) — only fields the caller is allowed to touch are sent | updated user |
| `DELETE /api/users/:id` | – | **the frontend does `setData(await api.del(...))` and treats the result as the new full user list** — so this endpoint should respond with the full updated `User[]` array (not 204), unlike most other deletes in this app. Must refuse deleting admin role users unless caller is admin, and refuse self-delete (UI disables button for `u.id === me.id`, enforce server-side too). |

New user: server generates nothing extra; `password` (min 8 chars, validated client-side already) is the initial
temp password — new users get `must_change_password: true`. Editing: `password` present ⇒ set
`must_change_password: true` again (toast says "they must choose a new password at their next sign-in"). Creating
sets `active` based on business rule (first admin created via signup is active; everyone else from this screen is
presumably active immediately since an admin is creating them directly — but mirror whatever `signup` does for
parity isn't required here since this is a different flow). `access_all_parties: true` ⇒ clear `party_ids`/
`party_rights` server-side (client already sends empty arrays in that case).

### Roles (`/api/roles/*`) — requires `roles.view`

| `GET /api/roles` | – | `[{ id, name, label, description, permissions, is_system, user_count }]` |
| `GET /api/roles/resources` | – | `{ resources: [{ id, name, description, tasks: [{ id, label, right }] }], rights: [{ id, label }] }` |
| `POST /api/roles` | `{ name, label, description, permissions }` | created role |
| `PUT /api/roles/:id` | same body | updated role. Must refuse editing `name: 'admin'`'s permissions (UI always treats admin as all-true and disables its checkboxes). |
| `DELETE /api/roles/:id` | – | 204. Refuse if `is_system` or `user_count > 0` (client pre-checks, server must enforce). |

`resources` catalog must include (at minimum) one entry per resource key listed in the Auth section above, each
with a human `name`/`description` and the task list relevant to it (purchases → `update_purchase`,
`record_payment_p`; users → `update_user`, `assign_roles_companies`; reconciliation → `create_bank_tx`,
`run_automatch`, `import_bank`). `rights` = the 5 standard rights (`view/create/edit/delete/export`) with labels.

### Activity log (`/api/audit/*`) — requires `audit.view`

| `GET /api/audit/entities` | – | `[{ id, label }]` — one per audited area (purchases, sales, products, parties, users, roles, settings, lookups, reconciliation, etc.) |
| `GET /api/audit?limit=500&entity=&q=` | – | `[{ id, at: 'YYYY-MM-DD HH:MM:SS' (UTC naive), username, action: 'create'\|'update'\|'delete'\|'other', entity: id-from-entities, summary: string }]` |

Every create/update/delete across the app (purchases, sales, products, parties, users, roles, settings, lookups,
payments, issues, bank accounts/transactions, company profile, VAT adjustments…) should append an audit row with a
human `summary` (e.g. "created purchase P0007", "deleted product ABC123"). Log the acting user's username (or null
for system/unauthenticated actions, though none should occur).

### Export & backup (`/api/exports`, `/api/export/*`, `/api/backup`)

| `GET /api/exports` | – | `[{ id, label, desc, path (e.g. '/export/purchases'), period: boolean }]` — only the exports the caller's role allows (`export` right per relevant resource) |
| `GET /api/backup` | – | file download: full SQLite DB backup (admin only — gated client-side by `isAdmin`, enforce server-side) |
| `GET /api/export/credit` | – | xlsx download |
| `GET /api/export/stock` | – | xlsx download |
| `GET /api/export/list/stock-in` | – | xlsx download |
| `GET /api/export/list/stock-out` | – | xlsx download |
| `GET /api/export/list/parties` | – | xlsx download (round-trips with `/import/parties`) |
| `GET /api/export/list/products` | – | xlsx download (round-trips with `/import/products`) |
| `GET /api/export/purchases?fy=&month=` | – | xlsx download |
| `GET /api/export/sales?fy=&month=` | – | xlsx download |
| `GET /api/export/withholding?fy=&month=` | – | xlsx download |
| `GET /api/export/vat?fy=` | – | xlsx download |
| `GET /api/export/report/:type?fy=&month=` | `:type` ∈ `monthly\|products\|suppliers\|customers` | xlsx download |

All exports are plain `<a href="/api/...">` links (browser-native download), so these must respond with proper
`Content-Disposition: attachment; filename=...` and the correct xlsx content-type — not JSON. Layouts should mirror
the original workbook sheets per README: **P. Detail, P. Summery, S. Detail, S. Summery, WH, VAT declaration
(Summery Report lines 5–205), Supplier Lists, Product Lists**.

### Reports (`/api/reports/*`) — requires `reports.view`; export requires `reports.export`

| `GET /api/reports/monthly?fy=` | – | `{ rows: [{ month, sales, output_vat, purchases, input_vat, net_vat, wh_on_purchases, wh_on_sales, sales_count, purchase_count }], total: {...same keys, no `month`...} }` |
| `GET /api/reports/products?fy=&month=` | – | `[{ code, name, qty, sales, vat, unit_cost: number\|null, cost: number\|null, profit: number\|null, margin: number\|null }]` (nulls when the line has no product code / no cost basis) |
| `GET /api/reports/parties/purchases?fy=&month=` | – | `[{ party_id: number\|null, name, tin, count, taxable, vat, total, wh, balance }]` |
| `GET /api/reports/parties/sales?fy=&month=` | – | same shape |

### VAT declaration (`/api/vat`, `/api/vat/adjustments`)

| `GET /api/vat?fy=` | – | `{ months: string[12], lines: [{ no, label, kind: 'calc'\|'manual', values: number[12], total, highlight?: boolean }], openingCredit }` |
| `PUT /api/vat/adjustments` | `{ fy, items: [{ line_no, fy_month, amount }] }` | updated `{ months, lines, openingCredit }` (same shape as GET) |

`lines` must include every declaration line number referenced in the README's mapping table plus the computed
summary lines `{55, 60, 90, 95, 165, 170, 185, 190, 195, 200, 205}` and the manual-entry lines for reverse taxation
/ debit-credit notes / government vouchers / other credits / refunds (exact extra line numbers are a VAT-declaration
domain decision — pick sensible ones consistent with the Ethiopian VAT return and mark them `kind: 'manual'`).
`highlight` is cosmetic (CSS class `highlight` on the row) — optional, can omit/always false.

### Bank Reconciliation (`/api/reconciliation/*`) — NOT mentioned in README; a real feature found only in code

| `GET /api/reconciliation/summary` | – | shape below |
| `GET /api/reconciliation/banks` | – | `BankAccount[]` |
| `POST /api/reconciliation/banks` | `{ account_no, bank_name, account_name, account_number, currency, opening_balance, notes }` | created account |
| `PUT /api/reconciliation/banks/:id` | same body | updated account |
| `GET /api/reconciliation/transactions?bankAccountId=&search=` | – | `BankTransaction[]` for that account |
| `POST /api/reconciliation/transactions` | `{ bank_account_id, row_no, bank_code, value_date, purchase_code_1, purchase_code_2, debit, purchase_remark, sales_code_1, sales_code_2, credit, sales_remark }` | created transaction |
| `PUT /api/reconciliation/transactions/:id` | same body | updated transaction |
| `DELETE /api/reconciliation/transactions/:id` | – | 204 |
| `GET /api/reconciliation/purchases?status=all\|reconciled\|partial\|unreconciled\|overpaid&search=` | – | array (below) |
| `GET /api/reconciliation/sales?status=all\|reconciled\|partial\|unreconciled\|overcollected&search=` | – | array (below) |
| `POST /api/reconciliation/auto-match` | – | `{ total_matched, matched_purchases, matched_sales }` |
| `POST /api/reconciliation/import` | raw `.xlsx` body | `{ total_imported }` |
| `GET /api/reconciliation/export` | – | xlsx download (`<a download>`) |

```
summary = {
  total_balance,
  debit:  { total_bank_debit, expected_purchases, variance, reconciliation_rate (0-100), reconciled_count, purchases_count },
  credit: { total_bank_credit, expected_sales, variance, reconciliation_rate (0-100), reconciled_count, sales_count },
}
BankAccount = { id, account_no, bank_name, account_name, account_number, currency, opening_balance,
                total_debit, total_credit, current_balance, tx_count, notes }
BankTransaction = { id, bank_account_id, row_no, bank_code, value_date, purchase_code_1, purchase_code_2,
                    debit, purchase_expected, purchase_difference, purchase_remark,
                    sales_code_1, sales_code_2, credit, sales_expected, sales_difference, sales_remark }
ReconPurchaseRow = { id, no, invoice_no, bank_codes: string[], date, party_name, party_tin, receipt_no,
                      total_before_vat, vat_amount, grand_total, withholding, expected_payment, amount_in_bank,
                      difference, status: 'Reconciled'|'Partial'|'Unreconciled'|'Overpaid' }
ReconSalesRow = same shape, status: 'Reconciled'|'Partial'|'Unreconciled'|'Overcollected'
```
`expected_payment` = `grand_total - withholding` for purchases (or `+` for sales, i.e. what should actually move
through the bank). `status` derives from `amount_in_bank` vs `expected_payment`: `Reconciled` when
`|difference| < 0.01`, `Unreconciled` when nothing linked (`amount_in_bank = 0`), `Partial` when linked but not
equal, `Overpaid`/`Overcollected` when `amount_in_bank > expected_payment`. `bank_codes` = the `bank_code` value(s)
of any `BankTransaction` whose `purchase_code_1`/`purchase_code_2` (or `sales_code_*`) match this invoice's
`invoice_no`. Auto-match (`POST /auto-match`) should link unlinked bank transactions to purchases/sales by exact
amount match (per the UI tooltip: "Automatically link matching transactions by exact amount"). Import reads an
"EC Bank Reconciliation Form" workbook with sheets **Bank 01** through **Bank 10**, one per `BankAccount`
(`account_no` 1–10), each containing transaction rows.

Permissions used here beyond the standard 5 rights: `reconciliation.create` + task `create_bank_tx`,
`reconciliation.edit` + task `run_automatch`, `reconciliation.create` + task `import_bank`, `reconciliation.export`.

### Portal (`/api/portal/*`) — only reachable by a company-account session (`user.party_id` set)

| `GET /api/portal/company` | – | `{ company: { name, tin, type, mrc1, mrc2, mrc3, profile }, issuer: { company_name, company_tin, company_address, wh_rate }, account: { username }, options: {...CompanyProfile options} }` |
| `GET /api/portal/statement` | – | same shape as `/parties/:id/statement` (minus the `party` key — uses `company` from `/portal/company` context instead) |
| `GET /api/portal/invoices?kind=P\|S` | – | `[{ id, invoice_no, date, receipt_type, vat_receipt_no, payment_type, grand_total, balance }]` — only invoices where this party is the counterparty |
| `GET /api/portal/invoices/:id` | – | full invoice detail (same shape as `/purchases/:id`/`/sales/:id`, plus `kind`) — must verify the invoice's `party_id` matches the signed-in portal account, else 403/404 |

`issuer` = the operating company's own settings (for the printed letterhead) — `wh_rate` used to compute the
fallback withholding sentence when no WH has been recorded yet (`Math.round((+s?.wh_rate || 0.03) * 1000) / 10` %).

### Fiscal years

| `GET /api/fiscal-years` | – | `number[]` — all fiscal years that have at least one transaction, descending or ascending (UI just lists them in a `<select>`), used by every `PeriodFilter`. Must include the current fiscal year even with zero transactions (so a brand-new install still has one option). |

---

## Summary checklist for implementation

1. NestJS app, SQLite (per README: "built into Node.js, no database server" — use `node:sqlite` or `better-sqlite3`).
2. Session auth via `psm_session` cookie (server-side session store or signed/stateless JWT cookie — either works;
   must support immediate invalidation for "reset company password" and user deactivation, which favors a DB-backed
   session table).
3. `x-bff-secret` header enforcement when `BFF_SHARED_SECRET` env var is set (see `.env.example` at repo root).
4. Listens on `127.0.0.1:<API_PORT>` (default 5000) per `scripts/run.mjs` / `docker-compose.yml`, reads
   `DATABASE_PATH` env var (default `data/psm.db`).
5. Port every formula in `calc.js` and `ethiopian.js` byte-for-byte (rounding matters for VAT/WH figures matching
   the original workbook).
6. Implement the full permissions model (resources × rights × tasks, company-level overrides) exactly as consumed
   by `frontend/lib/permissions.js` and the Roles & Permissions editor (`GET /roles/resources` drives that UI, so
   get that catalog right first).
7. Excel import/export must round-trip with itself at minimum (export then import of Products/Parties should work)
   and accept the original workbook's sheet names/columns per README for first-time imports.
