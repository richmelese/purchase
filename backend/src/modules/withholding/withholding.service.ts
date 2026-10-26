import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import { DEFAULT_RULES, RawLine, computeLine, computeTotals, computeWithholding } from '../../common/calc';
import { taxPeriod } from '../../common/ethiopian';

export type Kind = 'P' | 'S';

interface Rules {
  vat_rate: number;
  wh_rate: number;
  wh_goods_threshold: number;
  wh_service_threshold: number;
}

interface InvoiceRow {
  id: number;
  invoice_no: string;
  date: string;
  fy: number;
  fy_month: number;
  party_name: string | null;
  party_tin: string | null;
  vat_category: string;
  wh_receipt_type: string | null;
  wh_receipt_no: string | null;
  wh_receipt_date: string | null;
  wh_paid: number;
}

interface LineRow extends RawLine {
  invoice_id: number;
}

/**
 * Read-only withholding summary (`/api/withholding/*`). Invoice totals are never stored — every
 * row is recomputed at read time from `invoice_lines` via `calc.ts`, same as the invoices module.
 */
@Injectable()
export class WithholdingService {
  constructor(private readonly db: DatabaseService) {}

  private getRules(): Rules {
    const row = this.db.get<Rules>(
      'SELECT vat_rate, wh_rate, wh_goods_threshold, wh_service_threshold FROM settings WHERE id = 1',
    );
    return row || DEFAULT_RULES;
  }

  list(kind: Kind, fy?: string, month?: string) {
    const rules = this.getRules();
    const where: string[] = ['kind = ?'];
    const params: unknown[] = [kind];
    if (fy !== undefined && fy !== '') {
      where.push('fy = ?');
      params.push(Number(fy));
    }
    if (month !== undefined && month !== '') {
      where.push('fy_month = ?');
      params.push(Number(month));
    }
    const invoices = this.db.all<InvoiceRow>(
      `SELECT id, invoice_no, date, fy, fy_month, party_name, party_tin, vat_category,
              wh_receipt_type, wh_receipt_no, wh_receipt_date, wh_paid
       FROM invoices WHERE ${where.join(' AND ')} ORDER BY date, id`,
      params,
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
      if (!wh.applicable) continue;

      let wh_month: string | null = null;
      let penalty = '';
      if (inv.wh_receipt_date) {
        const period = taxPeriod(inv.wh_receipt_date);
        if (period) {
          wh_month = period.month;
          if (period.fy !== inv.fy || period.idx !== inv.fy_month) penalty = 'Penalty risk';
        }
      }

      result.push({
        id: inv.id,
        invoice_no: inv.invoice_no,
        date: inv.date,
        fy_month: inv.fy_month,
        party_name: inv.party_name,
        party_tin: inv.party_tin,
        wh: { status: wh.status, base: wh.base, expected: wh.expected, paid: wh.paid, outstanding: wh.outstanding },
        wh_receipt_type: inv.wh_receipt_type,
        wh_receipt_no: inv.wh_receipt_no,
        wh_receipt_date: inv.wh_receipt_date,
        wh_month,
        penalty,
      });
    }
    return result;
  }
}
