// Shared statement/invoice-detail builder used by both `GET /api/parties/:id/statement` and
// `GET /api/portal/statement` (+ portal invoice list/detail), so the ledger SQL/calc logic lives
// in exactly one place. Pure functions over DatabaseService — no Nest DI needed, import directly.
import { DatabaseService } from '../../db/database.service';
import { computeLine, computeTotals, computeWithholding, round2, type RawLine, type ComputedLine, type WithholdingResult } from '../../common/calc';

export interface SettingsRules {
  vat_rate: number;
  wh_rate: number;
  wh_goods_threshold: number;
  wh_service_threshold: number;
}

const DEFAULT_RULES: SettingsRules = { vat_rate: 0.15, wh_rate: 0.03, wh_goods_threshold: 20000, wh_service_threshold: 10000 };

export function loadRules(db: DatabaseService): SettingsRules {
  const row = db.get<SettingsRules>(
    'SELECT vat_rate, wh_rate, wh_goods_threshold, wh_service_threshold FROM settings WHERE id = 1',
  );
  return row || DEFAULT_RULES;
}

interface InvoiceRow {
  id: number; kind: string; invoice_no: string; date: string; fy: number; fy_month: number;
  party_id: number | null; party_name: string | null; party_tin: string | null;
  vat_category: string; calendar_type: string; receipt_type: string; mrc_number: string | null;
  vat_receipt_no: string | null; payment_type: string; report_status: string; notes: string | null;
  wh_receipt_type: string | null; wh_receipt_no: string | null; wh_receipt_date: string | null; wh_paid: number;
  created_by: number | null; updated_by: number | null; created_at: string; updated_at: string;
}

interface ComputedInvoice {
  taxable_amount: number; grand_total: number; wh: WithholdingResult;
  amount_due: number; amount_paid: number; balance: number; totals: ReturnType<typeof computeTotals>;
  lines: ComputedLine[]; payments: any[];
}

function computeInvoice(db: DatabaseService, inv: InvoiceRow, rules: SettingsRules): ComputedInvoice {
  const rawLines = db.all<RawLine>('SELECT * FROM invoice_lines WHERE invoice_id = ? ORDER BY line_no', [inv.id]);
  const lines = rawLines.map((l) => computeLine(l, rules));
  const totals = computeTotals(lines);
  const wh = computeWithholding(
    { taxable_amount: totals.taxable_amount, vat_category: inv.vat_category, wh_receipt_type: inv.wh_receipt_type, wh_paid: inv.wh_paid },
    rules,
  );
  const payments = db.all<{ id: number; date: string; amount: number; method: string | null; reference: string | null }>(
    'SELECT * FROM payments WHERE invoice_id = ? ORDER BY date, id', [inv.id],
  );
  const amount_paid = round2(payments.reduce((s, p) => s + Number(p.amount || 0), 0));
  const amount_due = round2(totals.grand_total - wh.expected);
  const balance = round2(amount_due - amount_paid);
  return { taxable_amount: totals.taxable_amount, grand_total: totals.grand_total, wh, amount_due, amount_paid, balance, totals, lines, payments };
}

export interface LedgerRow {
  date: string; type: string; charge: number; payment: number; balance: number;
  invoice_id: number; ref: string; detail: string;
}

interface SideResult {
  rows: LedgerRow[];
  amount: number;
  count: number;
  wh: number;
  balanceSum: number;
}

function buildSide(db: DatabaseService, partyId: number, kind: 'P' | 'S', rules: SettingsRules): SideResult {
  const invoices = db.all<InvoiceRow>('SELECT * FROM invoices WHERE party_id = ? AND kind = ? ORDER BY date, id', [partyId, kind]);
  const typeLabel = kind === 'P' ? 'Purchase' : 'Sale';
  let amount = 0, whSum = 0, balanceSum = 0, seq = 0;
  const raw: { date: string; charge: number; payment: number; invoice_id: number; ref: string; detail: string; seq: number }[] = [];
  for (const inv of invoices) {
    const computed = computeInvoice(db, inv, rules);
    amount += computed.grand_total;
    whSum += computed.wh.expected;
    balanceSum += computed.balance;
    raw.push({ date: inv.date, charge: computed.grand_total, payment: 0, invoice_id: inv.id, ref: inv.invoice_no, detail: `${typeLabel} ${inv.invoice_no}`, seq: seq++ });
    for (const p of computed.payments) {
      const detail = p.method ? `Payment (${p.method}${p.reference ? ' - ' + p.reference : ''})` : 'Payment';
      raw.push({ date: p.date, charge: 0, payment: Number(p.amount || 0), invoice_id: inv.id, ref: inv.invoice_no, detail, seq: seq++ });
    }
  }
  raw.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.seq - b.seq));
  let running = 0;
  const rows: LedgerRow[] = raw.map((r) => {
    running += r.charge - r.payment;
    return { date: r.date, type: r.charge ? typeLabel : 'Payment', charge: round2(r.charge), payment: round2(r.payment), balance: round2(running), invoice_id: r.invoice_id, ref: r.ref, detail: r.detail };
  });
  return { rows, amount: round2(amount), count: invoices.length, wh: round2(whSum), balanceSum: round2(balanceSum) };
}

/** Lightweight per-party/kind amount+count, used by the parties list row (`purchased`/`sold`). */
export function invoiceTotals(db: DatabaseService, partyId: number, kind: 'P' | 'S', rules: SettingsRules): { amount: number; count: number } {
  const invoices = db.all<InvoiceRow>('SELECT * FROM invoices WHERE party_id = ? AND kind = ?', [partyId, kind]);
  let amount = 0;
  for (const inv of invoices) amount += computeInvoice(db, inv, rules).grand_total;
  return { amount: round2(amount), count: invoices.length };
}

export interface PartyStatement {
  party: { name: string; tin: string | null; mrc1: string | null; mrc2: string | null; mrc3: string | null; phone: string | null; email: string | null; address: string | null; type: string };
  totals: { purchased: number; purchaseCount: number; whWithheld: number; payable: number; sold: number; saleCount: number; whByCustomer: number; receivable: number };
  purchases: LedgerRow[];
  sales: LedgerRow[];
}

export function getPartyStatement(db: DatabaseService, partyId: number): PartyStatement | undefined {
  const party = db.get<any>('SELECT * FROM parties WHERE id = ?', [partyId]);
  if (!party) return undefined;
  const rules = loadRules(db);
  const p = buildSide(db, partyId, 'P', rules);
  const s = buildSide(db, partyId, 'S', rules);
  return {
    party: { name: party.name, tin: party.tin, mrc1: party.mrc1, mrc2: party.mrc2, mrc3: party.mrc3, phone: party.phone, email: party.email, address: party.address, type: party.type },
    totals: {
      purchased: p.amount, purchaseCount: p.count, whWithheld: p.wh, payable: p.balanceSum,
      sold: s.amount, saleCount: s.count, whByCustomer: s.wh, receivable: s.balanceSum,
    },
    purchases: p.rows,
    sales: s.rows,
  };
}

export interface InvoiceFull {
  id: number; kind: string; invoice_no: string; date: string; fy: number; fy_month: number;
  party_name: string | null; party_tin: string | null; party_id: number | null;
  receipt_type: string; vat_receipt_no: string | null; payment_type: string; report_status: string;
  taxable_amount: number; vat_amount: number; grand_total: number; balance: number;
  wh: WithholdingResult;
  total_amount: number; excise_amount: number; vatable_service_fee: number; non_vatable_fee: number;
  amount_due: number; amount_paid: number;
  wh_receipt_type: string | null; wh_receipt_no: string | null; wh_receipt_date: string | null; wh_paid: number;
  mrc_number: string | null; vat_category: string; calendar_type: string; notes: string | null;
  created_by: number | null; updated_by: number | null; created_at: string; updated_at: string;
  lines: ComputedLine[];
  payments: any[];
}

/** Full invoice detail shape (superset of the list row) — shared by portal invoice detail/list. */
export function getInvoiceFull(db: DatabaseService, id: number, rules: SettingsRules): InvoiceFull | undefined {
  const inv = db.get<InvoiceRow>('SELECT * FROM invoices WHERE id = ?', [id]);
  if (!inv) return undefined;
  const computed = computeInvoice(db, inv, rules);
  return {
    id: inv.id, kind: inv.kind, invoice_no: inv.invoice_no, date: inv.date, fy: inv.fy, fy_month: inv.fy_month,
    party_name: inv.party_name, party_tin: inv.party_tin, party_id: inv.party_id,
    receipt_type: inv.receipt_type, vat_receipt_no: inv.vat_receipt_no, payment_type: inv.payment_type, report_status: inv.report_status,
    taxable_amount: computed.totals.taxable_amount, vat_amount: computed.totals.vat_amount, grand_total: computed.totals.grand_total, balance: computed.balance,
    wh: computed.wh,
    total_amount: computed.totals.total_amount, excise_amount: computed.totals.excise_amount,
    vatable_service_fee: computed.totals.vatable_service_fee, non_vatable_fee: computed.totals.non_vatable_fee,
    amount_due: computed.amount_due, amount_paid: computed.amount_paid,
    wh_receipt_type: inv.wh_receipt_type, wh_receipt_no: inv.wh_receipt_no, wh_receipt_date: inv.wh_receipt_date, wh_paid: inv.wh_paid,
    mrc_number: inv.mrc_number, vat_category: inv.vat_category, calendar_type: inv.calendar_type, notes: inv.notes,
    created_by: inv.created_by, updated_by: inv.updated_by, created_at: inv.created_at, updated_at: inv.updated_at,
    lines: computed.lines,
    payments: computed.payments,
  };
}
