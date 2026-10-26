import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import { DEFAULT_RULES, RawLine, WithholdingResult, computeLine, computeTotals, computeWithholding, round2 } from '../../common/calc';
import { FY_MONTHS } from '../../common/ethiopian';

interface Rules {
  vat_rate: number;
  wh_rate: number;
  wh_goods_threshold: number;
  wh_service_threshold: number;
}

interface InvoiceRow {
  id: number;
  kind: 'P' | 'S';
  invoice_no: string;
  date: string;
  fy: number;
  fy_month: number;
  party_id: number | null;
  party_name: string | null;
  party_tin: string | null;
  payment_type: string;
  vat_category: string;
  wh_receipt_type: string | null;
  wh_paid: number;
  report_status: string;
}

interface LineRow extends RawLine {
  invoice_id: number;
}

interface ComputedInvoice {
  taxable_amount: number;
  vat_amount: number;
  grand_total: number;
  wh: WithholdingResult;
  amount_due: number;
  amount_paid: number;
  balance: number;
}

const INVOICE_COLUMNS = `id, kind, invoice_no, date, fy, fy_month, party_id, party_name, party_tin,
  payment_type, vat_category, wh_receipt_type, wh_paid, report_status`;

/**
 * Dashboard summary (`/api/dashboard`). Nothing here is stored — every figure is recomputed at
 * read time from `invoices`/`invoice_lines`/`payments`/`products` via `calc.ts`, same approach as
 * the invoices module. Stock levels are recomputed with a small local helper (not imported from
 * the inventory module, per module-boundary convention).
 */
@Injectable()
export class DashboardService {
  constructor(private readonly db: DatabaseService) {}

  private getRules(): Rules {
    const row = this.db.get<Rules>(
      'SELECT vat_rate, wh_rate, wh_goods_threshold, wh_service_threshold FROM settings WHERE id = 1',
    );
    return row || DEFAULT_RULES;
  }

  private computeInvoices(rows: InvoiceRow[], rules: Rules): Map<number, ComputedInvoice> {
    const map = new Map<number, ComputedInvoice>();
    if (!rows.length) return map;
    const ids = rows.map((r) => r.id);
    const placeholders = ids.map(() => '?').join(',');
    const lineRows = this.db.all<LineRow>(`SELECT * FROM invoice_lines WHERE invoice_id IN (${placeholders})`, ids);
    const linesByInvoice: Record<number, LineRow[]> = {};
    for (const l of lineRows) (linesByInvoice[l.invoice_id] ||= []).push(l);
    const paidRows = this.db.all<{ invoice_id: number; total: number }>(
      `SELECT invoice_id, SUM(amount) as total FROM payments WHERE invoice_id IN (${placeholders}) GROUP BY invoice_id`,
      ids,
    );
    const paidByInvoice: Record<number, number> = {};
    for (const p of paidRows) paidByInvoice[p.invoice_id] = p.total;

    for (const inv of rows) {
      const computed = (linesByInvoice[inv.id] || []).map((l) => computeLine(l, rules));
      const totals = computeTotals(computed);
      const wh = computeWithholding(
        {
          taxable_amount: totals.taxable_amount,
          vat_category: inv.vat_category,
          wh_receipt_type: inv.wh_receipt_type,
          wh_paid: inv.wh_paid,
        },
        rules,
      );
      const amount_due = round2(totals.grand_total - wh.expected);
      const amount_paid = round2(paidByInvoice[inv.id] || 0);
      const balance = round2(amount_due - amount_paid);
      map.set(inv.id, { taxable_amount: totals.taxable_amount, vat_amount: totals.vat_amount, grand_total: totals.grand_total, wh, amount_due, amount_paid, balance });
    }
    return map;
  }

  /** Mirrors the inventory module's stock formula (current = opening + stock_in - stock_out); kept local on purpose. */
  private stock() {
    const products = this.db.all<any>(
      'SELECT id, code, name_en, track_stock, min_stock, opening_stock, purchase_price FROM products',
    );
    if (!products.length) return { value: 0, items: 0, low: [] as any[] };

    const stockIn = this.db.all<{ product_code: string; qty: number; cost: number }>(
      `SELECT l.product_code as product_code, SUM(l.qty) as qty, SUM(l.qty * l.unit_price) as cost
       FROM invoice_lines l JOIN invoices i ON i.id = l.invoice_id
       WHERE i.kind = 'P' AND l.product_code IS NOT NULL GROUP BY l.product_code`,
    );
    const stockOutSales = this.db.all<{ product_code: string; qty: number }>(
      `SELECT l.product_code as product_code, SUM(l.qty) as qty
       FROM invoice_lines l JOIN invoices i ON i.id = l.invoice_id
       WHERE i.kind = 'S' AND l.product_code IS NOT NULL GROUP BY l.product_code`,
    );
    const stockOutIssues = this.db.all<{ product_id: number; qty: number }>(
      'SELECT product_id, SUM(qty) as qty FROM stock_issues GROUP BY product_id',
    );

    const inByCode: Record<string, { qty: number; cost: number }> = {};
    for (const r of stockIn) inByCode[r.product_code] = { qty: r.qty || 0, cost: r.cost || 0 };
    const outByCode: Record<string, number> = {};
    for (const r of stockOutSales) outByCode[r.product_code] = (outByCode[r.product_code] || 0) + (r.qty || 0);
    const issueByProductId: Record<number, number> = {};
    for (const r of stockOutIssues) issueByProductId[r.product_id] = r.qty || 0;

    let value = 0;
    const low: any[] = [];
    for (const p of products) {
      const inRow = inByCode[p.code];
      const stock_in = inRow?.qty || 0;
      const stock_out = (outByCode[p.code] || 0) + (issueByProductId[p.id] || 0);
      const current_stock = round2((p.opening_stock || 0) + stock_in - stock_out);
      const unit_cost = stock_in > 0 ? round2(inRow!.cost / stock_in) : Number(p.purchase_price) || 0;
      const stock_value = round2(current_stock * unit_cost);
      value = round2(value + stock_value);
      if (p.track_stock && current_stock <= (p.min_stock || 0)) {
        low.push({ code: p.code, name: p.name_en, current: current_stock, min: p.min_stock });
      }
    }
    return { value, items: products.length, low };
  }

  summary(fy: number) {
    const rules = this.getRules();

    // --- fy-scoped: totals / series / unreported counts / top parties ---
    const fyInvoices = this.db.all<InvoiceRow>(`SELECT ${INVOICE_COLUMNS} FROM invoices WHERE fy = ?`, [fy]);
    const fyComputed = this.computeInvoices(fyInvoices, rules);

    let sales = 0, salesVat = 0, purchases = 0, purchaseVat = 0;
    let salesCount = 0, purchaseCount = 0;
    const seriesS = new Array(12).fill(0);
    const seriesP = new Array(12).fill(0);
    let unreportedP = 0, unreportedS = 0;
    const supplierAgg = new Map<string, { name: string; n: number; amount: number }>();
    const customerAgg = new Map<string, { name: string; n: number; amount: number }>();

    for (const inv of fyInvoices) {
      const c = fyComputed.get(inv.id)!;
      const key = inv.party_id != null ? `id:${inv.party_id}` : `name:${inv.party_name || ''}`;
      if (inv.kind === 'S') {
        sales = round2(sales + c.taxable_amount);
        salesVat = round2(salesVat + c.vat_amount);
        salesCount++;
        seriesS[inv.fy_month] = round2(seriesS[inv.fy_month] + c.taxable_amount);
        if (inv.report_status === 'Not Reported') unreportedS++;
        const agg = customerAgg.get(key) || { name: inv.party_name || 'Unknown', n: 0, amount: 0 };
        agg.n++;
        agg.amount = round2(agg.amount + c.grand_total);
        customerAgg.set(key, agg);
      } else {
        purchases = round2(purchases + c.taxable_amount);
        purchaseVat = round2(purchaseVat + c.vat_amount);
        purchaseCount++;
        seriesP[inv.fy_month] = round2(seriesP[inv.fy_month] + c.taxable_amount);
        if (inv.report_status === 'Not Reported') unreportedP++;
        const agg = supplierAgg.get(key) || { name: inv.party_name || 'Unknown', n: 0, amount: 0 };
        agg.n++;
        agg.amount = round2(agg.amount + c.grand_total);
        supplierAgg.set(key, agg);
      }
    }

    const vatPayable = round2(salesVat - purchaseVat);
    const openingCreditRow = this.db.get<{ amount: number }>(
      'SELECT amount FROM vat_adjustments WHERE fy = ? AND line_no = 195 AND fy_month = 0',
      [fy],
    );
    const creditCarried = round2(openingCreditRow?.amount || 0);

    // --- global (not fy-scoped): current open balances / withholding backlog / recent activity ---
    const creditInvoices = this.db.all<InvoiceRow>(`SELECT ${INVOICE_COLUMNS} FROM invoices WHERE payment_type = 'Credit'`);
    const creditComputed = this.computeInvoices(creditInvoices, rules);
    let payablesAmount = 0, payablesCount = 0, receivablesAmount = 0, receivablesCount = 0;
    for (const inv of creditInvoices) {
      const c = creditComputed.get(inv.id)!;
      if (c.balance > 0) {
        if (inv.kind === 'P') {
          payablesAmount = round2(payablesAmount + c.balance);
          payablesCount++;
        } else {
          receivablesAmount = round2(receivablesAmount + c.balance);
          receivablesCount++;
        }
      }
    }

    const purchaseInvoices = this.db.all<InvoiceRow>(`SELECT ${INVOICE_COLUMNS} FROM invoices WHERE kind = 'P'`);
    const purchasesComputed = this.computeInvoices(purchaseInvoices, rules);
    let whAmount = 0, whCount = 0;
    for (const inv of purchaseInvoices) {
      const c = purchasesComputed.get(inv.id)!;
      if (c.wh.applicable && c.wh.outstanding > 0) {
        whAmount = round2(whAmount + c.wh.outstanding);
        whCount++;
      }
    }

    const recentHeaders = this.db.all<{ id: number; kind: 'P' | 'S'; invoice_no: string; date: string; party_name: string | null; payment_type: string }>(
      'SELECT id, kind, invoice_no, date, party_name, payment_type FROM invoices ORDER BY created_at DESC, id DESC LIMIT 10',
    );
    const recentIds = recentHeaders.map((r) => r.id);
    let recentComputed = new Map<number, ComputedInvoice>();
    if (recentIds.length) {
      const recentInvoices = this.db.all<InvoiceRow>(
        `SELECT ${INVOICE_COLUMNS} FROM invoices WHERE id IN (${recentIds.map(() => '?').join(',')})`,
        recentIds,
      );
      recentComputed = this.computeInvoices(recentInvoices, rules);
    }
    const recent = recentHeaders.map((r) => ({
      id: r.id,
      kind: r.kind,
      invoice_no: r.invoice_no,
      date: r.date,
      party_name: r.party_name,
      payment_type: r.payment_type,
      grand_total: recentComputed.get(r.id)?.grand_total ?? 0,
    }));

    const topSuppliers = [...supplierAgg.values()].sort((a, b) => b.amount - a.amount).slice(0, 5);
    const topCustomers = [...customerAgg.values()].sort((a, b) => b.amount - a.amount).slice(0, 5);

    return {
      totals: {
        sales, salesCount, salesVat,
        purchases, purchaseCount, purchaseVat,
        vatPayable, creditCarried,
      },
      stock: this.stock(),
      payables: { amount: payablesAmount, count: payablesCount },
      receivables: { amount: receivablesAmount, count: receivablesCount },
      whPending: { amount: whAmount, count: whCount },
      months: FY_MONTHS,
      series: { S: seriesS, P: seriesP },
      unreported: { P: unreportedP, S: unreportedS },
      topSuppliers,
      topCustomers,
      recent,
    };
  }
}
