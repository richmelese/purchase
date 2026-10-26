import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import type { AuthUser } from '../../common/auth.guard';
import { mergeCompanyProfile, companyProfileOptions } from '../../common/company-profile';
import { getPartyStatement, getInvoiceFull, loadRules } from '../parties/statement';

@Injectable()
export class PortalService {
  constructor(private readonly db: DatabaseService) {}

  /** AuthGuard already lets company accounts reach /api/portal/*; this rejects a STAFF session. */
  private partyId(user: AuthUser): number {
    if (!user.party_id) throw new ForbiddenException('Portal accounts only');
    return user.party_id;
  }

  company(user: AuthUser) {
    const partyId = this.partyId(user);
    const party = this.db.get<any>('SELECT * FROM parties WHERE id = ?', [partyId]);
    if (!party) throw new NotFoundException('Party not found');
    const settings = this.db.get<{ company_name: string; company_tin: string; company_address: string; wh_rate: number }>(
      'SELECT company_name, company_tin, company_address, wh_rate FROM settings WHERE id = 1',
    );
    let stored: any = {};
    try { stored = JSON.parse(party.profile || '{}'); } catch { stored = {}; }
    return {
      company: {
        name: party.name, tin: party.tin, type: party.type, mrc1: party.mrc1, mrc2: party.mrc2, mrc3: party.mrc3,
        profile: mergeCompanyProfile(stored, party.name),
      },
      issuer: {
        company_name: settings?.company_name || '', company_tin: settings?.company_tin || '',
        company_address: settings?.company_address || '', wh_rate: settings?.wh_rate ?? 0.03,
      },
      account: { username: party.login_username },
      options: companyProfileOptions(),
    };
  }

  statement(user: AuthUser) {
    const partyId = this.partyId(user);
    const full = getPartyStatement(this.db, partyId);
    if (!full) throw new NotFoundException('Party not found');
    const { party, ...rest } = full;
    return rest;
  }

  invoices(user: AuthUser, kind?: string) {
    const partyId = this.partyId(user);
    const k = kind === 'S' || kind === 'P' ? kind : undefined;
    const rules = loadRules(this.db);
    let sql = 'SELECT id FROM invoices WHERE party_id = ?';
    const params: unknown[] = [partyId];
    if (k) { sql += ' AND kind = ?'; params.push(k); }
    sql += ' ORDER BY date DESC, id DESC';
    const ids = this.db.all<{ id: number }>(sql, params);
    return ids.map((r) => {
      const full = getInvoiceFull(this.db, r.id, rules)!;
      return {
        id: full.id, invoice_no: full.invoice_no, date: full.date, receipt_type: full.receipt_type,
        vat_receipt_no: full.vat_receipt_no, payment_type: full.payment_type,
        grand_total: full.grand_total, balance: full.balance,
      };
    });
  }

  invoiceDetail(user: AuthUser, id: number) {
    const partyId = this.partyId(user);
    const rules = loadRules(this.db);
    const full = getInvoiceFull(this.db, id, rules);
    if (!full || full.party_id !== partyId) throw new NotFoundException('Invoice not found');
    return full;
  }
}
