// Full schema for the Purchase & Sales Management System. See docs/API_CONTRACT.md for the
// endpoint-by-endpoint spec this was derived from.
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS roles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  description TEXT,
  permissions TEXT NOT NULL DEFAULT '{}', -- JSON: { [resource]: { [right_or_task]: boolean } }
  is_system INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS parties (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tin TEXT,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'Supplier', -- 'Supplier' | 'Customer' | 'Both'
  mrc1 TEXT, mrc2 TEXT, mrc3 TEXT,
  phone TEXT, email TEXT, address TEXT,
  profile TEXT NOT NULL DEFAULT '{}', -- JSON CompanyProfile
  login_username TEXT UNIQUE,
  login_password_hash TEXT,
  login_active INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_parties_tin ON parties(tin);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role_id INTEGER REFERENCES roles(id),
  active INTEGER NOT NULL DEFAULT 1,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  access_all_parties INTEGER NOT NULL DEFAULT 1,
  party_id INTEGER REFERENCES parties(id), -- set only for a company-portal login
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  last_login TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS user_party_rights (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  party_id INTEGER NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
  view INTEGER NOT NULL DEFAULT 0,
  "create" INTEGER NOT NULL DEFAULT 0,
  edit INTEGER NOT NULL DEFAULT 0,
  "delete" INTEGER NOT NULL DEFAULT 0,
  "export" INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, party_id)
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  remember INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS login_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL,
  ip TEXT NOT NULL,
  success INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_login_attempts_username ON login_attempts(username, created_at);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name_en TEXT NOT NULL,
  name_am TEXT,
  category TEXT,
  brand TEXT,
  model TEXT,
  serial_no TEXT,
  unit INTEGER,
  track_stock INTEGER NOT NULL DEFAULT 1,
  min_stock REAL NOT NULL DEFAULT 0,
  opening_stock REAL NOT NULL DEFAULT 0,
  purchase_price REAL NOT NULL DEFAULT 0,
  selling_price REAL NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL, -- 'P' | 'S'
  invoice_no TEXT NOT NULL,
  payment_type TEXT NOT NULL DEFAULT 'Cash', -- 'Cash' | 'Credit'
  vat_category TEXT NOT NULL DEFAULT 'G', -- 'G' | 'S'
  calendar_type TEXT NOT NULL DEFAULT 'G', -- 'E' | 'G'
  party_tin TEXT,
  party_name TEXT,
  party_id INTEGER REFERENCES parties(id),
  date TEXT NOT NULL,
  fy INTEGER NOT NULL,
  fy_month INTEGER NOT NULL,
  receipt_type TEXT NOT NULL DEFAULT 'Manual', -- 'MRC' | 'Manual' | 'Electronics'
  mrc_number TEXT,
  vat_receipt_no TEXT,
  report_status TEXT NOT NULL DEFAULT 'Not Reported',
  notes TEXT,
  wh_receipt_type TEXT,
  wh_receipt_no TEXT,
  wh_receipt_date TEXT,
  wh_paid REAL NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES users(id),
  updated_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_invoices_kind_fy ON invoices(kind, fy, fy_month);
CREATE INDEX IF NOT EXISTS idx_invoices_party ON invoices(party_id);

CREATE TABLE IF NOT EXISTS invoice_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  line_no INTEGER NOT NULL,
  product_code TEXT,
  description TEXT,
  unit INTEGER,
  tx_type INTEGER,
  transaction_type TEXT NOT NULL DEFAULT 'Vatable',
  qty REAL NOT NULL DEFAULT 0,
  unit_price REAL NOT NULL DEFAULT 0,
  excise_rate REAL NOT NULL DEFAULT 0,
  vatable_service_fee REAL NOT NULL DEFAULT 0,
  non_vatable_fee REAL NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_invoice_lines_invoice ON invoice_lines(invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_lines_product ON invoice_lines(product_code);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  amount REAL NOT NULL,
  method TEXT,
  reference TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_payments_invoice ON payments(invoice_id);

CREATE TABLE IF NOT EXISTS stock_issues (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  issue_no TEXT NOT NULL,
  date TEXT NOT NULL,
  product_id INTEGER NOT NULL REFERENCES products(id),
  qty REAL NOT NULL,
  department TEXT,
  purpose TEXT,
  approved_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  company_name TEXT NOT NULL DEFAULT '',
  company_tin TEXT NOT NULL DEFAULT '',
  company_address TEXT NOT NULL DEFAULT '',
  vat_rate REAL NOT NULL DEFAULT 0.15,
  wh_rate REAL NOT NULL DEFAULT 0.03,
  wh_goods_threshold REAL NOT NULL DEFAULT 20000,
  wh_service_threshold REAL NOT NULL DEFAULT 10000,
  current_fy INTEGER,
  profile TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by INTEGER REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS lookup_values (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  list TEXT NOT NULL,
  value TEXT NOT NULL,
  label TEXT NOT NULL,
  locked INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_lookup_values_list ON lookup_values(list, sort_order);
CREATE UNIQUE INDEX IF NOT EXISTS idx_lookup_values_unique ON lookup_values(list, value);

CREATE TABLE IF NOT EXISTS vat_adjustments (
  fy INTEGER NOT NULL,
  line_no INTEGER NOT NULL,
  fy_month INTEGER NOT NULL,
  amount REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (fy, line_no, fy_month)
);

CREATE TABLE IF NOT EXISTS bank_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_no INTEGER NOT NULL UNIQUE,
  bank_name TEXT,
  account_name TEXT,
  account_number TEXT,
  currency TEXT NOT NULL DEFAULT 'ETB',
  opening_balance REAL NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS bank_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bank_account_id INTEGER NOT NULL REFERENCES bank_accounts(id) ON DELETE CASCADE,
  row_no INTEGER,
  bank_code TEXT,
  value_date TEXT,
  purchase_code_1 TEXT, purchase_code_2 TEXT, debit REAL NOT NULL DEFAULT 0, purchase_remark TEXT,
  sales_code_1 TEXT, sales_code_2 TEXT, credit REAL NOT NULL DEFAULT 0, sales_remark TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_bank_tx_account ON bank_transactions(bank_account_id);

CREATE TABLE IF NOT EXISTS activity_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  username TEXT,
  action TEXT NOT NULL, -- 'create' | 'update' | 'delete' | 'other'
  entity TEXT NOT NULL,
  entity_id TEXT,
  summary TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_activity_log_entity ON activity_log(entity, created_at);
`;
