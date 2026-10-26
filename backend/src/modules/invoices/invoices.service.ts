import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import {
  DEFAULT_RULES, RawLine, computeLine, computeTotals, computeWithholding, receiptNumberError, round2,
} from '../../common/calc';
import { taxPeriod } from '../../common/ethiopian';
import { can, canCompany } from '../../common/permissions';
import { logActivity } from '../../common/activity-log';
import type { AuthUser } from '../../common/auth.guard';

export type Kind = 'P' | 'S';

interface Rules {
  vat_rate: number;
  wh_rate: number;
  wh_goods_threshold: number;
  wh_service_threshold: number;
}

interface InvoiceRowRaw {
  id: number;
  kind: Kind;
  invoice_no: string;
  payment_type: string;
  vat_category: string;
  calendar_type: string;
  party_tin: string | null;
  party_name: string | null;
  party_id: number | null;
  date: string;
  fy: number;
  fy_month: number;
  receipt_type: string;
  mrc_number: string | null;
  vat_receipt_no: string | null;
  report_status: string;
  notes: string | null;
  wh_receipt_type: string | null;
  wh_receipt_no: string | null;
  wh_receipt_date: string | null;
  wh_paid: number;
  created_by: number | null;
  updated_by: number | null;
  created_at: string;
  updated_at: string;
}

interface LineRowRaw extends RawLine {
  id: number;
  invoice_id: number;
  line_no: number;
  product_code: string | null;
  description: string | null;
  unit: number | null;
  tx_type: number | null;
  transaction_type: string;
  qty: number;
  unit_price: number;
  excise_rate: number;
  vatable_service_fee: number;
  non_vatable_fee: number;
}

interface PaymentRowRaw {
  id: number;
  invoice_id: number;
  date: string;
  amount: number;
  method: string | null;
  reference: string | null;
}

export interface ListQuery {
  fy?: string;
  month?: string;
  q?: string;
  status?: string;
  payment?: string;
}

const resourceFor = (kind: Kind) => (kind === 'P' ? 'purchases' : 'sales');
const nounFor = (kind: Kind) => (kind === 'P' ? 'purchase' : 'sale');

@Injectable()
export class InvoicesService {
  constructor(private readonly db: DatabaseService) {}

  private getRules(): Rules {
    const row = this.db.get<Rules>(
      'SELECT vat_rate, wh_rate, wh_goods_threshold, wh_service_threshold FROM settings WHERE id = 1',
    );
    return row || DEFAULT_RULES;
  }

  private fetchLinesByInvoiceIds(ids: number[]): Record<number, LineRowRaw[]> {
    const map: Record<number, LineRowRaw[]> = {};
    if (!ids.length) return map;
    const placeholders = ids.map(() => '?').join(',');
    const rows = this.db.all<LineRowRaw>(
      `SELECT * FROM invoice_lines WHERE invoice_id IN (${placeholders}) ORDER BY invoice_id, line_no`,
      ids,
    );
    for (const r of rows) (map[r.invoice_id] ||= []).push(r);
    return map;
  }

  private fetchPaidByInvoiceIds(ids: number[]): Record<number, number> {
    const map: Record<number, number> = {};
    if (!ids.length) return map;
    const placeholders = ids.map(() => '?').join(',');
    const rows = this.db.all<{ invoice_id: number; total: number }>(
      `SELECT invoice_id, SUM(amount) as total FROM payments WHERE invoice_id IN (${placeholders}) GROUP BY invoice_id`,
      ids,
    );
    for (const r of rows) map[r.invoice_id] = r.total;
    return map;
  }

  private toListRow(inv: InvoiceRowRaw, rawLines: LineRowRaw[], paid: number, rules: Rules) {
    const computedLines = rawLines.map((l) => computeLine(l, rules));
    const totals = computeTotals(computedLines);
    const wh = computeWithholding(
      { taxable_amount: totals.taxable_amount, vat_category: inv.vat_category, wh_receipt_type: inv.wh_receipt_type, wh_paid: inv.wh_paid },
      rules,
    );
    const amount_due = round2(totals.grand_total - wh.expected);
    const amount_paid = round2(paid || 0);
    const balance = round2(amount_due - amount_paid);
    return {
      id: inv.id,
      invoice_no: inv.invoice_no,
      date: inv.date,
      fy: inv.fy,
      fy_month: inv.fy_month,
      party_name: inv.party_name,
      party_tin: inv.party_tin,
      party_id: inv.party_id,
      receipt_type: inv.receipt_type,
      vat_receipt_no: inv.vat_receipt_no,
      payment_type: inv.payment_type,
      report_status: inv.report_status,
      taxable_amount: totals.taxable_amount,
      vat_amount: totals.vat_amount,
      grand_total: totals.grand_total,
      balance,
      wh,
      _totals: totals,
      _amount_due: amount_due,
      _amount_paid: amount_paid,
    };
  }

  list(kind: Kind, query: ListQuery) {
    const rules = this.getRules();
    const where: string[] = ['kind = ?'];
    const params: unknown[] = [kind];
    if (query.fy) {
      where.push('fy = ?');
      params.push(Number(query.fy));
    }
    if (query.month !== undefined && query.month !== '') {
      where.push('fy_month = ?');
      params.push(Number(query.month));
    }
    if (query.status) {
      where.push('report_status = ?');
      params.push(query.status);
    }
    if (query.payment) {
      where.push('payment_type = ?');
      params.push(query.payment);
    }
    if (query.q) {
      const like = `%${query.q}%`;
      where.push(
        '(invoice_no LIKE ? OR party_name LIKE ? OR party_tin LIKE ? OR id IN (SELECT invoice_id FROM invoice_lines WHERE description LIKE ?))',
      );
      params.push(like, like, like, like);
    }
    const invoices = this.db.all<InvoiceRowRaw>(
      `SELECT * FROM invoices WHERE ${where.join(' AND ')} ORDER BY date DESC, id DESC`,
      params,
    );
    if (!invoices.length) return [];
    const ids = invoices.map((i) => i.id);
    const linesByInvoice = this.fetchLinesByInvoiceIds(ids);
    const paidByInvoice = this.fetchPaidByInvoiceIds(ids);
    return invoices.map((inv) => {
      const row = this.toListRow(inv, linesByInvoice[inv.id] || [], paidByInvoice[inv.id] || 0, rules);
      const { _totals, _amount_due, _amount_paid, ...rest } = row;
      return rest;
    });
  }

  nextNumber(kind: Kind): string {
    const rows = this.db.all<{ invoice_no: string }>('SELECT invoice_no FROM invoices WHERE kind = ?', [kind]);
    let max = 0;
    for (const r of rows) {
      const m = /^[A-Za-z](\d+)$/.exec(r.invoice_no || '');
      if (m) max = Math.max(max, parseInt(m[1], 10));
    }
    return `${kind}${String(max + 1).padStart(4, '0')}`;
  }

  private getInvoiceOrThrow(kind: Kind, id: number): InvoiceRowRaw {
    const inv = this.db.get<InvoiceRowRaw>('SELECT * FROM invoices WHERE id = ?', [id]);
    if (!inv || inv.kind !== kind) throw new NotFoundException('Invoice not found');
    return inv;
  }

  getDetail(kind: Kind, id: number) {
    const inv = this.getInvoiceOrThrow(kind, id);
    const rules = this.getRules();
    const lines = this.db.all<LineRowRaw>('SELECT * FROM invoice_lines WHERE invoice_id = ? ORDER BY line_no', [id]);
    const payments = this.db.all<PaymentRowRaw>('SELECT * FROM payments WHERE invoice_id = ? ORDER BY date, id', [id]);
    return this.toDetail(inv, lines, payments, rules);
  }

  private toDetail(inv: InvoiceRowRaw, rawLines: LineRowRaw[], payments: PaymentRowRaw[], rules: Rules) {
    const listRow = this.toListRow(inv, rawLines, payments.reduce((s, p) => s + (Number(p.amount) || 0), 0), rules);
    const { _totals, _amount_due, _amount_paid, ...rest } = listRow;
    const computedLines = rawLines.map((l) => computeLine(l, rules));
    return {
      ...rest,
      kind: inv.kind,
      vat_category: inv.vat_category,
      calendar_type: inv.calendar_type,
      mrc_number: inv.mrc_number,
      total_amount: _totals.total_amount,
      excise_amount: _totals.excise_amount,
      vatable_service_fee: _totals.vatable_service_fee,
      non_vatable_fee: _totals.non_vatable_fee,
      amount_due: _amount_due,
      amount_paid: _amount_paid,
      wh_receipt_type: inv.wh_receipt_type,
      wh_receipt_no: inv.wh_receipt_no,
      wh_receipt_date: inv.wh_receipt_date,
      wh_paid: inv.wh_paid,
      notes: inv.notes,
      created_by: inv.created_by,
      updated_by: inv.updated_by,
      created_at: inv.created_at,
      updated_at: inv.updated_at,
      lines: rawLines.map((raw, idx) => ({
        id: raw.id,
        line_no: raw.line_no,
        product_code: raw.product_code,
        description: raw.description,
        unit: raw.unit,
        tx_type: raw.tx_type,
        transaction_type: raw.transaction_type,
        qty: computedLines[idx].qty,
        unit_price: computedLines[idx].unit_price,
        excise_rate: computedLines[idx].excise_rate,
        vatable_service_fee: computedLines[idx].vatable_service_fee,
        non_vatable_fee: computedLines[idx].non_vatable_fee,
        total: computedLines[idx].total,
        excise_amount: computedLines[idx].excise_amount,
        taxable_amount: computedLines[idx].taxable_amount,
        vat_amount: computedLines[idx].vat_amount,
        line_total: computedLines[idx].line_total,
      })),
      payments: payments.map((p) => ({ id: p.id, date: p.date, method: p.method, reference: p.reference, amount: p.amount })),
    };
  }

  private validate(body: any) {
    const fields: Record<string, any> = {};
    if (!body.invoice_no) fields.invoice_no = 'Required';
    if (!body.payment_type) fields.payment_type = 'Required';
    if (!body.vat_category) fields.vat_category = 'Required';
    if (!body.date) fields.date = 'Required';
    if (!body.receipt_type) fields.receipt_type = 'Required';
    if (body.receipt_type === 'MRC' && !body.mrc_number) fields.mrc_number = 'Required for MRC receipts';
    if (!body.vat_receipt_no) {
      fields.vat_receipt_no = 'Required';
    } else if (body.receipt_type === 'MRC' || body.receipt_type === 'Manual') {
      const err = receiptNumberError(body.receipt_type, body.vat_receipt_no);
      if (err) fields.vat_receipt_no = err;
    }

    const lines = Array.isArray(body.lines) ? body.lines : [];
    if (!lines.length) fields.lines = 'Add at least one line';

    let hasLineErrors = false;
    const lineErrors = lines.map((line: any) => {
      const errs: Record<string, string> = {};
      if (line.unit === undefined || line.unit === null || line.unit === '') errs.unit = 'Required';
      if (!line.description) errs.description = 'Required';
      if (line.qty === undefined || line.qty === null || line.qty === '' || !(Number(line.qty) > 0)) errs.qty = 'Required';
      if (line.unit_price === undefined || line.unit_price === null || line.unit_price === '' || !(Number(line.unit_price) >= 0)) {
        errs.unit_price = 'Required';
      }
      if (Object.keys(errs).length) hasLineErrors = true;
      return errs;
    });
    if (hasLineErrors) fields.line_items = lineErrors;

    if (Object.keys(fields).length) {
      throw new BadRequestException({ error: 'Please check the form', fields });
    }
  }

  /** Resolves party_id by TIN, auto-registering / upgrading the party as described in the module spec. */
  private resolvePartyId(kind: Kind, tin: unknown, name: unknown): number | null {
    const tinStr = tin == null ? '' : String(tin).trim();
    if (!tinStr) return null;
    const wantType = kind === 'P' ? 'Supplier' : 'Customer';
    const otherType = kind === 'P' ? 'Customer' : 'Supplier';
    const rows = this.db.all<{ id: number; type: string }>('SELECT id, type FROM parties WHERE tin = ?', [tinStr]);
    const match = rows.find((r) => r.type === wantType || r.type === 'Both');
    if (match) return match.id;
    const other = rows.find((r) => r.type === otherType);
    if (other) {
      this.db.run("UPDATE parties SET type = 'Both', updated_at = datetime('now') WHERE id = ?", [other.id]);
      return other.id;
    }
    const nameStr = name == null || String(name).trim() === '' ? tinStr : String(name).trim();
    const result = this.db.run('INSERT INTO parties (tin, name, type) VALUES (?, ?, ?)', [tinStr, nameStr, wantType]);
    return Number(result.lastInsertRowid);
  }

  private insertLines(invoiceId: number, lines: any[]) {
    lines.forEach((line, idx) => {
      this.db.run(
        `INSERT INTO invoice_lines (invoice_id, line_no, product_code, description, unit, tx_type, transaction_type, qty, unit_price, excise_rate, vatable_service_fee, non_vatable_fee)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          invoiceId,
          idx + 1,
          line.product_code || null,
          line.description || null,
          line.unit ?? null,
          line.tx_type ?? null,
          line.transaction_type || 'Vatable',
          Number(line.qty) || 0,
          Number(line.unit_price) || 0,
          Number(line.excise_rate) || 0,
          Number(line.vatable_service_fee) || 0,
          Number(line.non_vatable_fee) || 0,
        ],
      );
    });
  }

  create(kind: Kind, body: any, user: AuthUser) {
    this.validate(body);
    const period = taxPeriod(body.date);
    if (!period) throw new BadRequestException({ error: 'Please check the form', fields: { date: 'Invalid date' } });
    const partyId = this.resolvePartyId(kind, body.party_tin, body.party_name);

    const newId = this.db.transaction(() => {
      const result = this.db.run(
        `INSERT INTO invoices (kind, invoice_no, payment_type, vat_category, calendar_type, party_tin, party_name, party_id, date, fy, fy_month, receipt_type, mrc_number, vat_receipt_no, report_status, notes, created_by, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          kind,
          body.invoice_no,
          body.payment_type,
          body.vat_category,
          body.calendar_type || 'G',
          body.party_tin || null,
          body.party_name || null,
          partyId,
          body.date,
          period.fy,
          period.idx,
          body.receipt_type,
          body.mrc_number || null,
          body.vat_receipt_no || null,
          body.report_status || 'Not Reported',
          body.notes || null,
          user.id,
          user.id,
        ],
      );
      const invoiceId = Number(result.lastInsertRowid);
      this.insertLines(invoiceId, body.lines);
      return invoiceId;
    });

    logActivity(this.db, user, 'create', resourceFor(kind), newId, `created ${nounFor(kind)} ${body.invoice_no}`);
    return this.getDetail(kind, newId);
  }

  update(kind: Kind, id: number, body: any, user: AuthUser) {
    const existing = this.getInvoiceOrThrow(kind, id);
    if (!canCompany(user, existing.party_id, 'edit')) throw new ForbiddenException('No access to this party');
    this.validate(body);
    const period = taxPeriod(body.date);
    if (!period) throw new BadRequestException({ error: 'Please check the form', fields: { date: 'Invalid date' } });
    const partyId = this.resolvePartyId(kind, body.party_tin, body.party_name);

    this.db.transaction(() => {
      this.db.run(
        `UPDATE invoices SET invoice_no=?, payment_type=?, vat_category=?, calendar_type=?, party_tin=?, party_name=?, party_id=?, date=?, fy=?, fy_month=?, receipt_type=?, mrc_number=?, vat_receipt_no=?, report_status=?, notes=?, updated_by=?, updated_at=datetime('now') WHERE id=?`,
        [
          body.invoice_no,
          body.payment_type,
          body.vat_category,
          body.calendar_type || 'G',
          body.party_tin || null,
          body.party_name || null,
          partyId,
          body.date,
          period.fy,
          period.idx,
          body.receipt_type,
          body.mrc_number || null,
          body.vat_receipt_no || null,
          body.report_status || existing.report_status,
          body.notes || null,
          user.id,
          id,
        ],
      );
      this.db.run('DELETE FROM invoice_lines WHERE invoice_id = ?', [id]);
      this.insertLines(id, body.lines);
    });

    logActivity(this.db, user, 'update', resourceFor(kind), id, `updated ${nounFor(kind)} ${body.invoice_no}`);
    return this.getDetail(kind, id);
  }

  remove(kind: Kind, id: number, user: AuthUser) {
    const existing = this.getInvoiceOrThrow(kind, id);
    if (!canCompany(user, existing.party_id, 'delete')) throw new ForbiddenException('No access to this party');
    this.db.run('DELETE FROM invoices WHERE id = ?', [id]);
    logActivity(this.db, user, 'delete', resourceFor(kind), id, `deleted ${nounFor(kind)} ${existing.invoice_no}`);
  }

  bulkReportStatus(kind: Kind, ids: number[], status: string, user: AuthUser) {
    if (!Array.isArray(ids) || !ids.length) return;
    const placeholders = ids.map(() => '?').join(',');
    this.db.run(
      `UPDATE invoices SET report_status = ?, updated_by = ?, updated_at = datetime('now') WHERE kind = ? AND id IN (${placeholders})`,
      [status, user.id, kind, ...ids],
    );
    logActivity(this.db, user, 'update', resourceFor(kind), null, `marked ${ids.length} ${nounFor(kind)}(s) as ${status}`);
  }

  updateWithholding(kind: Kind, id: number, body: any, user: AuthUser) {
    const existing = this.getInvoiceOrThrow(kind, id);
    if (!canCompany(user, existing.party_id, 'edit')) throw new ForbiddenException('No access to this party');
    this.db.run(
      `UPDATE invoices SET wh_receipt_type=?, wh_receipt_no=?, wh_receipt_date=?, wh_paid=?, updated_by=?, updated_at=datetime('now') WHERE id=?`,
      [body.wh_receipt_type ?? null, body.wh_receipt_no ?? null, body.wh_receipt_date ?? null, Number(body.wh_paid) || 0, user.id, id],
    );
    logActivity(this.db, user, 'update', resourceFor(kind), id, `updated withholding on ${nounFor(kind)} ${existing.invoice_no}`);
    return this.getDetail(kind, id);
  }

  addPayment(kind: Kind, id: number, body: any, user: AuthUser) {
    const existing = this.getInvoiceOrThrow(kind, id);
    if (!canCompany(user, existing.party_id, 'edit')) throw new ForbiddenException('No access to this party');
    const amount = Number(body.amount);
    if (!body.date) throw new BadRequestException({ error: 'Please check the form', fields: { date: 'Required' } });
    if (!amount || amount <= 0) throw new BadRequestException({ error: 'Please check the form', fields: { amount: 'Required' } });
    this.db.run(
      'INSERT INTO payments (invoice_id, date, amount, method, reference) VALUES (?, ?, ?, ?, ?)',
      [id, body.date, amount, body.method || null, body.reference || null],
    );
    logActivity(this.db, user, 'update', resourceFor(kind), id, `recorded a ${amount} payment on ${existing.invoice_no}`);
    return this.getDetail(kind, id);
  }

  /** Shared `DELETE /api/payments/:id` route — determines kind/party from the payment's invoice. */
  removePaymentShared(paymentId: number, user: AuthUser) {
    const payment = this.db.get<PaymentRowRaw>('SELECT * FROM payments WHERE id = ?', [paymentId]);
    if (!payment) throw new NotFoundException('Payment not found');
    const invoice = this.db.get<InvoiceRowRaw>('SELECT * FROM invoices WHERE id = ?', [payment.invoice_id]);
    if (!invoice) throw new NotFoundException('Payment not found');

    const resource = resourceFor(invoice.kind);
    const task = invoice.kind === 'P' ? 'record_payment_p' : undefined;
    if (!can(user, resource, 'edit', task)) {
      throw new ForbiddenException(`Missing ${resource}.edit${task ? `/${task}` : ''}`);
    }
    if (!canCompany(user, invoice.party_id, 'edit')) throw new ForbiddenException('No access to this party');

    this.db.run('DELETE FROM payments WHERE id = ?', [paymentId]);
    logActivity(this.db, user, 'delete', 'payments', paymentId, `deleted a ${payment.amount} payment on ${nounFor(invoice.kind)} ${invoice.invoice_no}`);
    return this.getDetail(invoice.kind, invoice.id);
  }
}
