import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import { DEFAULT_RULES, RawLine, computeLine, computeTotals, computeWithholding, round2 } from '../../common/calc';

export type Kind = 'P' | 'S';

interface Rules {
  vat_rate: number;
  wh_rate: number;
  wh_goods_threshold: number;
  wh_service_threshold: number;
}

/** Aging bucket boundaries (days since invoice date), per README: 0-30, 31-60, 61-90, 90+. */
export const CREDIT_BUCKETS = ['0-30', '31-60', '61-90', '90+'];

function bucketFor(ageDays: number): string {
  if (ageDays <= 30) return '0-30';
  if (ageDays <= 60) return '31-60';
  if (ageDays <= 90) return '61-90';
  return '90+';
}

interface InvoiceRow {
  id: number;
  invoice_no: string;
  date: string;
  party_name: string | null;
  party_tin: string | null;
  vat_category: string;
  wh_receipt_type: string | null;
  wh_paid: number;
}

interface LineRow extends RawLine {
  invoice_id: number;
}

/**
 * Credit & payments aging (`/api/credit/*`). Balances are never stored — recomputed at read time
 * from `invoice_lines`/`payments` via `calc.ts`, same as the invoices module.
 */
@Injectable()
export class CreditService {
  constructor(private readonly db: DatabaseService) {}

  private getRules(): Rules {
    const row = this.db.get<Rules>(
      'SELECT vat_rate, wh_rate, wh_goods_threshold, wh_service_threshold FROM settings WHERE id = 1',
    );
    return row || DEFAULT_RULES;
  }

  buckets() {
    return CREDIT_BUCKETS.map((label) => ({ label }));
  }

  list(kind: Kind, all: boolean) {
    const rules = this.getRules();
    const invoices = this.db.all<InvoiceRow>(
      `SELECT id, invoice_no, date, party_name, party_tin, vat_category, wh_receipt_type, wh_paid
       FROM invoices WHERE kind = ? AND payment_type = 'Credit' ORDER BY date, id`,
      [kind],
    );
    if (!invoices.length) return [];

    const ids = invoices.map((i) => i.id);
    const placeholders = ids.map(() => '?').join(',');
    const lineRows = this.db.all<LineRow>(
      `SELECT * FROM invoice_lines WHERE invoice_id IN (${placeholders})`,
      ids,
    );
    const linesByInvoice: Record<number, LineRow[]> = {};
    for (const l of lineRows) (linesByInvoice[l.invoice_id] ||= []).push(l);

    const paidRows = this.db.all<{ invoice_id: number; total: number }>(
      `SELECT invoice_id, SUM(amount) as total FROM payments WHERE invoice_id IN (${placeholders}) GROUP BY invoice_id`,
      ids,
    );
    const paidByInvoice: Record<number, number> = {};
    for (const p of paidRows) paidByInvoice[p.invoice_id] = p.total;

    const today = Date.now();
    const result: any[] = [];
    for (const inv of invoices) {
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
      if (!all && !(balance > 0)) continue;

      const invDate = new Date(`${inv.date}T00:00:00Z`).getTime();
      const age_days = Number.isFinite(invDate) ? Math.max(0, Math.floor((today - invDate) / 86400000)) : 0;

      result.push({
        id: inv.id,
        invoice_no: inv.invoice_no,
        date: inv.date,
        party_name: inv.party_name,
        party_tin: inv.party_tin,
        amount_due,
        amount_paid,
        balance,
        age_days,
        age_bucket: bucketFor(age_days),
      });
    }
    return result;
  }
}
