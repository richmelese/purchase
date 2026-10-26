import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { DatabaseService } from '../../db/database.service';
import type { AuthUser } from '../../common/auth.guard';
import { can } from '../../common/permissions';
import {
  DEFAULT_RULES, computeLine, computeTotals, computeWithholding, round2, unitLabel,
  type RawLine, type Totals, type WithholdingResult,
} from '../../common/calc';
import { FY_MONTHS, taxPeriod, type TaxPeriod } from '../../common/ethiopian';

interface Rules { vat_rate: number; wh_rate: number; wh_goods_threshold: number; wh_service_threshold: number }

interface InvoiceRow {
  id: number; kind: 'P' | 'S'; invoice_no: string; payment_type: string; vat_category: string;
  calendar_type: string; party_tin: string | null; party_name: string | null; party_id: number | null;
  date: string; fy: number; fy_month: number; receipt_type: string; mrc_number: string | null;
  vat_receipt_no: string | null; report_status: string; notes: string | null;
  wh_receipt_type: string | null; wh_receipt_no: string | null; wh_receipt_date: string | null;
  wh_paid: number;
}

interface ProductRow {
  id: number; code: string; name_en: string; name_am: string | null; category: string | null;
  brand: string | null; model: string | null; serial_no: string | null; unit: number | null;
  track_stock: number; min_stock: number; opening_stock: number; purchase_price: number; selling_price: number;
}

/** Exports catalog entry shown by `GET /api/exports`. `resource` drives the per-user filter and is stripped before responding. */
interface CatalogEntry { id: string; label: string; desc: string; path: string; period: boolean; resource: string }

const EXPORT_CATALOG: CatalogEntry[] = [
  { id: 'credit', label: 'Credit (payables & receivables)', desc: 'Open credit purchases and sales with balances and aging', path: '/export/credit', period: false, resource: 'credit' },
  { id: 'stock', label: 'Current stock', desc: 'Current stock level, cost and value per product', path: '/export/stock', period: false, resource: 'inventory' },
  { id: 'stock-in', label: 'Stock IN register', desc: 'Purchase stock-in register (one row per tracked purchase line)', path: '/export/list/stock-in', period: false, resource: 'inventory' },
  { id: 'stock-out', label: 'Stock OUT register', desc: 'Sales and issue stock-out register', path: '/export/list/stock-out', period: false, resource: 'inventory' },
  { id: 'parties', label: 'Supplier / customer list', desc: 'Supplier Lists sheet (round-trips with import)', path: '/export/list/parties', period: false, resource: 'parties' },
  { id: 'products', label: 'Product list', desc: 'Product Lists sheet (round-trips with import)', path: '/export/list/products', period: false, resource: 'products' },
  { id: 'purchases', label: 'Purchases (P. Detail / P. Summery)', desc: 'Purchase line detail and per-invoice summary for a tax period', path: '/export/purchases', period: true, resource: 'purchases' },
  { id: 'sales', label: 'Sales (S. Detail / S. Summery)', desc: 'Sales line detail and per-invoice summary for a tax period', path: '/export/sales', period: true, resource: 'sales' },
  { id: 'withholding', label: 'Withholding register', desc: 'Withholding due, paid and outstanding for a tax period', path: '/export/withholding', period: true, resource: 'withholding' },
  { id: 'vat', label: 'VAT declaration', desc: 'VAT declaration (Summery Report lines 5-205) for a fiscal year', path: '/export/vat', period: true, resource: 'vat' },
  { id: 'report-monthly', label: 'Monthly report', desc: 'Sales vs purchases, VAT and withholding per month', path: '/export/report/monthly', period: true, resource: 'reports' },
  { id: 'report-products', label: 'Sales by product', desc: 'Quantity, sales, cost and margin per product', path: '/export/report/products', period: true, resource: 'reports' },
  { id: 'report-suppliers', label: 'Purchases by supplier', desc: 'Purchase totals per supplier', path: '/export/report/suppliers', period: true, resource: 'reports' },
  { id: 'report-customers', label: 'Sales by customer', desc: 'Sales totals per customer', path: '/export/report/customers', period: true, resource: 'reports' },
];

const ageBucket = (days: number) => (days <= 30 ? '0-30' : days <= 60 ? '31-60' : days <= 90 ? '61-90' : '90+');

@Injectable()
export class ExportService {
  constructor(private readonly db: DatabaseService) {}

  /** Entries from the static catalog the given user has the `export` right for. */
  getCatalog(user: AuthUser) {
    return EXPORT_CATALOG.filter((e) => can(user, e.resource, 'export'))
      .map(({ resource: _resource, ...rest }) => rest);
  }

  private rules(): Rules {
    const s = this.db.get<Rules>('SELECT vat_rate, wh_rate, wh_goods_threshold, wh_service_threshold FROM settings WHERE id = 1');
    return s || DEFAULT_RULES;
  }

  /** Lines + totals + withholding + balance for one invoice — mirrors the purchases/sales module's read-time computation. */
  private computeInvoice(inv: InvoiceRow, rules: Rules) {
    const rawLines = this.db.all<RawLine & { id: number; line_no: number; product_code: string | null; description: string | null; unit: number | null; tx_type: number | null }>(
      'SELECT * FROM invoice_lines WHERE invoice_id = ? ORDER BY line_no', [inv.id],
    );
    const lines = rawLines.map((l) => computeLine(l, rules));
    const totals: Totals = computeTotals(lines);
    const wh: WithholdingResult = computeWithholding(
      { taxable_amount: totals.taxable_amount, vat_category: inv.vat_category, wh_receipt_type: inv.wh_receipt_type, wh_paid: inv.wh_paid },
      rules,
    );
    const amount_due = round2(totals.grand_total - wh.expected);
    const paidRow = this.db.get<{ total: number }>('SELECT COALESCE(SUM(amount), 0) as total FROM payments WHERE invoice_id = ?', [inv.id]);
    const amount_paid = round2(paidRow?.total || 0);
    const balance = round2(amount_due - amount_paid);
    return { lines, totals, wh, amount_due, amount_paid, balance };
  }

  private productStock(p: ProductRow) {
    const purchaseAgg = this.db.get<{ qty: number; amt: number }>(
      `SELECT COALESCE(SUM(il.qty),0) as qty, COALESCE(SUM(il.qty*il.unit_price),0) as amt
       FROM invoice_lines il JOIN invoices i ON i.id = il.invoice_id
       WHERE i.kind = 'P' AND il.product_code = ?`, [p.code],
    );
    const salesQty = this.db.get<{ qty: number }>(
      `SELECT COALESCE(SUM(il.qty),0) as qty FROM invoice_lines il JOIN invoices i ON i.id = il.invoice_id
       WHERE i.kind = 'S' AND il.product_code = ?`, [p.code],
    );
    const issuedQty = this.db.get<{ qty: number }>('SELECT COALESCE(SUM(qty),0) as qty FROM stock_issues WHERE product_id = ?', [p.id]);
    const stockIn = purchaseAgg?.qty || 0;
    const stockOut = (salesQty?.qty || 0) + (issuedQty?.qty || 0);
    const current_stock = round2(p.opening_stock + stockIn - stockOut);
    const unit_cost = stockIn > 0 ? round2((purchaseAgg?.amt || 0) / stockIn) : round2(p.purchase_price);
    const stock_value = round2(current_stock * unit_cost);
    const status = current_stock <= 0 ? 'Out of stock' : current_stock <= p.min_stock ? 'Low stock' : 'In stock';
    return { current_stock, unit_cost, stock_value, status };
  }

  // ---------------------------------------------------------------------
  // Purchases / Sales (P. Detail+Summery / S. Detail+Summery)
  // ---------------------------------------------------------------------
  buildPurchasesSalesWorkbook(kind: 'P' | 'S', fy?: number, month?: number): ExcelJS.Workbook {
    const rules = this.rules();
    let sql = 'SELECT * FROM invoices WHERE kind = ?';
    const params: unknown[] = [kind];
    if (fy != null) { sql += ' AND fy = ?'; params.push(fy); }
    if (month != null) { sql += ' AND fy_month = ?'; params.push(month); }
    sql += ' ORDER BY date, id';
    const invoices = this.db.all<InvoiceRow>(sql, params);

    const wb = new ExcelJS.Workbook();
    const detail = wb.addWorksheet(kind === 'P' ? 'P. Detail' : 'S. Detail');
    detail.columns = [
      { header: 'Invoice No', key: 'invoice_no', width: 12 },
      { header: 'Date', key: 'date', width: 12 },
      { header: 'Party TIN', key: 'party_tin', width: 14 },
      { header: 'Party Name', key: 'party_name', width: 26 },
      { header: 'Product Code', key: 'product_code', width: 14 },
      { header: 'Description', key: 'description', width: 26 },
      { header: 'Unit', key: 'unit', width: 8 },
      { header: 'Type', key: 'tx_type', width: 6 },
      { header: 'Transaction Type', key: 'transaction_type', width: 14 },
      { header: 'Qty', key: 'qty', width: 10 },
      { header: 'Unit Price', key: 'unit_price', width: 12 },
      { header: 'Total', key: 'total', width: 12 },
      { header: 'Excise Rate %', key: 'excise_rate', width: 10 },
      { header: 'Excise Amount', key: 'excise_amount', width: 12 },
      { header: 'Vatable Service Fee', key: 'vatable_service_fee', width: 14 },
      { header: 'Taxable Amount', key: 'taxable_amount', width: 14 },
      { header: 'VAT Amount', key: 'vat_amount', width: 12 },
      { header: 'Non-Vatable Fee', key: 'non_vatable_fee', width: 12 },
      { header: 'Line Total', key: 'line_total', width: 12 },
    ];
    const summary = wb.addWorksheet(kind === 'P' ? 'P. Summery' : 'S. Summery');
    summary.columns = [
      { header: 'Invoice No', key: 'invoice_no', width: 12 },
      { header: 'Date', key: 'date', width: 12 },
      { header: 'Party TIN', key: 'party_tin', width: 14 },
      { header: 'Party Name', key: 'party_name', width: 26 },
      { header: 'Payment Type', key: 'payment_type', width: 10 },
      { header: 'VAT Category', key: 'vat_category', width: 8 },
      { header: 'Receipt Type', key: 'receipt_type', width: 10 },
      { header: 'VAT Receipt No', key: 'vat_receipt_no', width: 14 },
      { header: 'Report Status', key: 'report_status', width: 12 },
      { header: 'Total Amount', key: 'total_amount', width: 12 },
      { header: 'Excise Amount', key: 'excise_amount', width: 12 },
      { header: 'Vatable Service Fee', key: 'vatable_service_fee', width: 14 },
      { header: 'Taxable Amount', key: 'taxable_amount', width: 14 },
      { header: 'VAT Amount', key: 'vat_amount', width: 12 },
      { header: 'Non-Vatable Fee', key: 'non_vatable_fee', width: 12 },
      { header: 'Grand Total', key: 'grand_total', width: 12 },
      { header: 'WH Status', key: 'wh_status', width: 12 },
      { header: 'WH Base', key: 'wh_base', width: 12 },
      { header: 'WH Expected', key: 'wh_expected', width: 12 },
      { header: 'WH Paid', key: 'wh_paid', width: 12 },
      { header: 'WH Outstanding', key: 'wh_outstanding', width: 12 },
      { header: 'Amount Due', key: 'amount_due', width: 12 },
      { header: 'Amount Paid', key: 'amount_paid', width: 12 },
      { header: 'Balance', key: 'balance', width: 12 },
    ];

    for (const inv of invoices) {
      const { lines, totals, wh, amount_due, amount_paid, balance } = this.computeInvoice(inv, rules);
      for (const l of lines) {
        detail.addRow({
          invoice_no: inv.invoice_no, date: inv.date, party_tin: inv.party_tin, party_name: inv.party_name,
          product_code: l.product_code, description: l.description, unit: unitLabel(l.unit), tx_type: l.tx_type,
          transaction_type: l.transaction_type, qty: l.qty, unit_price: l.unit_price, total: l.total,
          excise_rate: l.excise_rate, excise_amount: l.excise_amount, vatable_service_fee: l.vatable_service_fee,
          taxable_amount: l.taxable_amount, vat_amount: l.vat_amount, non_vatable_fee: l.non_vatable_fee,
          line_total: l.line_total,
        });
      }
      summary.addRow({
        invoice_no: inv.invoice_no, date: inv.date, party_tin: inv.party_tin, party_name: inv.party_name,
        payment_type: inv.payment_type, vat_category: inv.vat_category, receipt_type: inv.receipt_type,
        vat_receipt_no: inv.vat_receipt_no, report_status: inv.report_status,
        total_amount: totals.total_amount, excise_amount: totals.excise_amount,
        vatable_service_fee: totals.vatable_service_fee, taxable_amount: totals.taxable_amount,
        vat_amount: totals.vat_amount, non_vatable_fee: totals.non_vatable_fee, grand_total: totals.grand_total,
        wh_status: wh.status, wh_base: wh.base, wh_expected: wh.expected, wh_paid: wh.paid,
        wh_outstanding: wh.outstanding, amount_due, amount_paid, balance,
      });
    }
    return wb;
  }

  // ---------------------------------------------------------------------
  // Credit (payables / receivables)
  // ---------------------------------------------------------------------
  buildCreditWorkbook(): ExcelJS.Workbook {
    const rules = this.rules();
    const wb = new ExcelJS.Workbook();
    const sheets: Array<['P' | 'S', string]> = [['P', 'Payable (Purchases)'], ['S', 'Receivable (Sales)']];
    for (const [kind, title] of sheets) {
      const ws = wb.addWorksheet(title);
      ws.columns = [
        { header: 'Invoice No', key: 'invoice_no', width: 12 },
        { header: 'Date', key: 'date', width: 12 },
        { header: 'Party TIN', key: 'party_tin', width: 14 },
        { header: 'Party Name', key: 'party_name', width: 26 },
        { header: 'Amount Due', key: 'amount_due', width: 12 },
        { header: 'Amount Paid', key: 'amount_paid', width: 12 },
        { header: 'Balance', key: 'balance', width: 12 },
        { header: 'Age (days)', key: 'age_days', width: 10 },
        { header: 'Age Bucket', key: 'age_bucket', width: 12 },
      ];
      const invoices = this.db.all<InvoiceRow>("SELECT * FROM invoices WHERE kind = ? AND payment_type = 'Credit'", [kind]);
      const today = Date.now();
      for (const inv of invoices) {
        const { amount_due, amount_paid, balance } = this.computeInvoice(inv, rules);
        if (balance <= 0.009) continue; // open only
        const age_days = Math.max(0, Math.floor((today - new Date(inv.date).getTime()) / 86400000));
        ws.addRow({
          invoice_no: inv.invoice_no, date: inv.date, party_tin: inv.party_tin, party_name: inv.party_name,
          amount_due, amount_paid, balance, age_days, age_bucket: ageBucket(age_days),
        });
      }
    }
    return wb;
  }

  // ---------------------------------------------------------------------
  // Current stock
  // ---------------------------------------------------------------------
  buildStockWorkbook(): ExcelJS.Workbook {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Current Stock');
    ws.columns = [
      { header: 'Code', key: 'code', width: 14 },
      { header: 'Name', key: 'name', width: 30 },
      { header: 'Current Stock', key: 'current_stock', width: 12 },
      { header: 'Min Stock', key: 'min_stock', width: 12 },
      { header: 'Unit Cost', key: 'unit_cost', width: 12 },
      { header: 'Stock Value', key: 'stock_value', width: 14 },
      { header: 'Status', key: 'status', width: 12 },
    ];
    const products = this.db.all<ProductRow>('SELECT * FROM products ORDER BY code');
    for (const p of products) {
      const s = this.productStock(p);
      ws.addRow({ code: p.code, name: p.name_en, current_stock: s.current_stock, min_stock: p.min_stock, unit_cost: s.unit_cost, stock_value: s.stock_value, status: s.status });
    }
    return wb;
  }

  // ---------------------------------------------------------------------
  // Stock IN / OUT registers
  // ---------------------------------------------------------------------
  buildStockInWorkbook(): ExcelJS.Workbook {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Stock IN');
    ws.columns = [
      { header: 'Purchase Code', key: 'purchase_code', width: 12 },
      { header: 'Product Code', key: 'product_code', width: 14 },
      { header: 'Date', key: 'date', width: 12 },
      { header: 'GRN No', key: 'grn_no', width: 14 },
      { header: 'Product Name', key: 'product_name', width: 26 },
      { header: 'Supplier TIN', key: 'supplier_tin', width: 14 },
      { header: 'Supplier Name', key: 'supplier_name', width: 26 },
      { header: 'Quantity', key: 'quantity', width: 10 },
      { header: 'Unit Cost', key: 'unit_cost', width: 12 },
      { header: 'Total Cost', key: 'total_cost', width: 12 },
      { header: 'Remark', key: 'remark', width: 24 },
      { header: 'Invoice ID', key: 'invoice_id', width: 10 },
    ];
    const rows = this.db.all<any>(
      `SELECT i.invoice_no as purchase_code, il.product_code, i.date, i.vat_receipt_no as grn_no,
              p.name_en as product_name, i.party_tin as supplier_tin, i.party_name as supplier_name,
              il.qty as quantity, il.unit_price as unit_cost, (il.qty * il.unit_price) as total_cost,
              il.description as remark, i.id as invoice_id
       FROM invoice_lines il
       JOIN invoices i ON i.id = il.invoice_id
       JOIN products p ON p.code = il.product_code AND p.track_stock = 1
       WHERE i.kind = 'P'
       ORDER BY i.date, i.id`,
    );
    for (const r of rows) ws.addRow({ ...r, total_cost: round2(r.total_cost) });
    return wb;
  }

  buildStockOutWorkbook(): ExcelJS.Workbook {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Stock OUT');
    ws.columns = [
      { header: 'Date', key: 'date', width: 12 },
      { header: 'Source', key: 'source', width: 8 },
      { header: 'Ref ID', key: 'ref_id', width: 8 },
      { header: 'Ref No', key: 'ref_no', width: 12 },
      { header: 'Product Code', key: 'product_code', width: 14 },
      { header: 'Product Name', key: 'product_name', width: 26 },
      { header: 'Issued To', key: 'issued_to', width: 22 },
      { header: 'Quantity', key: 'quantity', width: 10 },
      { header: 'Purpose', key: 'purpose', width: 20 },
      { header: 'Approved By', key: 'approved_by', width: 16 },
    ];
    const saleRows = this.db.all<any>(
      `SELECT i.date, 'Sale' as source, i.id as ref_id, i.invoice_no as ref_no, il.product_code,
              p.name_en as product_name, i.party_name as issued_to, il.qty as quantity, NULL as purpose, NULL as approved_by
       FROM invoice_lines il
       JOIN invoices i ON i.id = il.invoice_id
       JOIN products p ON p.code = il.product_code AND p.track_stock = 1
       WHERE i.kind = 'S'`,
    );
    const issueRows = this.db.all<any>(
      `SELECT si.date, 'Issue' as source, si.id as ref_id, si.issue_no as ref_no, p.code as product_code,
              p.name_en as product_name, si.department as issued_to, si.qty as quantity, si.purpose, si.approved_by
       FROM stock_issues si JOIN products p ON p.id = si.product_id`,
    );
    const all = [...saleRows, ...issueRows].sort((a, b) => String(a.date).localeCompare(String(b.date)));
    for (const r of all) ws.addRow(r);
    return wb;
  }

  // ---------------------------------------------------------------------
  // Supplier Lists / Product Lists (round-trip with /api/import/*)
  // ---------------------------------------------------------------------
  buildPartiesListWorkbook(): ExcelJS.Workbook {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Supplier Lists');
    ws.columns = [
      { header: 'No', key: 'no', width: 6 },
      { header: 'Company TIN', key: 'tin', width: 16 },
      { header: 'Company Name', key: 'name', width: 30 },
      { header: 'MRC-1', key: 'mrc1', width: 14 },
      { header: 'MRC-2', key: 'mrc2', width: 14 },
      { header: 'MRC-3', key: 'mrc3', width: 14 },
      { header: 'Phone', key: 'phone', width: 14 },
      { header: 'Email', key: 'email', width: 24 },
    ];
    const parties = this.db.all<any>('SELECT * FROM parties ORDER BY name');
    parties.forEach((p, i) => ws.addRow({ no: i + 1, tin: p.tin, name: p.name, mrc1: p.mrc1, mrc2: p.mrc2, mrc3: p.mrc3, phone: p.phone, email: p.email }));
    return wb;
  }

  buildProductsListWorkbook(): ExcelJS.Workbook {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Product Lists');
    ws.columns = [
      { header: 'No', key: 'no', width: 6 },
      { header: 'Code', key: 'code', width: 14 },
      { header: 'Name (English)', key: 'name_en', width: 26 },
      { header: 'Name (Amharic)', key: 'name_am', width: 26 },
      { header: 'Category', key: 'category', width: 16 },
      { header: 'Brand', key: 'brand', width: 14 },
      { header: 'Model', key: 'model', width: 14 },
      { header: 'Serial No', key: 'serial_no', width: 16 },
      { header: 'Unit', key: 'unit', width: 10 },
      { header: 'Min Stock', key: 'min_stock', width: 10 },
      { header: 'Opening Stock', key: 'opening_stock', width: 12 },
      { header: 'Current Stock', key: 'current_stock', width: 12 },
      { header: 'Status', key: 'status', width: 12 },
      { header: 'Purchase Price', key: 'purchase_price', width: 12 },
      { header: 'Selling Price', key: 'selling_price', width: 12 },
    ];
    const products = this.db.all<ProductRow>('SELECT * FROM products ORDER BY code');
    products.forEach((p, i) => {
      const s = this.productStock(p);
      ws.addRow({
        no: i + 1, code: p.code, name_en: p.name_en, name_am: p.name_am, category: p.category, brand: p.brand,
        model: p.model, serial_no: p.serial_no, unit: p.unit, min_stock: p.min_stock, opening_stock: p.opening_stock,
        current_stock: s.current_stock, status: s.status, purchase_price: p.purchase_price, selling_price: p.selling_price,
      });
    });
    return wb;
  }

  // ---------------------------------------------------------------------
  // Withholding register
  // ---------------------------------------------------------------------
  buildWithholdingWorkbook(fy?: number, month?: number): ExcelJS.Workbook {
    const rules = this.rules();
    const wb = new ExcelJS.Workbook();
    const sheets: Array<['P' | 'S', string]> = [['P', 'Purchases WH'], ['S', 'Sales WH']];
    for (const [kind, title] of sheets) {
      const ws = wb.addWorksheet(title);
      ws.columns = [
        { header: 'Invoice No', key: 'invoice_no', width: 12 },
        { header: 'Date', key: 'date', width: 12 },
        { header: 'FY Month', key: 'fy_month', width: 10 },
        { header: 'Party Name', key: 'party_name', width: 26 },
        { header: 'Party TIN', key: 'party_tin', width: 14 },
        { header: 'WH Status', key: 'wh_status', width: 12 },
        { header: 'Base', key: 'base', width: 12 },
        { header: 'Expected', key: 'expected', width: 12 },
        { header: 'Paid', key: 'paid', width: 12 },
        { header: 'Outstanding', key: 'outstanding', width: 12 },
        { header: 'WH Receipt Type', key: 'wh_receipt_type', width: 14 },
        { header: 'WH Receipt No', key: 'wh_receipt_no', width: 14 },
        { header: 'WH Receipt Date', key: 'wh_receipt_date', width: 14 },
        { header: 'WH Month', key: 'wh_month', width: 10 },
        { header: 'Penalty', key: 'penalty', width: 14 },
      ];
      let sql = 'SELECT * FROM invoices WHERE kind = ?';
      const params: unknown[] = [kind];
      if (fy != null) { sql += ' AND fy = ?'; params.push(fy); }
      if (month != null) { sql += ' AND fy_month = ?'; params.push(month); }
      const invoices = this.db.all<InvoiceRow>(sql, params);
      for (const inv of invoices) {
        const { wh } = this.computeInvoice(inv, rules);
        if (!wh.applicable) continue;
        const whPeriod: TaxPeriod | null = inv.wh_receipt_date ? taxPeriod(inv.wh_receipt_date) : null;
        const sameMonth = !!whPeriod && whPeriod.fy === inv.fy && whPeriod.idx === inv.fy_month;
        const penalty = inv.wh_receipt_date && !sameMonth ? 'Penalty risk' : '';
        ws.addRow({
          invoice_no: inv.invoice_no, date: inv.date, fy_month: FY_MONTHS[inv.fy_month], party_name: inv.party_name,
          party_tin: inv.party_tin, wh_status: wh.status, base: wh.base, expected: wh.expected, paid: wh.paid,
          outstanding: wh.outstanding, wh_receipt_type: inv.wh_receipt_type, wh_receipt_no: inv.wh_receipt_no,
          wh_receipt_date: inv.wh_receipt_date, wh_month: whPeriod?.month || '', penalty,
        });
      }
    }
    return wb;
  }

  // ---------------------------------------------------------------------
  // VAT declaration (lines 5-205) — direct mapping-table lines only; see report note.
  // ---------------------------------------------------------------------
  buildVatWorkbook(fy: number): ExcelJS.Workbook {
    const rules = this.rules();
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('VAT Declaration');
    ws.columns = [
      { header: 'No', key: 'no', width: 6 },
      { header: 'Label', key: 'label', width: 36 },
      ...FY_MONTHS.map((m) => ({ header: m, key: m, width: 12 })),
      { header: 'Total', key: 'total', width: 14 },
    ];

    type VatLineDef = { no: number; label: string; kind: 'P' | 'S'; tx_type: number; field: 'taxable_amount' | 'vat_amount' };
    const lineDefsUnsorted: VatLineDef[] = [
      { no: 5, label: 'Taxable sale', kind: 'S', tx_type: 1, field: 'taxable_amount' },
      { no: 10, label: 'VAT on taxable sale', kind: 'S', tx_type: 1, field: 'vat_amount' },
      { no: 15, label: 'Zero-rated sale', kind: 'S', tx_type: 2, field: 'taxable_amount' },
      { no: 20, label: 'Tax-exempt sale', kind: 'S', tx_type: 3, field: 'taxable_amount' },
      { no: 65, label: 'Local purchase capital asset', kind: 'P', tx_type: 1, field: 'taxable_amount' },
      { no: 70, label: 'VAT on local purchase capital asset', kind: 'P', tx_type: 1, field: 'vat_amount' },
      { no: 75, label: 'Imported capital asset', kind: 'P', tx_type: 2, field: 'taxable_amount' },
      { no: 80, label: 'VAT on imported capital asset', kind: 'P', tx_type: 2, field: 'vat_amount' },
      { no: 85, label: 'Purchase no VAT / unclaimed input (capital)', kind: 'P', tx_type: 7, field: 'taxable_amount' },
      { no: 100, label: 'Local purchase input', kind: 'P', tx_type: 3, field: 'taxable_amount' },
      { no: 105, label: 'VAT on local purchase input', kind: 'P', tx_type: 3, field: 'vat_amount' },
      { no: 110, label: 'Imported input', kind: 'P', tx_type: 4, field: 'taxable_amount' },
      { no: 115, label: 'VAT on imported input', kind: 'P', tx_type: 4, field: 'vat_amount' },
      { no: 120, label: 'General expense input purchase', kind: 'P', tx_type: 5, field: 'taxable_amount' },
      { no: 125, label: 'VAT on general expense input purchase', kind: 'P', tx_type: 5, field: 'vat_amount' },
      { no: 130, label: 'Purchase no VAT / unclaimed input', kind: 'P', tx_type: 6, field: 'taxable_amount' },
    ];
    const lineDefs = [...lineDefsUnsorted].sort((a, b) => a.no - b.no);

    for (const def of lineDefs) {
      const values = new Array(12).fill(0);
      const rows = this.db.all<any>(
        `SELECT il.*, i.fy_month FROM invoice_lines il JOIN invoices i ON i.id = il.invoice_id
         WHERE i.kind = ? AND i.fy = ? AND il.tx_type = ?`,
        [def.kind, fy, def.tx_type],
      );
      for (const r of rows) {
        const computed = computeLine(r, rules);
        values[r.fy_month] = round2(values[r.fy_month] + (computed as any)[def.field]);
      }
      const total = round2(values.reduce((a, b) => a + b, 0));
      const rowObj: Record<string, unknown> = { no: def.no, label: def.label, total };
      FY_MONTHS.forEach((m, i) => { rowObj[m] = values[i]; });
      ws.addRow(rowObj);
    }
    return wb;
  }

  // ---------------------------------------------------------------------
  // Reports
  // ---------------------------------------------------------------------
  buildReportWorkbook(type: string, fy: number, month?: number): ExcelJS.Workbook {
    if (type === 'products') return this.buildProductsReportWorkbook(fy, month);
    if (type === 'suppliers') return this.buildPartyReportWorkbook('P', fy, month);
    if (type === 'customers') return this.buildPartyReportWorkbook('S', fy, month);
    return this.buildMonthlyReportWorkbook(fy);
  }

  private buildMonthlyReportWorkbook(fy: number): ExcelJS.Workbook {
    const rules = this.rules();
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Monthly Report');
    ws.columns = [
      { header: 'Month', key: 'month', width: 12 },
      { header: 'Sales', key: 'sales', width: 14 },
      { header: 'Output VAT', key: 'output_vat', width: 14 },
      { header: 'Purchases', key: 'purchases', width: 14 },
      { header: 'Input VAT', key: 'input_vat', width: 14 },
      { header: 'Net VAT', key: 'net_vat', width: 14 },
      { header: 'WH on Purchases', key: 'wh_on_purchases', width: 16 },
      { header: 'WH on Sales', key: 'wh_on_sales', width: 14 },
      { header: 'Sales Count', key: 'sales_count', width: 12 },
      { header: 'Purchase Count', key: 'purchase_count', width: 14 },
    ];
    const totals = { sales: 0, output_vat: 0, purchases: 0, input_vat: 0, net_vat: 0, wh_on_purchases: 0, wh_on_sales: 0, sales_count: 0, purchase_count: 0 };
    for (let idx = 0; idx < 12; idx++) {
      const pInvoices = this.db.all<InvoiceRow>('SELECT * FROM invoices WHERE kind = ? AND fy = ? AND fy_month = ?', ['P', fy, idx]);
      const sInvoices = this.db.all<InvoiceRow>('SELECT * FROM invoices WHERE kind = ? AND fy = ? AND fy_month = ?', ['S', fy, idx]);
      let purchases = 0, input_vat = 0, wh_on_purchases = 0;
      for (const inv of pInvoices) { const { totals: t, wh } = this.computeInvoice(inv, rules); purchases += t.grand_total; input_vat += t.vat_amount; wh_on_purchases += wh.expected; }
      let sales = 0, output_vat = 0, wh_on_sales = 0;
      for (const inv of sInvoices) { const { totals: t, wh } = this.computeInvoice(inv, rules); sales += t.grand_total; output_vat += t.vat_amount; wh_on_sales += wh.expected; }
      const row = {
        month: FY_MONTHS[idx], sales: round2(sales), output_vat: round2(output_vat), purchases: round2(purchases),
        input_vat: round2(input_vat), net_vat: round2(output_vat - input_vat), wh_on_purchases: round2(wh_on_purchases),
        wh_on_sales: round2(wh_on_sales), sales_count: sInvoices.length, purchase_count: pInvoices.length,
      };
      ws.addRow(row);
      (Object.keys(totals) as (keyof typeof totals)[]).forEach((k) => { totals[k] += (row as any)[k]; });
    }
    ws.addRow({
      month: 'Total', sales: round2(totals.sales), output_vat: round2(totals.output_vat), purchases: round2(totals.purchases),
      input_vat: round2(totals.input_vat), net_vat: round2(totals.net_vat), wh_on_purchases: round2(totals.wh_on_purchases),
      wh_on_sales: round2(totals.wh_on_sales), sales_count: totals.sales_count, purchase_count: totals.purchase_count,
    });
    return wb;
  }

  private productUnitCost(p: ProductRow): number {
    const agg = this.db.get<{ qty: number; amt: number }>(
      `SELECT COALESCE(SUM(il.qty),0) as qty, COALESCE(SUM(il.qty*il.unit_price),0) as amt
       FROM invoice_lines il JOIN invoices i ON i.id = il.invoice_id WHERE i.kind = 'P' AND il.product_code = ?`,
      [p.code],
    );
    return agg && agg.qty > 0 ? round2(agg.amt / agg.qty) : round2(p.purchase_price);
  }

  private buildProductsReportWorkbook(fy: number, month?: number): ExcelJS.Workbook {
    const rules = this.rules();
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Sales by Product');
    ws.columns = [
      { header: 'Code', key: 'code', width: 14 },
      { header: 'Name', key: 'name', width: 28 },
      { header: 'Qty', key: 'qty', width: 10 },
      { header: 'Sales', key: 'sales', width: 14 },
      { header: 'VAT', key: 'vat', width: 12 },
      { header: 'Unit Cost', key: 'unit_cost', width: 12 },
      { header: 'Cost', key: 'cost', width: 12 },
      { header: 'Profit', key: 'profit', width: 12 },
      { header: 'Margin %', key: 'margin', width: 10 },
    ];
    let sql = "SELECT il.*, i.fy_month FROM invoice_lines il JOIN invoices i ON i.id = il.invoice_id WHERE i.kind = 'S' AND i.fy = ?";
    const params: unknown[] = [fy];
    if (month != null) { sql += ' AND i.fy_month = ?'; params.push(month); }
    const rows = this.db.all<any>(sql, params);
    const byProduct = new Map<string, { qty: number; sales: number; vat: number; name: string }>();
    for (const r of rows) {
      if (!r.product_code) continue;
      const c = computeLine(r, rules);
      const agg = byProduct.get(r.product_code) || { qty: 0, sales: 0, vat: 0, name: r.description || '' };
      agg.qty += c.qty; agg.sales += c.line_total; agg.vat += c.vat_amount;
      byProduct.set(r.product_code, agg);
    }
    for (const [code, agg] of byProduct) {
      const product = this.db.get<ProductRow>('SELECT * FROM products WHERE code = ?', [code]);
      const unit_cost = product ? this.productUnitCost(product) : null;
      const cost = unit_cost != null ? round2(agg.qty * unit_cost) : null;
      const profit = cost != null ? round2(agg.sales - cost) : null;
      const margin = profit != null && agg.sales ? round2((profit / agg.sales) * 100) : null;
      ws.addRow({ code, name: product?.name_en || agg.name, qty: round2(agg.qty), sales: round2(agg.sales), vat: round2(agg.vat), unit_cost, cost, profit, margin });
    }
    return wb;
  }

  private buildPartyReportWorkbook(kind: 'P' | 'S', fy: number, month?: number): ExcelJS.Workbook {
    const rules = this.rules();
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(kind === 'P' ? 'Purchases by Supplier' : 'Sales by Customer');
    ws.columns = [
      { header: 'Party', key: 'name', width: 26 },
      { header: 'TIN', key: 'tin', width: 16 },
      { header: 'Count', key: 'count', width: 8 },
      { header: 'Taxable', key: 'taxable', width: 14 },
      { header: 'VAT', key: 'vat', width: 12 },
      { header: 'Total', key: 'total', width: 14 },
      { header: 'WH', key: 'wh', width: 12 },
      { header: 'Balance', key: 'balance', width: 12 },
    ];
    let sql = 'SELECT * FROM invoices WHERE kind = ? AND fy = ?';
    const params: unknown[] = [kind, fy];
    if (month != null) { sql += ' AND fy_month = ?'; params.push(month); }
    const invoices = this.db.all<InvoiceRow>(sql, params);
    const byParty = new Map<string, { name: string | null; tin: string | null; count: number; taxable: number; vat: number; total: number; wh: number; balance: number }>();
    for (const inv of invoices) {
      const key = inv.party_tin || inv.party_name || `#${inv.party_id ?? 'unknown'}`;
      const { totals, wh, balance } = this.computeInvoice(inv, rules);
      const agg = byParty.get(key) || { name: inv.party_name, tin: inv.party_tin, count: 0, taxable: 0, vat: 0, total: 0, wh: 0, balance: 0 };
      agg.count++; agg.taxable += totals.taxable_amount; agg.vat += totals.vat_amount; agg.total += totals.grand_total;
      agg.wh += wh.expected; agg.balance += balance;
      byParty.set(key, agg);
    }
    for (const agg of byParty.values()) {
      ws.addRow({ name: agg.name, tin: agg.tin, count: agg.count, taxable: round2(agg.taxable), vat: round2(agg.vat), total: round2(agg.total), wh: round2(agg.wh), balance: round2(agg.balance) });
    }
    return wb;
  }
}
