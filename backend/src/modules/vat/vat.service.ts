import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import { DEFAULT_RULES, PURCHASE_TYPES, RawLine, SALES_TYPES, computeLine, round2 } from '../../common/calc';
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
  fy: number;
  fy_month: number;
}

interface LineRow extends RawLine {
  invoice_id: number;
  tx_type: number | null;
}

/**
 * Declaration-line labels. `no` matches the mapping table in docs/API_CONTRACT.md plus the
 * computed summary lines and the 4 free-entry manual lines this module defines (see service
 * comment below for why 140/145/175/180 were picked).
 */
const LABELS: Record<number, string> = {
  5: 'Taxable sale', 10: 'VAT on taxable sale', 15: 'Zero-rated sale', 20: 'Tax-exempt sale',
  55: 'Total sales', 60: 'Total output VAT',
  65: 'Local purchase – capital asset', 70: 'VAT on local capital asset',
  75: 'Imported capital asset', 80: 'VAT on imported capital asset',
  85: 'Purchase no VAT / unclaimed input (capital)',
  90: 'Total capital asset purchases', 95: 'Total VAT on capital assets',
  100: 'Local purchase – input', 105: 'VAT on local input',
  110: 'Imported input', 115: 'VAT on imported input',
  120: 'General expense input', 125: 'VAT on general expense input',
  130: 'Purchase no VAT / unclaimed input',
  140: 'Reverse taxation (VAT self-assessed on imported services)',
  145: 'Debit / credit notes (purchase adjustments)',
  165: 'Total purchases', 170: 'Total input VAT',
  175: 'Government voucher VAT credit',
  180: 'Other VAT credits / refunds',
  185: 'VAT due this period', 190: 'VAT credit this period',
  195: 'Opening credit brought forward', 200: 'Net VAT payable', 205: 'Closing credit carried forward',
};

/** Rendered bold on the UI ("VAT_TOTAL" rows) — cosmetic only, per docs/API_CONTRACT.md line ~517. */
const BOLD_TOTALS = new Set([55, 60, 90, 95, 165, 170, 185, 190, 200, 205]);

const emptyMonths = () => new Array(12).fill(0);

/**
 * VAT declaration (`/api/vat`, `/api/vat/adjustments`). Nothing is stored except the handful of
 * free-entry "manual" lines (`vat_adjustments`) — every `calc` line is derived at read time from
 * `invoice_lines.tx_type` via the PURCHASE_TYPES/SALES_TYPES → line mapping in `calc.ts`.
 *
 * Manual-line numbering decision (none of 5/10/15/20/65/70/75/80/85/100/105/110/115/120/125/130
 * are reused, per the contract):
 *   140 Reverse taxation        — added into line 60 (total output VAT), since self-assessed
 *                                  reverse-charge VAT is itself an output-tax item.
 *   145 Debit/credit notes      — added into line 170 (total input VAT), since credit notes from
 *                                  suppliers reduce (and debit notes increase) the input VAT credit.
 *   175 Government vouchers     — subtracted directly in the 185/190 formula, exactly as given by
 *                                  the contract text ("line 60 − (95 + 170 + 175 + 180)").
 *   180 Other credits/refunds   — same: subtracted directly in the 185/190 formula.
 * This keeps 175/180 literally matching the contract's own formula, while giving 140/145 a real
 * (documented) effect on the totals they most naturally belong to.
 */
@Injectable()
export class VatService {
  constructor(private readonly db: DatabaseService) {}

  private getRules(): Rules {
    const row = this.db.get<Rules>(
      'SELECT vat_rate, wh_rate, wh_goods_threshold, wh_service_threshold FROM settings WHERE id = 1',
    );
    return row || DEFAULT_RULES;
  }

  private manualValues(fy: number, lineNo: number): number[] {
    const values = emptyMonths();
    const rows = this.db.all<{ fy_month: number; amount: number }>(
      'SELECT fy_month, amount FROM vat_adjustments WHERE fy = ? AND line_no = ?',
      [fy, lineNo],
    );
    for (const r of rows) if (r.fy_month >= 0 && r.fy_month < 12) values[r.fy_month] = Number(r.amount) || 0;
    return values;
  }

  get(fy: number) {
    const rules = this.getRules();
    const invoices = this.db.all<InvoiceRow>('SELECT id, kind, fy, fy_month FROM invoices WHERE fy = ?', [fy]);

    const valueLines: Record<number, number[]> = {};
    const ensure = (no: number) => (valueLines[no] ||= emptyMonths());
    for (const no of [5, 10, 15, 20, 65, 70, 75, 80, 85, 100, 105, 110, 115, 120, 125, 130]) ensure(no);

    if (invoices.length) {
      const ids = invoices.map((i) => i.id);
      const placeholders = ids.map(() => '?').join(',');
      const lineRows = this.db.all<LineRow>(`SELECT * FROM invoice_lines WHERE invoice_id IN (${placeholders})`, ids);
      const linesByInvoice: Record<number, LineRow[]> = {};
      for (const l of lineRows) (linesByInvoice[l.invoice_id] ||= []).push(l);

      for (const inv of invoices) {
        const idx = inv.fy_month;
        const types = inv.kind === 'S' ? SALES_TYPES : PURCHASE_TYPES;
        for (const raw of linesByInvoice[inv.id] || []) {
          const typeDef = types.find((t) => t.value === raw.tx_type);
          if (!typeDef) continue;
          const computed = computeLine(raw, rules);
          const arr = ensure(typeDef.line);
          arr[idx] = round2(arr[idx] + computed.taxable_amount);
          if (typeDef.tt === 'Vatable') {
            const vatArr = ensure(typeDef.line + 5);
            vatArr[idx] = round2(vatArr[idx] + computed.vat_amount);
          }
        }
      }
    }

    const reverseTax = this.manualValues(fy, 140);
    const debitCredit = this.manualValues(fy, 145);
    const govVoucher = this.manualValues(fy, 175);
    const otherCredits = this.manualValues(fy, 180);
    const openingManual = this.manualValues(fy, 195); // only fy_month 0 is meaningful

    const line55 = emptyMonths();
    const line60 = emptyMonths();
    const line90 = emptyMonths();
    const line95 = emptyMonths();
    const line165 = emptyMonths();
    const line170 = emptyMonths();
    const line185 = emptyMonths();
    const line190 = emptyMonths();
    const line195 = emptyMonths();
    const line200 = emptyMonths();
    const line205 = emptyMonths();

    for (let idx = 0; idx < 12; idx++) {
      line55[idx] = round2((valueLines[5][idx] || 0) + (valueLines[15][idx] || 0) + (valueLines[20][idx] || 0));
      line60[idx] = round2((valueLines[10][idx] || 0) + reverseTax[idx]);
      line90[idx] = round2((valueLines[65][idx] || 0) + (valueLines[75][idx] || 0) + (valueLines[85][idx] || 0));
      line95[idx] = round2((valueLines[70][idx] || 0) + (valueLines[80][idx] || 0));
      line165[idx] = round2(
        (valueLines[100][idx] || 0) + (valueLines[110][idx] || 0) + (valueLines[120][idx] || 0) + (valueLines[130][idx] || 0),
      );
      line170[idx] = round2((valueLines[105][idx] || 0) + (valueLines[115][idx] || 0) + (valueLines[125][idx] || 0) + debitCredit[idx]);

      // Contract formula (verbatim): line 185/190 = line60 − (95 + 170 + 175 + 180).
      const grossNet = round2(line60[idx] - (line95[idx] + line170[idx] + govVoucher[idx] + otherCredits[idx]));
      line185[idx] = grossNet > 0 ? grossNet : 0;
      line190[idx] = grossNet < 0 ? round2(-grossNet) : 0;

      // Opening credit: manual entry for Hamle (idx 0), else carried from previous month's closing (205).
      line195[idx] = idx === 0 ? round2(openingManual[0] || 0) : line205[idx - 1];

      const combined = round2(line185[idx] - line190[idx] - line195[idx]);
      line200[idx] = combined > 0 ? combined : 0; // net VAT payable after applying opening credit
      line205[idx] = combined < 0 ? round2(-combined) : 0; // closing credit carried to next month
    }

    const makeLine = (no: number, kind: 'calc' | 'manual', values: number[]) => ({
      no,
      label: LABELS[no],
      kind,
      values: values.map((v) => round2(v)),
      total: round2(values.reduce((s, v) => s + v, 0)),
      ...(BOLD_TOTALS.has(no) ? { highlight: true } : {}),
    });

    const lines = [
      makeLine(5, 'calc', valueLines[5]),
      makeLine(10, 'calc', valueLines[10]),
      makeLine(15, 'calc', valueLines[15]),
      makeLine(20, 'calc', valueLines[20]),
      makeLine(55, 'calc', line55),
      makeLine(60, 'calc', line60),
      makeLine(65, 'calc', valueLines[65]),
      makeLine(70, 'calc', valueLines[70]),
      makeLine(75, 'calc', valueLines[75]),
      makeLine(80, 'calc', valueLines[80]),
      makeLine(85, 'calc', valueLines[85]),
      makeLine(90, 'calc', line90),
      makeLine(95, 'calc', line95),
      makeLine(100, 'calc', valueLines[100]),
      makeLine(105, 'calc', valueLines[105]),
      makeLine(110, 'calc', valueLines[110]),
      makeLine(115, 'calc', valueLines[115]),
      makeLine(120, 'calc', valueLines[120]),
      makeLine(125, 'calc', valueLines[125]),
      makeLine(130, 'calc', valueLines[130]),
      makeLine(140, 'manual', reverseTax),
      makeLine(145, 'manual', debitCredit),
      makeLine(165, 'calc', line165),
      makeLine(170, 'calc', line170),
      makeLine(175, 'manual', govVoucher),
      makeLine(180, 'manual', otherCredits),
      makeLine(185, 'calc', line185),
      makeLine(190, 'calc', line190),
      makeLine(195, 'manual', line195),
      makeLine(200, 'calc', line200),
      makeLine(205, 'calc', line205),
    ];

    return { months: FY_MONTHS, lines, openingCredit: line195[0] };
  }

  updateAdjustments(fy: number, items: { line_no: number; fy_month: number; amount: number }[]) {
    this.db.transaction(() => {
      for (const item of items) {
        const lineNo = Number(item.line_no);
        const fyMonth = Number(item.fy_month);
        const amount = Number(item.amount) || 0;
        this.db.run(
          `INSERT INTO vat_adjustments (fy, line_no, fy_month, amount) VALUES (?, ?, ?, ?)
           ON CONFLICT(fy, line_no, fy_month) DO UPDATE SET amount = excluded.amount`,
          [fy, lineNo, fyMonth, amount],
        );
      }
    });
    return this.get(fy);
  }
}
