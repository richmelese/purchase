import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { DatabaseService } from '../../db/database.service';
import { computeLine, computeTotals, computeWithholding, round2, DEFAULT_RULES, type RawLine } from '../../common/calc';
import { logActivity } from '../../common/activity-log';
import type { AuthUser } from '../../common/auth.guard';

type Kind = 'P' | 'S';

interface InvoiceRow {
  id: number;
  kind: Kind;
  invoice_no: string;
  date: string;
  party_name: string | null;
  party_tin: string | null;
  vat_receipt_no: string | null;
  vat_category: string;
  wh_receipt_type: string | null;
  wh_paid: number;
}

interface BankTxRow {
  id: number;
  bank_account_id: number;
  row_no: number | null;
  bank_code: string | null;
  value_date: string | null;
  purchase_code_1: string | null;
  purchase_code_2: string | null;
  debit: number;
  purchase_remark: string | null;
  sales_code_1: string | null;
  sales_code_2: string | null;
  credit: number;
  sales_remark: string | null;
}

interface BankAccountRow {
  id: number;
  account_no: number;
  bank_name: string | null;
  account_name: string | null;
  account_number: string | null;
  currency: string;
  opening_balance: number;
  notes: string | null;
}

export interface ReconRow {
  id: number;
  no: number;
  invoice_no: string;
  bank_codes: string[];
  date: string;
  party_name: string | null;
  party_tin: string | null;
  receipt_no: string | null;
  total_before_vat: number;
  vat_amount: number;
  grand_total: number;
  withholding: number;
  expected_payment: number;
  amount_in_bank: number;
  difference: number;
  status: 'Reconciled' | 'Partial' | 'Unreconciled' | 'Overpaid' | 'Overcollected';
}

const SHEET_HEADER = [
  'Row No', 'Bank Code', 'Value Date', 'Purchase Code 1', 'Purchase Code 2', 'Debit', 'Purchase Remark',
  'Sales Code 1', 'Sales Code 2', 'Credit', 'Sales Remark',
];

@Injectable()
export class ReconciliationService {
  constructor(private readonly db: DatabaseService) {}

  // ---------- shared helpers ----------

  private getRules() {
    const s = this.db.get<any>('SELECT vat_rate, wh_rate, wh_goods_threshold, wh_service_threshold FROM settings WHERE id = 1');
    return {
      vat_rate: s?.vat_rate ?? DEFAULT_RULES.vat_rate,
      wh_rate: s?.wh_rate ?? DEFAULT_RULES.wh_rate,
      wh_goods_threshold: s?.wh_goods_threshold ?? DEFAULT_RULES.wh_goods_threshold,
      wh_service_threshold: s?.wh_service_threshold ?? DEFAULT_RULES.wh_service_threshold,
    };
  }

  /** total_before_vat / vat_amount / grand_total / withholding for one invoice, computed from its lines. */
  private invoiceAmounts(invoice: InvoiceRow, rules: ReturnType<ReconciliationService['getRules']>) {
    const lines = this.db.all<RawLine>('SELECT * FROM invoice_lines WHERE invoice_id = ?', [invoice.id]);
    const computed = lines.map((l) => computeLine(l, rules));
    const totals = computeTotals(computed);
    const wh = computeWithholding(
      { taxable_amount: totals.taxable_amount, vat_category: invoice.vat_category, wh_receipt_type: invoice.wh_receipt_type, wh_paid: invoice.wh_paid },
      rules,
    );
    return { total_before_vat: totals.taxable_amount, vat_amount: totals.vat_amount, grand_total: totals.grand_total, withholding: wh.expected };
  }

  /** What should actually move through the bank for this invoice. Purchases: grand_total - withholding
   *  (the withheld portion never reaches the supplier). Sales: grand_total + withholding, per contract. */
  private expectedPayment(kind: Kind, grand_total: number, withholding: number): number {
    return kind === 'P' ? round2(grand_total - withholding) : round2(grand_total + withholding);
  }

  private findInvoice(kind: Kind, invoiceNo: string | null | undefined): InvoiceRow | undefined {
    if (!invoiceNo) return undefined;
    return this.db.get<InvoiceRow>('SELECT * FROM invoices WHERE kind = ? AND invoice_no = ?', [kind, invoiceNo]);
  }

  /** Per-invoice reconciliation rows (all invoices of `kind`, unfiltered) — shared by the list and summary routes. */
  private reconRows(kind: Kind, rules: ReturnType<ReconciliationService['getRules']>): ReconRow[] {
    const invoices = this.db.all<InvoiceRow>('SELECT * FROM invoices WHERE kind = ? ORDER BY date, id', [kind]);
    const txs = this.db.all<BankTxRow>(
      'SELECT bank_code, purchase_code_1, purchase_code_2, debit, sales_code_1, sales_code_2, credit FROM bank_transactions',
    );
    const matchMap = new Map<string, { amount: number; codes: string[] }>();
    for (const t of txs) {
      const codes = kind === 'P' ? [t.purchase_code_1, t.purchase_code_2] : [t.sales_code_1, t.sales_code_2];
      const amount = kind === 'P' ? Number(t.debit) || 0 : Number(t.credit) || 0;
      for (const code of codes) {
        if (!code) continue;
        const entry = matchMap.get(code) || { amount: 0, codes: [] };
        entry.amount += amount;
        if (t.bank_code) entry.codes.push(t.bank_code);
        matchMap.set(code, entry);
      }
    }
    return invoices.map((inv, idx) => {
      const amounts = this.invoiceAmounts(inv, rules);
      const expected_payment = this.expectedPayment(kind, amounts.grand_total, amounts.withholding);
      const match = matchMap.get(inv.invoice_no);
      const amount_in_bank = round2(match?.amount || 0);
      const difference = round2(amount_in_bank - expected_payment);
      let status: ReconRow['status'];
      if (amount_in_bank === 0) status = 'Unreconciled';
      else if (Math.abs(difference) < 0.01) status = 'Reconciled';
      else if (amount_in_bank > expected_payment) status = kind === 'P' ? 'Overpaid' : 'Overcollected';
      else status = 'Partial';
      return {
        id: inv.id,
        no: idx + 1,
        invoice_no: inv.invoice_no,
        bank_codes: match ? [...new Set(match.codes)] : [],
        date: inv.date,
        party_name: inv.party_name,
        party_tin: inv.party_tin,
        receipt_no: inv.vat_receipt_no,
        total_before_vat: amounts.total_before_vat,
        vat_amount: amounts.vat_amount,
        grand_total: amounts.grand_total,
        withholding: amounts.withholding,
        expected_payment,
        amount_in_bank,
        difference,
        status,
      };
    });
  }

  private listRecon(kind: Kind, status: string, search: string): ReconRow[] {
    const rules = this.getRules();
    let rows = this.reconRows(kind, rules);
    const statusNorm = (status || 'all').toLowerCase();
    if (statusNorm && statusNorm !== 'all') {
      rows = rows.filter((r) => r.status.toLowerCase() === statusNorm);
    }
    if (search) {
      const q = search.toLowerCase();
      rows = rows.filter((r) =>
        [r.invoice_no, r.party_name, r.party_tin].some((v) => v && String(v).toLowerCase().includes(q)),
      );
    }
    return rows.map((r, idx) => ({ ...r, no: idx + 1 }));
  }

  getPurchases(status: string, search: string) {
    return this.listRecon('P', status, search);
  }

  getSales(status: string, search: string) {
    return this.listRecon('S', status, search);
  }

  // ---------- summary ----------

  getSummary() {
    const rules = this.getRules();
    const purchaseRows = this.reconRows('P', rules);
    const salesRows = this.reconRows('S', rules);
    const bankTotals = this.db.get<{ td: number; tc: number }>(
      'SELECT COALESCE(SUM(debit),0) AS td, COALESCE(SUM(credit),0) AS tc FROM bank_transactions',
    );
    const accounts = this.db.all<{ opening_balance: number; td: number; tc: number }>(
      `SELECT opening_balance,
              (SELECT COALESCE(SUM(debit),0) FROM bank_transactions WHERE bank_account_id = bank_accounts.id) AS td,
              (SELECT COALESCE(SUM(credit),0) FROM bank_transactions WHERE bank_account_id = bank_accounts.id) AS tc
       FROM bank_accounts`,
    );
    const total_balance = round2(accounts.reduce((s, a) => s + a.opening_balance + a.tc - a.td, 0));

    const expected_purchases = round2(purchaseRows.reduce((s, r) => s + r.expected_payment, 0));
    const expected_sales = round2(salesRows.reduce((s, r) => s + r.expected_payment, 0));
    const reconciledP = purchaseRows.filter((r) => r.status === 'Reconciled').length;
    const reconciledS = salesRows.filter((r) => r.status === 'Reconciled').length;
    const total_bank_debit = round2(bankTotals?.td || 0);
    const total_bank_credit = round2(bankTotals?.tc || 0);

    return {
      total_balance,
      debit: {
        total_bank_debit,
        expected_purchases,
        variance: round2(total_bank_debit - expected_purchases),
        reconciliation_rate: purchaseRows.length ? round2((reconciledP / purchaseRows.length) * 100) : 0,
        reconciled_count: reconciledP,
        purchases_count: purchaseRows.length,
      },
      credit: {
        total_bank_credit,
        expected_sales,
        variance: round2(total_bank_credit - expected_sales),
        reconciliation_rate: salesRows.length ? round2((reconciledS / salesRows.length) * 100) : 0,
        reconciled_count: reconciledS,
        sales_count: salesRows.length,
      },
    };
  }

  // ---------- bank accounts ----------

  getBanks() {
    const rows = this.db.all<BankAccountRow>('SELECT * FROM bank_accounts ORDER BY account_no');
    return rows.map((r) => this.hydrateBank(r));
  }

  private hydrateBank(r: BankAccountRow) {
    const agg = this.db.get<{ td: number; tc: number; cnt: number }>(
      'SELECT COALESCE(SUM(debit),0) AS td, COALESCE(SUM(credit),0) AS tc, COUNT(*) AS cnt FROM bank_transactions WHERE bank_account_id = ?',
      [r.id],
    );
    const total_debit = round2(agg?.td || 0);
    const total_credit = round2(agg?.tc || 0);
    return {
      id: r.id,
      account_no: r.account_no,
      bank_name: r.bank_name,
      account_name: r.account_name,
      account_number: r.account_number,
      currency: r.currency,
      opening_balance: r.opening_balance,
      total_debit,
      total_credit,
      current_balance: round2(r.opening_balance + total_credit - total_debit),
      tx_count: agg?.cnt || 0,
      notes: r.notes,
    };
  }

  private validateBankBody(body: any) {
    const fields: Record<string, string> = {};
    const accountNo = Number(body?.account_no);
    if (!Number.isInteger(accountNo) || accountNo < 1 || accountNo > 10) {
      fields.account_no = 'Must be a tab number between 1 and 10';
    }
    if (Object.keys(fields).length) throw new BadRequestException({ error: 'Please check the form', fields });
    return accountNo;
  }

  createBank(user: AuthUser | undefined, body: any) {
    const accountNo = this.validateBankBody(body);
    const dupe = this.db.get('SELECT id FROM bank_accounts WHERE account_no = ?', [accountNo]);
    if (dupe) throw new BadRequestException({ error: 'Please check the form', fields: { account_no: 'Already in use' } });
    const result = this.db.run(
      'INSERT INTO bank_accounts (account_no, bank_name, account_name, account_number, currency, opening_balance, notes) VALUES (?,?,?,?,?,?,?)',
      [accountNo, body.bank_name || null, body.account_name || null, body.account_number || null, body.currency || 'ETB', Number(body.opening_balance) || 0, body.notes || null],
    );
    const id = Number(result.lastInsertRowid);
    logActivity(this.db, user, 'create', 'reconciliation', id, `created bank account #${accountNo} (${body.bank_name || ''})`);
    return this.hydrateBank(this.db.get<BankAccountRow>('SELECT * FROM bank_accounts WHERE id = ?', [id])!);
  }

  updateBank(user: AuthUser | undefined, id: number, body: any) {
    const existing = this.db.get<BankAccountRow>('SELECT * FROM bank_accounts WHERE id = ?', [id]);
    if (!existing) throw new NotFoundException('Bank account not found');
    const accountNo = this.validateBankBody(body);
    const dupe = this.db.get('SELECT id FROM bank_accounts WHERE account_no = ? AND id != ?', [accountNo, id]);
    if (dupe) throw new BadRequestException({ error: 'Please check the form', fields: { account_no: 'Already in use' } });
    this.db.run(
      'UPDATE bank_accounts SET account_no = ?, bank_name = ?, account_name = ?, account_number = ?, currency = ?, opening_balance = ?, notes = ? WHERE id = ?',
      [accountNo, body.bank_name || null, body.account_name || null, body.account_number || null, body.currency || 'ETB', Number(body.opening_balance) || 0, body.notes || null, id],
    );
    logActivity(this.db, user, 'update', 'reconciliation', id, `updated bank account #${accountNo} (${body.bank_name || ''})`);
    return this.hydrateBank(this.db.get<BankAccountRow>('SELECT * FROM bank_accounts WHERE id = ?', [id])!);
  }

  // ---------- transactions ----------

  private hydrateTransaction(r: BankTxRow, rules: ReturnType<ReconciliationService['getRules']>) {
    const pInv = this.findInvoice('P', r.purchase_code_1) || this.findInvoice('P', r.purchase_code_2);
    const sInv = this.findInvoice('S', r.sales_code_1) || this.findInvoice('S', r.sales_code_2);
    let purchase_expected = 0;
    if (pInv) {
      const a = this.invoiceAmounts(pInv, rules);
      purchase_expected = this.expectedPayment('P', a.grand_total, a.withholding);
    }
    let sales_expected = 0;
    if (sInv) {
      const a = this.invoiceAmounts(sInv, rules);
      sales_expected = this.expectedPayment('S', a.grand_total, a.withholding);
    }
    return {
      id: r.id,
      bank_account_id: r.bank_account_id,
      row_no: r.row_no,
      bank_code: r.bank_code,
      value_date: r.value_date,
      purchase_code_1: r.purchase_code_1,
      purchase_code_2: r.purchase_code_2,
      debit: r.debit,
      purchase_expected,
      purchase_difference: round2((r.debit || 0) - purchase_expected),
      purchase_remark: r.purchase_remark,
      sales_code_1: r.sales_code_1,
      sales_code_2: r.sales_code_2,
      credit: r.credit,
      sales_expected,
      sales_difference: round2((r.credit || 0) - sales_expected),
      sales_remark: r.sales_remark,
    };
  }

  getTransactions(bankAccountId: number | undefined, search: string) {
    const rules = this.getRules();
    let rows: BankTxRow[];
    if (bankAccountId) {
      rows = this.db.all<BankTxRow>('SELECT * FROM bank_transactions WHERE bank_account_id = ? ORDER BY row_no, id', [bankAccountId]);
    } else {
      rows = this.db.all<BankTxRow>('SELECT * FROM bank_transactions ORDER BY bank_account_id, row_no, id');
    }
    if (search) {
      const q = search.toLowerCase();
      rows = rows.filter((r) =>
        [r.bank_code, r.value_date, r.purchase_code_1, r.purchase_code_2, r.purchase_remark, r.sales_code_1, r.sales_code_2, r.sales_remark].some(
          (v) => v && String(v).toLowerCase().includes(q),
        ),
      );
    }
    return rows.map((r) => this.hydrateTransaction(r, rules));
  }

  private nextBankCode(bankAccountId: number): string {
    const account = this.db.get<BankAccountRow>('SELECT * FROM bank_accounts WHERE id = ?', [bankAccountId]);
    const cnt = this.db.get<{ c: number }>('SELECT COUNT(*) AS c FROM bank_transactions WHERE bank_account_id = ?', [bankAccountId]);
    const seq = (cnt?.c || 0) + 1;
    return `BT-${account?.account_no ?? bankAccountId}-${String(seq).padStart(3, '0')}`;
  }

  createTransaction(user: AuthUser | undefined, body: any) {
    const bankAccountId = Number(body.bank_account_id);
    const account = this.db.get<BankAccountRow>('SELECT * FROM bank_accounts WHERE id = ?', [bankAccountId]);
    if (!account) throw new BadRequestException({ error: 'Please check the form', fields: { bank_account_id: 'Select a bank account' } });
    const bankCode = body.bank_code || this.nextBankCode(bankAccountId);
    const result = this.db.run(
      `INSERT INTO bank_transactions
        (bank_account_id, row_no, bank_code, value_date, purchase_code_1, purchase_code_2, debit, purchase_remark, sales_code_1, sales_code_2, credit, sales_remark)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        bankAccountId, body.row_no ?? null, bankCode, body.value_date || null,
        body.purchase_code_1 || null, body.purchase_code_2 || null, Number(body.debit) || 0, body.purchase_remark || null,
        body.sales_code_1 || null, body.sales_code_2 || null, Number(body.credit) || 0, body.sales_remark || null,
      ],
    );
    const id = Number(result.lastInsertRowid);
    logActivity(this.db, user, 'create', 'reconciliation', id, `added bank transaction ${bankCode}`);
    return this.hydrateTransaction(this.db.get<BankTxRow>('SELECT * FROM bank_transactions WHERE id = ?', [id])!, this.getRules());
  }

  updateTransaction(user: AuthUser | undefined, id: number, body: any) {
    const existing = this.db.get<BankTxRow>('SELECT * FROM bank_transactions WHERE id = ?', [id]);
    if (!existing) throw new NotFoundException('Bank transaction not found');
    const bankAccountId = body.bank_account_id != null ? Number(body.bank_account_id) : existing.bank_account_id;
    const bankCode = body.bank_code || existing.bank_code || this.nextBankCode(bankAccountId);
    this.db.run(
      `UPDATE bank_transactions SET
        bank_account_id = ?, row_no = ?, bank_code = ?, value_date = ?,
        purchase_code_1 = ?, purchase_code_2 = ?, debit = ?, purchase_remark = ?,
        sales_code_1 = ?, sales_code_2 = ?, credit = ?, sales_remark = ?
       WHERE id = ?`,
      [
        bankAccountId, body.row_no ?? existing.row_no, bankCode, body.value_date ?? existing.value_date,
        body.purchase_code_1 ?? existing.purchase_code_1, body.purchase_code_2 ?? existing.purchase_code_2,
        body.debit != null ? Number(body.debit) || 0 : existing.debit, body.purchase_remark ?? existing.purchase_remark,
        body.sales_code_1 ?? existing.sales_code_1, body.sales_code_2 ?? existing.sales_code_2,
        body.credit != null ? Number(body.credit) || 0 : existing.credit, body.sales_remark ?? existing.sales_remark,
        id,
      ],
    );
    logActivity(this.db, user, 'update', 'reconciliation', id, `updated bank transaction ${bankCode}`);
    return this.hydrateTransaction(this.db.get<BankTxRow>('SELECT * FROM bank_transactions WHERE id = ?', [id])!, this.getRules());
  }

  deleteTransaction(user: AuthUser | undefined, id: number) {
    const existing = this.db.get<BankTxRow>('SELECT * FROM bank_transactions WHERE id = ?', [id]);
    if (!existing) throw new NotFoundException('Bank transaction not found');
    this.db.run('DELETE FROM bank_transactions WHERE id = ?', [id]);
    logActivity(this.db, user, 'delete', 'reconciliation', id, `deleted bank transaction ${existing.bank_code || id}`);
  }

  // ---------- auto-match ----------

  autoMatch(user: AuthUser | undefined) {
    const rules = this.getRules();
    const purchaseRows = this.reconRows('P', rules).filter((r) => r.status === 'Unreconciled');
    const salesRows = this.reconRows('S', rules).filter((r) => r.status === 'Unreconciled');
    const usedP = new Set<string>();
    const usedS = new Set<string>();
    let matched_purchases = 0;
    let matched_sales = 0;

    this.db.transaction(() => {
      const txs = this.db.all<BankTxRow>('SELECT * FROM bank_transactions');
      for (const t of txs) {
        if (!t.purchase_code_1 && !t.purchase_code_2 && Number(t.debit) > 0) {
          const m = purchaseRows.find((r) => !usedP.has(r.invoice_no) && Math.abs(r.expected_payment - Number(t.debit)) < 0.01);
          if (m) {
            this.db.run('UPDATE bank_transactions SET purchase_code_1 = ? WHERE id = ?', [m.invoice_no, t.id]);
            usedP.add(m.invoice_no);
            matched_purchases++;
          }
        }
        if (!t.sales_code_1 && !t.sales_code_2 && Number(t.credit) > 0) {
          const m = salesRows.find((r) => !usedS.has(r.invoice_no) && Math.abs(r.expected_payment - Number(t.credit)) < 0.01);
          if (m) {
            this.db.run('UPDATE bank_transactions SET sales_code_1 = ? WHERE id = ?', [m.invoice_no, t.id]);
            usedS.add(m.invoice_no);
            matched_sales++;
          }
        }
      }
    });

    const total_matched = matched_purchases + matched_sales;
    logActivity(this.db, user, 'other', 'reconciliation', null, `auto-match linked ${total_matched} transaction(s) (${matched_purchases} purchase, ${matched_sales} sales)`);
    return { total_matched, matched_purchases, matched_sales };
  }

  // ---------- import / export ----------

  async exportXlsx(): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    for (let n = 1; n <= 10; n++) {
      const sheet = wb.addWorksheet(`Bank ${String(n).padStart(2, '0')}`);
      sheet.addRow(SHEET_HEADER);
      const account = this.db.get<BankAccountRow>('SELECT id FROM bank_accounts WHERE account_no = ?', [n]);
      if (account) {
        const txs = this.db.all<BankTxRow>('SELECT * FROM bank_transactions WHERE bank_account_id = ? ORDER BY row_no, id', [account.id]);
        for (const t of txs) {
          sheet.addRow([
            t.row_no, t.bank_code, t.value_date, t.purchase_code_1, t.purchase_code_2, t.debit, t.purchase_remark,
            t.sales_code_1, t.sales_code_2, t.credit, t.sales_remark,
          ]);
        }
      }
    }
    const buffer = await wb.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }

  async importXlsx(user: AuthUser | undefined, buffer: Buffer): Promise<{ total_imported: number }> {
    if (!buffer || !buffer.length) throw new BadRequestException({ error: 'No file received' });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as any);
    let total_imported = 0;

    this.db.transaction(() => {
      for (let n = 1; n <= 10; n++) {
        const sheetName = `Bank ${String(n).padStart(2, '0')}`;
        const sheet = wb.getWorksheet(sheetName);
        if (!sheet) continue;
        const account = this.db.get<BankAccountRow>('SELECT id FROM bank_accounts WHERE account_no = ?', [n]);
        if (!account) continue;

        const existing = this.db.get<{ c: number }>('SELECT COUNT(*) AS c FROM bank_transactions WHERE bank_account_id = ?', [account.id]);
        let seq = existing?.c || 0;

        sheet.eachRow((row, rowNumber) => {
          if (rowNumber === 1) return; // header
          const v = row.values as any[]; // 1-indexed
          const row_no = v[1] != null && v[1] !== '' ? Number(v[1]) : null;
          let bank_code = v[2] != null ? String(v[2]).trim() : '';
          const value_date = v[3] != null && v[3] !== '' ? String(v[3]) : null;
          const purchase_code_1 = v[4] != null && v[4] !== '' ? String(v[4]) : null;
          const purchase_code_2 = v[5] != null && v[5] !== '' ? String(v[5]) : null;
          const debit = Number(v[6]) || 0;
          const purchase_remark = v[7] != null && v[7] !== '' ? String(v[7]) : null;
          const sales_code_1 = v[8] != null && v[8] !== '' ? String(v[8]) : null;
          const sales_code_2 = v[9] != null && v[9] !== '' ? String(v[9]) : null;
          const credit = Number(v[10]) || 0;
          const sales_remark = v[11] != null && v[11] !== '' ? String(v[11]) : null;

          const isBlank = !bank_code && !value_date && !purchase_code_1 && !purchase_code_2 && !debit &&
            !sales_code_1 && !sales_code_2 && !credit && !purchase_remark && !sales_remark;
          if (isBlank) return;

          if (!bank_code) {
            seq++;
            bank_code = `BT-${n}-${String(seq).padStart(3, '0')}`;
          }

          this.db.run(
            `INSERT INTO bank_transactions
              (bank_account_id, row_no, bank_code, value_date, purchase_code_1, purchase_code_2, debit, purchase_remark, sales_code_1, sales_code_2, credit, sales_remark)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
            [account.id, row_no, bank_code, value_date, purchase_code_1, purchase_code_2, debit, purchase_remark, sales_code_1, sales_code_2, credit, sales_remark],
          );
          total_imported++;
        });
      }
    });

    logActivity(this.db, user, 'create', 'reconciliation', null, `imported ${total_imported} bank transaction row(s)`);
    return { total_imported };
  }
}
