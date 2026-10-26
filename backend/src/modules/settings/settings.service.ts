import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import type { AuthUser } from '../../common/auth.guard';
import { logActivity } from '../../common/activity-log';
import { currentFiscalYear } from '../../common/ethiopian';
import { mergeCompanyProfile, companyProfileOptions, type CompanyProfile } from '../../common/company-profile';
import {
  UNITS, PAYMENT_TYPES, VAT_CATEGORIES, CALENDAR_TYPES, RECEIPT_TYPES, TRANSACTION_TYPES,
  PURCHASE_TYPES, SALES_TYPES, REPORT_STATUSES, WH_RECEIPT_TYPES,
} from '../../common/calc';

interface LookupListMeta {
  list: string;
  title: string;
  sheet: string | null;
  editable: boolean;
  numeric: boolean;
}

interface SeedValue {
  value: string;
  label: string;
  locked: boolean;
}

interface SettingsRow {
  company_name: string;
  company_tin: string;
  company_address: string;
  vat_rate: number;
  wh_rate: number;
  wh_goods_threshold: number;
  wh_service_threshold: number;
  profile: string;
}

// Lists the tax calculations depend on are fixed (read-only); Unit of Measurement, Receipt Type,
// Product Category, Department, Payment Method and Bank can be extended by the user — see
// docs/API_CONTRACT.md's `GET /lookups` paragraph under "Settings".
const LOOKUP_LISTS: LookupListMeta[] = [
  { list: 'unit', title: 'Unit of Measurement', sheet: 'Unit', editable: true, numeric: true },
  { list: 'payment_type', title: 'Payment Type', sheet: 'Payment Type', editable: false, numeric: false },
  { list: 'vat_category', title: 'VAT Category', sheet: 'VAT Category', editable: false, numeric: false },
  { list: 'calendar_type', title: 'Calendar Type', sheet: 'Calendar Type', editable: false, numeric: false },
  { list: 'receipt_type', title: 'Receipt Type', sheet: 'Receipt Type', editable: true, numeric: false },
  { list: 'purchase_type', title: 'Purchase Type', sheet: 'Purchase Type', editable: false, numeric: false },
  { list: 'sales_type', title: 'Sales Type', sheet: 'Sales Type', editable: false, numeric: false },
  { list: 'transaction_type', title: 'Transaction Type', sheet: 'Transaction Type', editable: false, numeric: false },
  { list: 'report_status', title: 'Report Status', sheet: 'Report Status', editable: false, numeric: false },
  { list: 'wh_receipt_type', title: 'Withholding Receipt Type', sheet: 'WH Receipt Type', editable: false, numeric: false },
  { list: 'product_category', title: 'Product Category', sheet: null, editable: true, numeric: false },
  { list: 'department', title: 'Department', sheet: null, editable: true, numeric: false },
  { list: 'payment_method', title: 'Payment Method', sheet: null, editable: true, numeric: false },
  { list: 'bank', title: 'Bank', sheet: null, editable: true, numeric: false },
];

const SEED_VALUES: Record<string, SeedValue[]> = {
  unit: UNITS.map((u) => ({ value: String(u.value), label: u.label, locked: false })),
  payment_type: PAYMENT_TYPES.map((v) => ({ value: v, label: v, locked: true })),
  vat_category: VAT_CATEGORIES.map((c) => ({ value: c.value, label: c.label, locked: true })),
  calendar_type: CALENDAR_TYPES.map((c) => ({ value: c.value, label: c.label, locked: true })),
  receipt_type: RECEIPT_TYPES.map((v) => ({ value: v, label: v, locked: false })),
  purchase_type: PURCHASE_TYPES.map((p) => ({ value: String(p.value), label: p.label, locked: true })),
  sales_type: SALES_TYPES.map((p) => ({ value: String(p.value), label: p.label, locked: true })),
  transaction_type: TRANSACTION_TYPES.map((v) => ({ value: v, label: v, locked: true })),
  report_status: REPORT_STATUSES.map((v) => ({ value: v, label: v, locked: true })),
  wh_receipt_type: WH_RECEIPT_TYPES.map((v) => ({ value: v, label: v, locked: true })),
  product_category: ['General', 'Raw Material', 'Finished Goods', 'Office Supplies', 'Equipment']
    .map((v) => ({ value: v, label: v, locked: false })),
  department: ['Finance', 'Procurement', 'Sales', 'Warehouse', 'Administration']
    .map((v) => ({ value: v, label: v, locked: false })),
  payment_method: ['Cash', 'Bank Transfer', 'Check', 'Mobile Money']
    .map((v) => ({ value: v, label: v, locked: false })),
  bank: ['Commercial Bank of Ethiopia', 'Awash Bank', 'Dashen Bank', 'Bank of Abyssinia', 'Wegagen Bank']
    .map((v) => ({ value: v, label: v, locked: false })),
};

@Injectable()
export class SettingsService {
  constructor(private readonly db: DatabaseService) {}

  // ---------- Settings (tax rules) ----------

  getSettings() {
    return this.settingsShape(this.settingsRow());
  }

  updateSettings(
    body: { vat_rate?: unknown; wh_rate?: unknown; wh_goods_threshold?: unknown; wh_service_threshold?: unknown },
    user?: AuthUser,
  ) {
    const vat_rate = Number(body.vat_rate);
    const wh_rate = Number(body.wh_rate);
    const wh_goods_threshold = Number(body.wh_goods_threshold);
    const wh_service_threshold = Number(body.wh_service_threshold);
    const fields: Record<string, string> = {};
    if (!Number.isFinite(vat_rate) || vat_rate < 0 || vat_rate > 1) fields.vat_rate = 'Enter a fraction between 0 and 1 (e.g. 0.15)';
    if (!Number.isFinite(wh_rate) || wh_rate < 0 || wh_rate > 1) fields.wh_rate = 'Enter a fraction between 0 and 1 (e.g. 0.03)';
    if (!Number.isFinite(wh_goods_threshold) || wh_goods_threshold < 0) fields.wh_goods_threshold = 'Enter a non-negative number';
    if (!Number.isFinite(wh_service_threshold) || wh_service_threshold < 0) fields.wh_service_threshold = 'Enter a non-negative number';
    if (Object.keys(fields).length) throw new BadRequestException({ error: 'Please check the form', fields });

    this.db.run(
      `UPDATE settings SET vat_rate = ?, wh_rate = ?, wh_goods_threshold = ?, wh_service_threshold = ?,
         updated_at = datetime('now'), updated_by = ? WHERE id = 1`,
      [vat_rate, wh_rate, wh_goods_threshold, wh_service_threshold, user?.id ?? null],
    );
    logActivity(this.db, user, 'update', 'settings', 'settings', 'updated tax rules');
    return this.getSettings();
  }

  private settingsRow(): SettingsRow {
    return this.db.get<SettingsRow>(
      'SELECT company_name, company_tin, company_address, vat_rate, wh_rate, wh_goods_threshold, wh_service_threshold, profile FROM settings WHERE id = 1',
    )!;
  }

  private settingsShape(row: SettingsRow) {
    const rules = {
      vat_rate: row.vat_rate,
      wh_rate: row.wh_rate,
      wh_goods_threshold: row.wh_goods_threshold,
      wh_service_threshold: row.wh_service_threshold,
    };
    return {
      company_name: row.company_name,
      company_tin: row.company_tin,
      company_address: row.company_address,
      ...rules,
      current_fy: currentFiscalYear(),
      rules,
    };
  }

  // ---------- Company profile ----------

  getCompanyProfile() {
    const row = this.settingsRow();
    const profile = mergeCompanyProfile(this.parseProfile(row.profile), row.company_name);
    return { ...profile, options: companyProfileOptions() };
  }

  updateCompanyProfile(body: Partial<CompanyProfile> & Record<string, unknown>, user?: AuthUser) {
    const { options: _options, updated_at: _updatedAt, updated_by: _updatedBy, ...incoming } = body || {};
    const row = this.settingsRow();
    const merged = mergeCompanyProfile(incoming as Partial<CompanyProfile>, row.company_name);
    merged.updated_at = new Date().toISOString();
    merged.updated_by = user?.username ?? null;

    this.db.run(
      `UPDATE settings SET profile = ?, updated_at = datetime('now'), updated_by = ? WHERE id = 1`,
      [JSON.stringify(merged), user?.id ?? null],
    );
    logActivity(this.db, user, 'update', 'settings', 'settings', 'updated company profile');
    return { ...merged, options: companyProfileOptions() };
  }

  private parseProfile(json: string | null | undefined): Partial<CompanyProfile> {
    try {
      return json ? JSON.parse(json) : {};
    } catch {
      return {};
    }
  }

  // ---------- Lookups ----------

  getLookups() {
    this.ensureSeeded();
    return {
      lists: LOOKUP_LISTS.map(({ list, title, sheet, editable, numeric }) => ({ list, title, sheet, editable, numeric })),
      values: this.allValues(),
    };
  }

  addLookupValue(list: string, body: { value?: unknown; label?: unknown }, user?: AuthUser) {
    this.ensureSeeded();
    const meta = this.requireEditableList(list);
    const label = String(body.label ?? '').trim();
    if (!label) throw new BadRequestException({ error: 'Please check the form', fields: { label: 'Required' } });

    let value: string;
    if (meta.numeric) {
      const max = this.db.get<{ m: number | null }>(
        'SELECT MAX(CAST(value AS INTEGER)) m FROM lookup_values WHERE list = ?', [list],
      );
      value = String((max?.m ?? 0) + 1);
    } else {
      value = String(body.value ?? label).trim();
      if (!value) throw new BadRequestException({ error: 'Please check the form', fields: { value: 'Required' } });
    }

    const exists = this.db.get('SELECT 1 FROM lookup_values WHERE list = ? AND value = ?', [list, value]);
    if (exists) throw new BadRequestException({ error: 'That value already exists', fields: { value: 'Already exists' } });

    const maxOrder = this.db.get<{ m: number | null }>('SELECT MAX(sort_order) m FROM lookup_values WHERE list = ?', [list]);
    this.db.run(
      'INSERT INTO lookup_values (list, value, label, locked, sort_order) VALUES (?, ?, ?, 0, ?)',
      [list, value, label, (maxOrder?.m ?? -1) + 1],
    );
    logActivity(this.db, user, 'create', 'lookups', `${list}:${value}`, `added "${label}" to ${meta.title}`);
    return this.allValues();
  }

  renameLookupValue(list: string, value: string, body: { label?: unknown }, user?: AuthUser) {
    this.ensureSeeded();
    const meta = this.requireEditableList(list);
    const row = this.db.get<{ label: string }>('SELECT label FROM lookup_values WHERE list = ? AND value = ?', [list, value]);
    if (!row) throw new NotFoundException('That value was not found');

    const label = String(body.label ?? '').trim();
    if (!label) throw new BadRequestException({ error: 'Please check the form', fields: { label: 'Required' } });

    this.db.run('UPDATE lookup_values SET label = ? WHERE list = ? AND value = ?', [label, list, value]);
    logActivity(this.db, user, 'update', 'lookups', `${list}:${value}`, `renamed "${row.label}" to "${label}" in ${meta.title}`);
    return this.allValues();
  }

  deleteLookupValue(list: string, value: string, user?: AuthUser) {
    this.ensureSeeded();
    const meta = this.requireEditableList(list);
    const row = this.db.get<{ label: string; locked: number }>(
      'SELECT label, locked FROM lookup_values WHERE list = ? AND value = ?', [list, value],
    );
    if (!row) throw new NotFoundException('That value was not found');
    if (row.locked) throw new BadRequestException({ error: 'This value is locked and cannot be removed' });
    // TODO: once products/invoices/invoice_lines etc. are populated by their own modules, also
    // refuse deletion here when `value` is still referenced by an existing record (cross-table
    // reference check skipped for now since those modules may not exist yet).

    this.db.run('DELETE FROM lookup_values WHERE list = ? AND value = ?', [list, value]);
    logActivity(this.db, user, 'delete', 'lookups', `${list}:${value}`, `removed "${row.label}" from ${meta.title}`);
    return this.allValues();
  }

  moveLookupValue(list: string, value: string, dir: 'up' | 'down', user?: AuthUser) {
    this.ensureSeeded();
    const meta = this.requireEditableList(list);
    if (dir !== 'up' && dir !== 'down') throw new BadRequestException({ error: 'dir must be "up" or "down"' });

    const rows = this.db.all<{ value: string; sort_order: number }>(
      'SELECT value, sort_order FROM lookup_values WHERE list = ? ORDER BY sort_order ASC, id ASC', [list],
    );
    const idx = rows.findIndex((r) => r.value === value);
    if (idx === -1) throw new NotFoundException('That value was not found');
    const swapIdx = dir === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= rows.length) return this.allValues(); // already at the boundary — no-op

    const a = rows[idx];
    const b = rows[swapIdx];
    this.db.transaction(() => {
      this.db.run('UPDATE lookup_values SET sort_order = ? WHERE list = ? AND value = ?', [b.sort_order, list, a.value]);
      this.db.run('UPDATE lookup_values SET sort_order = ? WHERE list = ? AND value = ?', [a.sort_order, list, b.value]);
    });
    logActivity(this.db, user, 'update', 'lookups', `${list}:${value}`, `reordered ${meta.title}`);
    return this.allValues();
  }

  private requireEditableList(list: string): LookupListMeta {
    const meta = LOOKUP_LISTS.find((l) => l.list === list);
    if (!meta) throw new NotFoundException(`Unknown list "${list}"`);
    if (!meta.editable) throw new ForbiddenException(`${meta.title} is a fixed list and cannot be changed`);
    return meta;
  }

  private allValues(): Record<string, { value: string; label: string; locked: boolean }[]> {
    const values: Record<string, { value: string; label: string; locked: boolean }[]> = {};
    for (const l of LOOKUP_LISTS) {
      const rows = this.db.all<{ value: string; label: string; locked: number }>(
        'SELECT value, label, locked FROM lookup_values WHERE list = ? ORDER BY sort_order ASC, id ASC', [l.list],
      );
      values[l.list] = rows.map((r) => ({ value: r.value, label: r.label, locked: !!r.locked }));
    }
    return values;
  }

  /** Lazily seeds `lookup_values` from calc.ts's constants (+ the additional lists) the first time any lookup endpoint is hit. Idempotent. */
  private ensureSeeded() {
    for (const l of LOOKUP_LISTS) {
      const has = this.db.get('SELECT 1 FROM lookup_values WHERE list = ? LIMIT 1', [l.list]);
      if (has) continue;
      const seeds = SEED_VALUES[l.list] || [];
      seeds.forEach((s, i) => {
        this.db.run(
          'INSERT OR IGNORE INTO lookup_values (list, value, label, locked, sort_order) VALUES (?, ?, ?, ?, ?)',
          [l.list, s.value, s.label, s.locked ? 1 : 0, i],
        );
      });
    }
  }

  // ---------- Fiscal years ----------

  getFiscalYears(): number[] {
    const rows = this.db.all<{ fy: number }>('SELECT DISTINCT fy FROM invoices');
    const years = new Set<number>(rows.map((r) => r.fy));
    years.add(currentFiscalYear());
    return Array.from(years).sort((a, b) => a - b);
  }
}
