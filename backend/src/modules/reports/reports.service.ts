import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import { ComputedLine, DEFAULT_RULES, RawLine, WithholdingResult, computeLine, computeTotals, computeWithholding, round2 } from '../../common/calc';
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
}

interface LineRow extends RawLine {
  invoice_id: number;
  product_code: string | null;
  description: string | null;
}

interface ComputedInvoice {
  taxable_amount: number;
  vat_amount: number;
  grand_total: number;
  wh: WithholdingResult;
  amount_due: number;
  amount_paid: number;
  balance: number;
  lines: ComputedLine[];
}

/**
 * Reports (`/api/reports/*`). Nothing is stored — every figure is recomputed at read time from
 * `invoices`/`invoice_lines`/`payments`/`products` via `calc.ts`/`ethiopian.ts`.
 */
@Injectable()
export class ReportsService {
  constructor(private readonly db: DatabaseService) {}

  private getRules(): Rules {
    const row = this.db.get<Rules>(
      'SELECT vat_rate, wh_rate, wh_goods_threshold, wh_service_threshold FROM settings WHERE id = 1',
    );
    return row || DEFAULT_RULES;
  }

  private loadInvoices(where: string, params: unknown[]): InvoiceRow[] {
    return this.db.all<InvoiceRow>(
      `SELECT id, kind, invoice_no, date, fy, fy_month, party_id, party_name, party_tin, payment_type,
              vat_category, wh_receipt_type, wh_paid
       FROM invoices WHERE ${where}`,
      params,
    );
  }

  private computeMap(rows: InvoiceRow[], rules: Rules): Map<number, ComputedInvoice> {
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
      map.set(inv.id, {
        taxable_amount: totals.taxable_amount,
        vat_amount: totals.vat_amount,
        grand_total: totals.grand_total,
        wh,
        amount_due,
        amount_paid,
        balance,
        lines: computed,
      });
    }
    return map;
  }

  monthly(fy: number) {
    const rules = this.getRules();
    const invoices = this.loadInvoices('fy = ?', [fy]);
    const computed = this.computeMap(invoices, rules);

    const rows = FY_MONTHS.map((month, idx) => {
      let sales = 0, output_vat = 0, purchases = 0, input_vat = 0, wh_on_purchases = 0, wh_on_sales = 0;
      let sales_count = 0, purchase_count = 0;
      for (const inv of invoices) {
        if (inv.fy_month !== idx) continue;
        const c = computed.get(inv.id)!;
        if (inv.kind === 'S') {
          sales = round2(sales + c.taxable_amount);
          output_vat = round2(output_vat + c.vat_amount);
          sales_count++;
          if (c.wh.applicable) wh_on_sales = round2(wh_on_sales + c.wh.expected);
        } else {
          purchases = round2(purchases + c.taxable_amount);
          input_vat = round2(input_vat + c.vat_amount);
          purchase_count++;
          if (c.wh.applicable) wh_on_purchases = round2(wh_on_purchases + c.wh.expected);
        }
      }
      const net_vat = round2(output_vat - input_vat);
      return { month, sales, output_vat, purchases, input_vat, net_vat, wh_on_purchases, wh_on_sales, sales_count, purchase_count };
    });

    const total = rows.reduce(
      (acc, r) => {
        acc.sales = round2(acc.sales + r.sales);
        acc.output_vat = round2(acc.output_vat + r.output_vat);
        acc.purchases = round2(acc.purchases + r.purchases);
        acc.input_vat = round2(acc.input_vat + r.input_vat);
        acc.net_vat = round2(acc.net_vat + r.net_vat);
        acc.wh_on_purchases = round2(acc.wh_on_purchases + r.wh_on_purchases);
        acc.wh_on_sales = round2(acc.wh_on_sales + r.wh_on_sales);
        acc.sales_count += r.sales_count;
        acc.purchase_count += r.purchase_count;
        return acc;
      },
      { sales: 0, output_vat: 0, purchases: 0, input_vat: 0, net_vat: 0, wh_on_purchases: 0, wh_on_sales: 0, sales_count: 0, purchase_count: 0 },
    );

    return { rows, total };
  }

  /** Weighted-average purchase cost for a product code (fallback to purchase_price); null = no cost basis. */
  private purchaseUnitCost(code: string): number | null {
    const row = this.db.get<{ qty: number; cost: number }>(
      `SELECT SUM(l.qty) as qty, SUM(l.qty * l.unit_price) as cost
       FROM invoice_lines l JOIN invoices i ON i.id = l.invoice_id
       WHERE i.kind = 'P' AND l.product_code = ?`,
      [code],
    );
    if (row?.qty) return round2(row.cost / row.qty);
    const product = this.db.get<{ purchase_price: number }>('SELECT purchase_price FROM products WHERE code = ?', [code]);
    if (product && Number(product.purchase_price) > 0) return round2(Number(product.purchase_price));
    return null;
  }

  products(fy: number, month?: string) {
    const rules = this.getRules();
    const hasMonth = month !== undefined && month !== '';
    const where = hasMonth ? "fy = ? AND fy_month = ? AND kind = 'S'" : "fy = ? AND kind = 'S'";
    const params = hasMonth ? [fy, Number(month)] : [fy];
    const invoices = this.loadInvoices(where, params);
    const computed = this.computeMap(invoices, rules);

    const groups = new Map<string, { code: string | null; name: string; qty: number; sales: number; vat: number }>();
    for (const inv of invoices) {
      const c = computed.get(inv.id)!;
      for (const l of c.lines) {
        const code = (l as any).product_code || null;
        const key = code || `desc:${(l as any).description || ''}`;
        let g = groups.get(key);
        if (!g) {
          let name = (l as any).description || 'Unspecified';
          if (code) {
            const product = this.db.get<{ name_en: string }>('SELECT name_en FROM products WHERE code = ?', [code]);
            if (product) name = product.name_en;
          }
          g = { code, name, qty: 0, sales: 0, vat: 0 };
          groups.set(key, g);
        }
        g.qty = round2(g.qty + l.qty);
        g.sales = round2(g.sales + l.taxable_amount);
        g.vat = round2(g.vat + l.vat_amount);
      }
    }

    return [...groups.values()].map((g) => {
      const unit_cost = g.code ? this.purchaseUnitCost(g.code) : null;
      const cost = unit_cost != null ? round2(g.qty * unit_cost) : null;
      const profit = cost != null ? round2(g.sales - cost) : null;
      const margin = profit != null && g.sales ? round2((profit / g.sales) * 100) : null;
      return { code: g.code, name: g.name, qty: g.qty, sales: g.sales, vat: g.vat, unit_cost, cost, profit, margin };
    });
  }

  parties(kind: 'P' | 'S', fy: number, month?: string) {
    const rules = this.getRules();
    const hasMonth = month !== undefined && month !== '';
    const where = hasMonth ? 'fy = ? AND fy_month = ? AND kind = ?' : 'fy = ? AND kind = ?';
    const params = hasMonth ? [fy, Number(month), kind] : [fy, kind];
    const invoices = this.loadInvoices(where, params);
    const computed = this.computeMap(invoices, rules);

    const groups = new Map<string, { party_id: number | null; name: string; tin: string | null; count: number; taxable: number; vat: number; total: number; wh: number; balance: number }>();
    for (const inv of invoices) {
      const c = computed.get(inv.id)!;
      const key = inv.party_id != null ? `id:${inv.party_id}` : `name:${inv.party_name || ''}:${inv.party_tin || ''}`;
      let g = groups.get(key);
      if (!g) {
        g = { party_id: inv.party_id, name: inv.party_name || 'Unknown', tin: inv.party_tin, count: 0, taxable: 0, vat: 0, total: 0, wh: 0, balance: 0 };
        groups.set(key, g);
      }
      g.count++;
      g.taxable = round2(g.taxable + c.taxable_amount);
      g.vat = round2(g.vat + c.vat_amount);
      g.total = round2(g.total + c.grand_total);
      if (c.wh.applicable) g.wh = round2(g.wh + c.wh.expected);
      g.balance = round2(g.balance + c.balance);
    }
    return [...groups.values()];
  }
}
