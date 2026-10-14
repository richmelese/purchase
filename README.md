# Purchase & Sales Management System

A local web application that replaces the **All In One Sales.xlsx** workbook: purchases, sales,
VAT (15%), withholding (3%), credit payables/receivables, inventory and the monthly VAT declaration,
following Ethiopian tax months (Hamle → Sene).

## Architecture

```
Browser ──► Next.js (UI + backend-for-frontend, :3000) ──► NestJS API (private, 127.0.0.1:5000) ──► SQLite (data/psm.db)
```

- **Frontend / BFF** (project root): Next.js 15 (App Router, React 19). The browser only ever talks to this
  server. `app/api/[...path]/route.js` forwards every `/api/*` call to the API (cookies, uploads and Excel
  downloads included), and `middleware.js` sends signed-out visitors to the sign-in page.
  Server-only code lives in `lib/server/`.
- **Backend API** (`purchase-backend/`): NestJS 12 + SQLite (built into Node.js, no database server).
  It is never exposed to browsers: it listens on localhost (or the private Docker network) and, when
  `BFF_SHARED_SECRET` is set, rejects any request that did not come through the BFF.
- **Excel:** exports in the same layout as the workbook (P. Detail, P. Summary, WH, VAT declaration…)

## Requirements

- Node.js **22.13 or newer** (tested on 24.19)

## First-time setup

```bash
npm run setup                                                     # installs frontend + backend
npm run import -- "C:UsersHPDocumentsAll In One Sales.xlsx"   # products + suppliers (+ any detail rows)
npm run build
npm start
```

Open <http://localhost:3000>.

| Command | What it does |
|---|---|
| `npm run dev` | API + UI with hot reload (one terminal, Ctrl+C stops both) |
| `npm run build` / `npm start` | Production build / run of both services |
| `npm test` | Backend tests: tax rules + end-to-end API tests on a throw-away database |
| `npm run dev:frontend` / `npm run dev:backend` | Run one side only |

`npm run dev` and `npm start` generate a fresh shared secret for the BFF ↔ API link on every run, so
nothing needs configuring locally. Optional environment variables: `PORT` (UI, default 3000), `HOST`
(default 127.0.0.1 – set to `0.0.0.0` to allow other computers on the network), `API_PORT` (default 5000),
`DATABASE_PATH` (default `data/psm.db`).

### Docker

```bash
cp .env.example .env       # set BFF_SHARED_SECRET to a long random value
docker compose up -d --build
```

Only the frontend is published (port 3000). The API container has no published port and the database
stays in `./data`.

## Demo data

`npm run demo` loads realistic sample data for every page (22 purchases, 19 sales, 14 companies, payments, withholding receipts, stock issues).
`npm run demo:remove` deletes exactly what the demo added and restores the products it changed – run it before entering real transactions.

## Users & sign-in

- Every page and API call requires a signed-in user.
- **First run:** open the app and click **Signup**. The first account becomes the **administrator**.
- Later sign-ups are created as *pending*; an administrator activates them in **Settings › Users** (or creates users directly there).
- **Remember me** keeps you signed in for 30 days; otherwise the session ends when the browser closes (max 12 hours).
- **Forgot password:** an administrator sets a new password in Settings › Users. Users change their own password with the **Password** button in the sidebar.
- Passwords are hashed with scrypt; 5 wrong attempts from one computer lock that user name there for 5 minutes (20 from anywhere lock it everywhere).
- Administrators manage users, company settings, dropdown lists and backups; users can record and view all transactions.

## Modules

| Screen | Replaces sheet | What it does |
|---|---|---|
| Dashboard | – | Sales vs purchases, VAT payable, payables/receivables, WH due, low stock |
| Purchases | P. Detail / P. Summery | Multi-line purchase receipts, TIN lookup, auto IDs `P0001…` |
| Sales | S. Detail / S. Summery | Same for sales, with stock availability check |
| Withholding | P. Summery (WH columns), P WH / S WH | WH status, expected, receipt, paid, outstanding, month check / penalty |
| Credit & Payments | P.CRV / S. CRV | Record partial payments, balances, 0–30/31–60/61–90/90+ aging |
| Inventory | Product Lists (Stock IN / Stock Out / Current Stock Report) | Current stock, Stock IN purchase register, Stock Out (sales + issues), issue register |
| VAT Declaration | Summery Report | Lines 5–205 per month, manual adjustment lines, credit carried forward |
| Supplier List | Supplier Lists (Company Profile) | No, Company TIN, Company Name, MRC-1/2/3, phone, email – Excel import/export |
| Product List | Product Lists (Product Master) | No, code (next code suggested), English/Amharic name, category, brand, model, serial no, unit, min/opening/current stock, status, prices – Excel import/export, per-item stock history |
| Settings | Setting | Company & tax rules · **Dropdown lists** (every Setting-sheet column) · Excel exports & backup |

## Printing, statements, reports and activity log

- **Print invoice / voucher** (on any purchase or sale): A4 layout with company header and TIN, Gregorian and Ethiopian date, tax month, items, totals, amount in words, withholding note and signature lines (Prepared / Checked / Approved / Received).
- **Statement of account** (Supplier List → company name): every purchase, sale and payment with that company and a running payable / receivable balance; printable.
- **Reports**: monthly summary (sales, purchases, output / input / net VAT, withholding), sales by product with average cost, gross profit and margin, purchases by supplier, sales by customer – each printable and exportable to Excel.
- **Activity log** (Settings › Activity log, administrators): who signed in, created, edited or deleted what, and when. Each invoice also shows who recorded and last edited it.

## Dropdown lists (Setting sheet)

Settings › Dropdown lists shows every list from the workbook's Setting sheet:
Payment Type, VAT Category, Calendar Type, Type of Purchase (1–6), Receipt Type, Unit of Measurement (IDs 2–10),
WH Receipt Type, Transaction Type, Report Status and Type of Sales (1–3), plus Product Category, Department and
Payment Method.

- Lists the tax calculations depend on are **fixed** (shown read-only).
- **Unit of Measurement, Receipt Type, Product Category, Department, Payment Method** can be extended, renamed and reordered. A value used by a record cannot be removed.
- Units are shown with their ID exactly like the workbook (`7 – PCS`) and are mandatory on every line.

## Calculation rules

Per line (same as the workbook columns S–AA):

| Field | Formula |
|---|---|
| Total amount | Qty × Unit price |
| Excise tax | Total × Excise rate % |
| Taxable amount before VAT | Total + Excise + VATable service fee |
| VAT | Taxable × 15% when Transaction type = *Vatable*, otherwise 0 |
| Total after VAT | Taxable + VAT + Non-VATable service fee |

Withholding (per receipt): Goods with taxable amount **> 20,000**, or services **> 10,000**, are subject
to WH. Expected WH = taxable × **3%** when the WH receipt status is *With Receipt*. A WH receipt dated
in a different tax month from the transaction is flagged as a penalty risk.

VAT declaration mapping:

| Purchase type | Line |
|---|---|
| 1 Local capital assets | 65 / VAT 70 |
| 2 Imported capital assets | 75 / VAT 80 |
| 3 Local inputs | 100 / VAT 105 |
| 4 Imported inputs | 110 / VAT 115 |
| 5 General expense inputs | 120 / VAT 125 |
| 6 No VAT / uncollectible | 130 |

| Sales type | Line |
|---|---|
| 1 Taxable | 5 / VAT 10 |
| 2 Zero-rated | 15 |
| 3 Exempt | 20 |

185/190 = 60 − (95 + 170 + 175 + 180) (due if positive, credit if negative); 195 is carried
forward from the previous month's line 205; 200 is the net VAT payable.

### Corrections compared to the workbook

- **Taxable amount before VAT** was `=U+V` (excise + fee), which left out the purchase amount. It is now Total + Excise + VATable fee.
- Services above 10,000 were labelled **"Goods WH"**; they now show **"Service WH"**.
- The workbook's Ethiopian month formula was hard-coded for one fiscal year (Hamle 2018 – Sene 2019). The app converts any date, including leap-year Pagume (folded into Nehase, as in the workbook).
- Type 6 purchases go to line **130** (non-capital). Line 85 (capital assets with no VAT) is available as a manual line.
- **S. Summery** was looking up `'P. Detail'` instead of `'S. Detail'`; sales summaries are now computed from sales.

## Data & backup

All data lives in `data/psm.db`. Use **Settings → Download database backup** regularly, or copy the
`data` folder while the app is stopped.
