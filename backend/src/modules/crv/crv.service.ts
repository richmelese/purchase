import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import { logActivity } from '../../common/activity-log';
import { can, canCompany } from '../../common/permissions';
import type { AuthUser } from '../../common/auth.guard';

/**
 * Categories a CRV (Cash/Credit Receipt Voucher) can carry. `credit_collection` records money
 * actually collected against a Credit purchase/sale and requires `invoice_id`; the other three are
 * standalone money-in events with no invoice behind them ("Module 2: CRV Declaration" in the
 * client's phasing doc). Per the client's explicit instruction, recording/removing a collection is
 * done ENTIRELY here, not from the purchase/sale page — there is no `.../:id/payments` route
 * anymore (removed from purchases/sales controllers) so this is the only way to create one.
 */
const STANDALONE_CATEGORIES = ['loan', 'shareholder_contribution', 'other_refund'] as const;
type StandaloneCategory = (typeof STANDALONE_CATEGORIES)[number];
const ALL_CATEGORIES = ['credit_collection', ...STANDALONE_CATEGORIES] as const;

const resourceFor = (kind: 'P' | 'S') => (kind === 'P' ? 'purchases' : 'sales');

export interface CrvListQuery {
  category?: string;
  party_id?: string;
  q?: string;
}

interface CrvRow {
  id: number;
  crv_no: number;
  date: string;
  amount: number;
  method: string | null;
  reference: string | null;
  category: string;
  note: string | null;
  party_id: number | null;
  party_name: string | null;
  invoice_id: number | null;
  invoice_no: string | null;
  invoice_kind: 'P' | 'S' | null;
  created_at: string;
}

const CRV_SELECT = `
  SELECT p.id, p.crv_no, p.date, p.amount, p.method, p.reference, p.category, p.note,
         p.party_id, pt.name AS party_name, p.invoice_id, inv.invoice_no, inv.kind AS invoice_kind, p.created_at
  FROM payments p
  LEFT JOIN parties pt ON pt.id = p.party_id
  LEFT JOIN invoices inv ON inv.id = p.invoice_id
`;

/**
 * `payments` doubles as the CRV register for every money-in event (see schema.ts's migration
 * comment): rows with `category = 'credit_collection'` come from the invoice-payment path
 * (InvoicesService); rows with the other three categories are created here, standalone (no
 * invoice_id). `crv_no` is always assigned by the `payments_crv_no_seq` DB sequence default —
 * this service never names it in an INSERT column list, so every create goes through the same
 * gap-free, race-free numbering regardless of category.
 */
@Injectable()
export class CrvService {
  constructor(private readonly db: DatabaseService) {}

  async list(query: CrvListQuery): Promise<CrvRow[]> {
    const where: string[] = [];
    const params: unknown[] = [];
    if (query.category) {
      where.push('p.category = ?');
      params.push(query.category);
    }
    if (query.party_id) {
      where.push('p.party_id = ?');
      params.push(Number(query.party_id));
    }
    if (query.q) {
      const like = `%${query.q}%`;
      where.push('(p.note LIKE ? OR p.reference LIKE ? OR pt.name LIKE ?)');
      params.push(like, like, like);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    return this.db.all<CrvRow>(`${CRV_SELECT} ${whereSql} ORDER BY p.crv_no DESC`, params);
  }

  async getDetail(id: number): Promise<CrvRow> {
    const row = await this.db.get<CrvRow>(`${CRV_SELECT} WHERE p.id = ?`, [id]);
    if (!row) throw new NotFoundException('CRV not found');
    return row;
  }

  async create(body: any, user: AuthUser): Promise<CrvRow> {
    const fields: Record<string, string> = {};
    if (!body.date) fields.date = 'Required';
    const amount = Number(body.amount);
    if (!amount || amount <= 0) fields.amount = 'Required';

    if (!body.category) {
      fields.category = 'Required';
    } else if (!ALL_CATEGORIES.includes(body.category)) {
      fields.category = `Must be one of: ${ALL_CATEGORIES.join(', ')}`;
    }
    const category = body.category as (typeof ALL_CATEGORIES)[number];
    const isCollection = category === 'credit_collection';

    if (isCollection && body.invoice_id == null) fields.invoice_id = 'Required for a credit collection';
    if (!isCollection && body.invoice_id != null) fields.invoice_id = 'A standalone CRV cannot be linked to an invoice';

    let invoice: { id: number; kind: 'P' | 'S'; party_id: number | null; payment_type: string; invoice_no: string } | undefined;
    if (isCollection && body.invoice_id != null && !fields.invoice_id) {
      invoice = await this.db.get(
        'SELECT id, kind, party_id, payment_type, invoice_no FROM invoices WHERE id = ?',
        [Number(body.invoice_id)],
      );
      if (!invoice) fields.invoice_id = 'Invoice not found';
      else if (invoice.payment_type !== 'Credit') {
        fields.invoice_id = 'Only Credit purchases/sales can have a collection recorded against them';
      }
    }

    let partyId: number | null = null;
    if (!isCollection && body.party_id != null && body.party_id !== '') {
      partyId = Number(body.party_id);
      const party = await this.db.get<{ id: number }>('SELECT id FROM parties WHERE id = ?', [partyId]);
      if (!party) fields.party_id = 'Party not found';
    }

    if (Object.keys(fields).length) {
      throw new BadRequestException({ error: 'Please check the form', fields });
    }

    if (invoice) {
      const resource = resourceFor(invoice.kind);
      const task = invoice.kind === 'P' ? 'record_payment_p' : undefined;
      if (!can(user, resource, 'create', task) && !can(user, resource, 'edit', task)) {
        throw new ForbiddenException(`Missing ${resource}.edit${task ? `/${task}` : ''}`);
      }
      if (!canCompany(user, invoice.party_id, 'edit')) throw new ForbiddenException('No access to this party');
    }

    const row = await this.db.get<{ id: number; crv_no: number }>(
      `INSERT INTO payments (date, amount, method, reference, category, party_id, invoice_id, note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id, crv_no`,
      [body.date, amount, body.method || null, body.reference || null, category, partyId, invoice?.id ?? null, body.note || null],
    );

    const summary = invoice
      ? `recorded a ${amount} collection (CRV #${row!.crv_no}) on ${invoice.invoice_no}`
      : `recorded CRV #${row!.crv_no} (${category}) for ${amount}`;
    await logActivity(this.db, user, 'create', 'crv', row!.id, summary);
    return this.getDetail(row!.id);
  }

  async remove(id: number, user: AuthUser): Promise<void> {
    const row = await this.db.get<{
      id: number; category: string; amount: number; crv_no: number;
      invoice_id: number | null;
    }>('SELECT id, category, amount, crv_no, invoice_id FROM payments WHERE id = ?', [id]);
    if (!row) throw new NotFoundException('CRV not found');

    let logNoun = `CRV #${row.crv_no} (${row.category}) for ${row.amount}`;
    if (row.invoice_id != null) {
      const invoice = await this.db.get<{ kind: 'P' | 'S'; party_id: number | null; invoice_no: string }>(
        'SELECT kind, party_id, invoice_no FROM invoices WHERE id = ?',
        [row.invoice_id],
      );
      if (invoice) {
        const resource = resourceFor(invoice.kind);
        const task = invoice.kind === 'P' ? 'record_payment_p' : undefined;
        if (!can(user, resource, 'edit', task)) {
          throw new ForbiddenException(`Missing ${resource}.edit${task ? `/${task}` : ''}`);
        }
        if (!canCompany(user, invoice.party_id, 'edit')) throw new ForbiddenException('No access to this party');
        logNoun = `a ${row.amount} collection (CRV #${row.crv_no}) on ${invoice.invoice_no}`;
      }
    }

    await this.db.run('DELETE FROM payments WHERE id = ?', [id]);
    await logActivity(this.db, user, 'delete', 'crv', id, `deleted ${logNoun}`);
  }
}
