import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import { round2 } from '../../common/calc';
import { logActivity } from '../../common/activity-log';
import type { AuthUser } from '../../common/auth.guard';

export interface ProductBody {
  code: string;
  name_en: string;
  name_am?: string | null;
  category?: string | null;
  brand?: string | null;
  model?: string | null;
  serial_no?: string | null;
  unit?: number | null;
  track_stock?: boolean | number;
  min_stock?: number;
  opening_stock?: number;
  purchase_price?: number;
  selling_price?: number;
  notes?: string | null;
}

export interface IssueBody {
  date: string;
  product_id: number;
  qty: number;
  department?: string | null;
  purpose?: string | null;
  approved_by?: string | null;
}

interface ProductRow {
  id: number;
  code: string;
  name_en: string;
  name_am: string | null;
  category: string | null;
  brand: string | null;
  model: string | null;
  serial_no: string | null;
  unit: number | null;
  track_stock: number;
  min_stock: number;
  opening_stock: number;
  purchase_price: number;
  selling_price: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

interface PurchaseAgg {
  code: string;
  qty: number | null;
  amt: number | null;
}

interface QtyAgg {
  code: string;
  qty: number | null;
}

type StockFields = {
  stock_in: number;
  stock_out: number;
  current_stock: number;
  unit_cost: number;
  stock_value: number;
  status: 'In stock' | 'Low stock' | 'Out of stock';
};

export interface StockInRow {
  purchase_code: string;
  product_code: string;
  date: string;
  grn_no: string;
  product_name: string;
  supplier_tin: string;
  supplier_name: string;
  quantity: number;
  unit_cost: number;
  total_cost: number;
  remark: string;
  invoice_id: number;
}

export interface StockOutRow {
  date: string;
  source: 'Sale' | 'Issue';
  ref_id: number;
  ref_no: string;
  product_code: string;
  product_name: string;
  issued_to: string;
  quantity: number;
  purpose: string;
  approved_by: string;
}

@Injectable()
export class InventoryService {
  constructor(private readonly db: DatabaseService) {}

  // ---- shared aggregation (computed live, never stored — see BUILDING_MODULES.md) ----

  private purchaseAggByCode(): Map<string, { qty: number; amt: number }> {
    const rows = this.db.all<PurchaseAgg>(
      `SELECT il.product_code AS code, SUM(il.qty) AS qty, SUM(il.qty * il.unit_price) AS amt
       FROM invoice_lines il JOIN invoices i ON i.id = il.invoice_id
       WHERE i.kind = 'P' AND il.product_code IS NOT NULL AND il.product_code <> ''
       GROUP BY il.product_code`,
    );
    return new Map(rows.map((r) => [r.code, { qty: r.qty || 0, amt: r.amt || 0 }]));
  }

  private salesAggByCode(): Map<string, number> {
    const rows = this.db.all<QtyAgg>(
      `SELECT il.product_code AS code, SUM(il.qty) AS qty
       FROM invoice_lines il JOIN invoices i ON i.id = il.invoice_id
       WHERE i.kind = 'S' AND il.product_code IS NOT NULL AND il.product_code <> ''
       GROUP BY il.product_code`,
    );
    return new Map(rows.map((r) => [r.code, r.qty || 0]));
  }

  private issueAggByCode(): Map<string, number> {
    const rows = this.db.all<QtyAgg>(
      `SELECT p.code AS code, SUM(si.qty) AS qty
       FROM stock_issues si JOIN products p ON p.id = si.product_id
       GROUP BY p.code`,
    );
    return new Map(rows.map((r) => [r.code, r.qty || 0]));
  }

  private statusFor(current_stock: number, min_stock: number): StockFields['status'] {
    if (current_stock <= 0) return 'Out of stock';
    if (current_stock <= min_stock) return 'Low stock';
    return 'In stock';
  }

  private computeStock(
    row: Pick<ProductRow, 'code' | 'opening_stock' | 'purchase_price' | 'min_stock'>,
    purchase: Map<string, { qty: number; amt: number }>,
    sales: Map<string, number>,
    issues: Map<string, number>,
  ): StockFields {
    const p = purchase.get(row.code) || { qty: 0, amt: 0 };
    const stock_in = p.qty;
    const stock_out = (sales.get(row.code) || 0) + (issues.get(row.code) || 0);
    const current_stock = row.opening_stock + stock_in - stock_out;
    const unit_cost = p.qty > 0 ? round2(p.amt / p.qty) : row.purchase_price;
    const stock_value = round2(current_stock * unit_cost);
    return { stock_in, stock_out, current_stock, unit_cost, stock_value, status: this.statusFor(current_stock, row.min_stock) };
  }

  /** Recomputes stock_in/out for exactly one product's code straight from the source tables — used by the
   * delete guard so a stale in-memory value can never let a product with movements be removed. */
  private computeStockForCodeExact(code: string) {
    const p = this.db.get<{ qty: number | null; amt: number | null }>(
      `SELECT SUM(il.qty) AS qty, SUM(il.qty * il.unit_price) AS amt
       FROM invoice_lines il JOIN invoices i ON i.id = il.invoice_id
       WHERE i.kind = 'P' AND il.product_code = ?`,
      [code],
    );
    const s = this.db.get<{ qty: number | null }>(
      `SELECT SUM(il.qty) AS qty FROM invoice_lines il JOIN invoices i ON i.id = il.invoice_id
       WHERE i.kind = 'S' AND il.product_code = ?`,
      [code],
    );
    const iss = this.db.get<{ qty: number | null }>(
      `SELECT SUM(si.qty) AS qty FROM stock_issues si JOIN products pr ON pr.id = si.product_id WHERE pr.code = ?`,
      [code],
    );
    const stock_in = p?.qty || 0;
    const stock_out = (s?.qty || 0) + (iss?.qty || 0);
    return { stock_in, stock_out };
  }

  private toProduct(row: ProductRow, stock: StockFields) {
    return {
      id: row.id,
      code: row.code,
      name_en: row.name_en,
      name_am: row.name_am,
      category: row.category,
      brand: row.brand,
      model: row.model,
      serial_no: row.serial_no,
      unit: row.unit,
      track_stock: !!row.track_stock,
      min_stock: row.min_stock,
      opening_stock: row.opening_stock,
      purchase_price: row.purchase_price,
      selling_price: row.selling_price,
      notes: row.notes,
      created_at: row.created_at,
      updated_at: row.updated_at,
      ...stock,
    };
  }

  // ---- products ----

  listProducts() {
    const rows = this.db.all<ProductRow>('SELECT * FROM products ORDER BY code');
    const purchase = this.purchaseAggByCode();
    const sales = this.salesAggByCode();
    const issues = this.issueAggByCode();
    return rows.map((r) => this.toProduct(r, this.computeStock(r, purchase, sales, issues)));
  }

  private getProductRow(id: number): ProductRow {
    const row = this.db.get<ProductRow>('SELECT * FROM products WHERE id = ?', [id]);
    if (!row) throw new NotFoundException('Product not found');
    return row;
  }

  getNextProductCode(): string {
    const rows = this.db.all<{ code: string }>("SELECT code FROM products WHERE code LIKE 'P-%'");
    let max = 0;
    for (const r of rows) {
      const m = /^P-(\d+)$/.exec(r.code);
      if (m) max = Math.max(max, parseInt(m[1], 10));
    }
    return `P-${String(max + 1).padStart(4, '0')}`;
  }

  private validateProductBody(body: ProductBody, selfId?: number) {
    const fields: Record<string, string> = {};
    if (!body.code || !String(body.code).trim()) fields.code = 'Required';
    if (!body.name_en || !String(body.name_en).trim()) fields.name_en = 'Required';
    if (Object.keys(fields).length) {
      throw new BadRequestException({ error: 'Please check the form', fields });
    }
    const existing = this.db.get<{ id: number }>('SELECT id FROM products WHERE code = ?', [body.code]);
    if (existing && existing.id !== selfId) {
      throw new BadRequestException({ error: 'Please check the form', fields: { code: 'Already in use' } });
    }
  }

  createProduct(body: ProductBody, user: AuthUser) {
    this.validateProductBody(body);
    this.db.run(
      `INSERT INTO products (code, name_en, name_am, category, brand, model, serial_no, unit, track_stock,
        min_stock, opening_stock, purchase_price, selling_price, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        body.code, body.name_en, body.name_am ?? null, body.category ?? null, body.brand ?? null,
        body.model ?? null, body.serial_no ?? null, body.unit ?? null, body.track_stock ? 1 : 0,
        body.min_stock ?? 0, body.opening_stock ?? 0, body.purchase_price ?? 0, body.selling_price ?? 0,
        body.notes ?? null,
      ],
    );
    const row = this.db.get<ProductRow>('SELECT * FROM products WHERE code = ?', [body.code])!;
    logActivity(this.db, user, 'create', 'products', row.id, `Created product ${row.code} — ${row.name_en}`);
    return this.toProduct(row, this.computeStock(row, new Map(), new Map(), new Map()));
  }

  updateProduct(id: number, body: ProductBody, user: AuthUser) {
    const existing = this.getProductRow(id);
    this.validateProductBody(body, id);
    this.db.run(
      `UPDATE products SET code = ?, name_en = ?, name_am = ?, category = ?, brand = ?, model = ?,
        serial_no = ?, unit = ?, track_stock = ?, min_stock = ?, opening_stock = ?, purchase_price = ?,
        selling_price = ?, notes = ?, updated_at = datetime('now') WHERE id = ?`,
      [
        body.code, body.name_en, body.name_am ?? null, body.category ?? null, body.brand ?? null,
        body.model ?? null, body.serial_no ?? null, body.unit ?? null, body.track_stock ? 1 : 0,
        body.min_stock ?? 0, body.opening_stock ?? 0, body.purchase_price ?? 0, body.selling_price ?? 0,
        body.notes ?? null, id,
      ],
    );
    const row = this.getProductRow(id);
    logActivity(this.db, user, 'update', 'products', row.id, `Updated product ${row.code} — ${row.name_en}`);
    const purchase = this.purchaseAggByCode();
    const sales = this.salesAggByCode();
    const issues = this.issueAggByCode();
    void existing;
    return this.toProduct(row, this.computeStock(row, purchase, sales, issues));
  }

  deleteProduct(id: number, user: AuthUser) {
    const row = this.getProductRow(id);
    const { stock_in, stock_out } = this.computeStockForCodeExact(row.code);
    if (stock_in > 0 || stock_out > 0) {
      throw new BadRequestException('Cannot delete a product that has recorded purchases, sales, or issues');
    }
    this.db.run('DELETE FROM products WHERE id = ?', [id]);
    logActivity(this.db, user, 'delete', 'products', id, `Deleted product ${row.code} — ${row.name_en}`);
  }

  getProductMovements(id: number) {
    const row = this.getProductRow(id);
    return {
      in: this.stockInRows(row.code),
      out: this.stockOutRows(row.code),
    };
  }

  // ---- issues ----

  listIssues() {
    return this.db.all(
      `SELECT si.id, si.issue_no, si.date, p.code, p.name_en, si.qty, si.department, si.purpose, si.approved_by
       FROM stock_issues si JOIN products p ON p.id = si.product_id
       ORDER BY si.date DESC, si.id DESC`,
    );
  }

  private nextIssueNo(): string {
    const rows = this.db.all<{ issue_no: string }>('SELECT issue_no FROM stock_issues');
    let max = 0;
    for (const r of rows) {
      const m = /^ISS(\d+)$/.exec(r.issue_no);
      if (m) max = Math.max(max, parseInt(m[1], 10));
    }
    return `ISS${String(max + 1).padStart(4, '0')}`;
  }

  createIssue(body: IssueBody, user: AuthUser) {
    const fields: Record<string, string> = {};
    if (!body.date) fields.date = 'Required';
    if (!body.product_id) fields.product_id = 'Required';
    if (!body.qty || Number(body.qty) <= 0) fields.qty = 'Must be greater than 0';
    if (Object.keys(fields).length) {
      throw new BadRequestException({ error: 'Please check the form', fields });
    }
    const product = this.db.get<{ id: number; code: string; name_en: string }>(
      'SELECT id, code, name_en FROM products WHERE id = ?', [body.product_id],
    );
    if (!product) throw new BadRequestException({ error: 'Please check the form', fields: { product_id: 'Product not found' } });

    const issue_no = this.nextIssueNo();
    this.db.run(
      `INSERT INTO stock_issues (issue_no, date, product_id, qty, department, purpose, approved_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [issue_no, body.date, body.product_id, body.qty, body.department ?? null, body.purpose ?? null, body.approved_by ?? null],
    );
    const row = this.db.get<{ id: number }>('SELECT id FROM stock_issues WHERE issue_no = ?', [issue_no])!;
    logActivity(this.db, user, 'create', 'issues', row.id, `Issued ${body.qty} of ${product.code} — ${product.name_en} (${issue_no})`);
    return {
      id: row.id,
      issue_no,
      date: body.date,
      code: product.code,
      name_en: product.name_en,
      qty: body.qty,
      department: body.department ?? null,
      purpose: body.purpose ?? null,
      approved_by: body.approved_by ?? null,
    };
  }

  deleteIssue(id: number, user: AuthUser) {
    const row = this.db.get<{ id: number; issue_no: string }>('SELECT id, issue_no FROM stock_issues WHERE id = ?', [id]);
    if (!row) throw new NotFoundException('Issue not found');
    this.db.run('DELETE FROM stock_issues WHERE id = ?', [id]);
    logActivity(this.db, user, 'delete', 'issues', id, `Deleted stock issue ${row.issue_no}`);
  }

  // ---- stock in / out ----

  stockInRows(productCode?: string): StockInRow[] {
    const sql = `
      SELECT i.invoice_no AS purchase_code, il.product_code AS product_code, i.date AS date,
             i.vat_receipt_no AS grn_no, p.name_en AS product_name, pt.tin AS supplier_tin,
             COALESCE(pt.name, i.party_name, '') AS supplier_name,
             il.qty AS quantity, il.unit_price AS unit_cost, (il.qty * il.unit_price) AS total_cost,
             '' AS remark, i.id AS invoice_id
      FROM invoice_lines il
      JOIN invoices i ON i.id = il.invoice_id
      JOIN products p ON p.code = il.product_code
      LEFT JOIN parties pt ON pt.id = i.party_id
      WHERE i.kind = 'P' AND p.track_stock = 1 ${productCode ? 'AND p.code = ?' : ''}
      ORDER BY i.date DESC, i.id DESC, il.id DESC`;
    return this.db.all<StockInRow>(sql, productCode ? [productCode] : []);
  }

  stockOutRows(productCode?: string): StockOutRow[] {
    const salesSql = `
      SELECT i.date AS date, 'Sale' AS source, i.id AS ref_id, i.invoice_no AS ref_no,
             il.product_code AS product_code, p.name_en AS product_name,
             COALESCE(pt.name, i.party_name, '') AS issued_to,
             il.qty AS quantity, '' AS purpose, '' AS approved_by
      FROM invoice_lines il
      JOIN invoices i ON i.id = il.invoice_id
      JOIN products p ON p.code = il.product_code
      LEFT JOIN parties pt ON pt.id = i.party_id
      WHERE i.kind = 'S' AND p.track_stock = 1 ${productCode ? 'AND p.code = ?' : ''}`;
    const issuesSql = `
      SELECT si.date AS date, 'Issue' AS source, si.id AS ref_id, si.issue_no AS ref_no,
             p.code AS product_code, p.name_en AS product_name, si.department AS issued_to,
             si.qty AS quantity, COALESCE(si.purpose, '') AS purpose, COALESCE(si.approved_by, '') AS approved_by
      FROM stock_issues si JOIN products p ON p.id = si.product_id
      WHERE 1 = 1 ${productCode ? 'AND p.code = ?' : ''}`;
    const sales = this.db.all<StockOutRow>(salesSql, productCode ? [productCode] : []);
    const issues = this.db.all<StockOutRow>(issuesSql, productCode ? [productCode] : []);
    return [...sales, ...issues].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  }

  getStockIn() {
    return this.stockInRows();
  }

  getStockOut() {
    return this.stockOutRows();
  }
}
