import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import { logActivity } from '../../common/activity-log';
import { hashPassword, randomPassword } from '../../common/password';
import type { AuthUser } from '../../common/auth.guard';
import { defaultCompanyProfile, mergeCompanyProfile, companyProfileOptions } from '../../common/company-profile';
import { getPartyStatement, invoiceTotals, loadRules } from './statement';

export interface PartyDto {
  tin?: string | null;
  name?: string;
  type?: string;
  mrc1?: string | null;
  mrc2?: string | null;
  mrc3?: string | null;
  profile?: any;
}

const PARTY_TYPES = ['Supplier', 'Customer', 'Both'];

function slugify(input: string): string {
  return (input || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '')
    .slice(0, 20);
}

@Injectable()
export class PartiesService {
  constructor(private readonly db: DatabaseService) {}

  list(type?: string, q?: string) {
    let sql = `SELECT id, tin, name, mrc1, mrc2, mrc3, type, phone, address, email, login_username, login_active
               FROM parties WHERE 1=1`;
    const params: unknown[] = [];
    if (type) { sql += ' AND type = ?'; params.push(type); }
    if (q) { sql += ' AND (tin LIKE ? OR name LIKE ?)'; params.push(`%${q}%`, `%${q}%`); }
    sql += ' ORDER BY name';
    const rows = this.db.all<any>(sql, params);
    const rules = loadRules(this.db);
    return rows.map((r) => this.toListRow(r, rules));
  }

  private toListRow(r: any, rules = loadRules(this.db)) {
    const purchased = invoiceTotals(this.db, r.id, 'P', rules);
    const sold = invoiceTotals(this.db, r.id, 'S', rules);
    const invoice_count = this.db.get<{ n: number }>('SELECT COUNT(*) n FROM invoices WHERE party_id = ?', [r.id])?.n ?? 0;
    return {
      id: r.id, tin: r.tin, name: r.name, mrc1: r.mrc1, mrc2: r.mrc2, mrc3: r.mrc3, type: r.type,
      phone: r.phone, address: r.address, email: r.email,
      login_username: r.login_username ?? null, login_active: !!r.login_active,
      purchased: purchased.amount, sold: sold.amount, invoice_count,
    };
  }

  private getListRow(id: number) {
    const row = this.db.get<any>(
      `SELECT id, tin, name, mrc1, mrc2, mrc3, type, phone, address, email, login_username, login_active
       FROM parties WHERE id = ?`, [id],
    );
    if (!row) throw new NotFoundException('Party not found');
    return this.toListRow(row);
  }

  profileTemplate() {
    return { profile: defaultCompanyProfile(), options: companyProfileOptions() };
  }

  getOne(id: number) {
    const row = this.db.get<any>('SELECT * FROM parties WHERE id = ?', [id]);
    if (!row) throw new NotFoundException('Party not found');
    let stored: any = {};
    try { stored = JSON.parse(row.profile || '{}'); } catch { stored = {}; }
    return {
      id: row.id, tin: row.tin, name: row.name, type: row.type, mrc1: row.mrc1, mrc2: row.mrc2, mrc3: row.mrc3,
      profile: mergeCompanyProfile(stored, row.name),
      options: companyProfileOptions(),
    };
  }

  create(dto: PartyDto, user: AuthUser) {
    const fields: Record<string, string> = {};
    const name = (dto.name || '').trim();
    if (!name) fields.name = 'Required';
    const tin = dto.tin != null && String(dto.tin).trim() !== '' ? String(dto.tin).trim() : null;
    if (tin && tin.replace(/[^0-9A-Za-z]/g, '').length < 3) fields.tin = 'Enter a valid TIN';
    const type = dto.type && PARTY_TYPES.includes(dto.type) ? dto.type : 'Supplier';
    if (Object.keys(fields).length) throw new BadRequestException({ error: 'Please check the form', fields });

    const profile = mergeCompanyProfile(dto.profile, name);
    profile.updated_at = new Date().toISOString();
    profile.updated_by = user.username;

    const result = this.db.run(
      'INSERT INTO parties (tin, name, type, mrc1, mrc2, mrc3, profile) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [tin, name, type, dto.mrc1 ?? null, dto.mrc2 ?? null, dto.mrc3 ?? null, JSON.stringify(profile)],
    );
    const id = Number(result.lastInsertRowid);
    logActivity(this.db, user, 'create', 'parties', id, `created party "${name}"`);

    // Customers get a portal login automatically, so they can sign in and see their own
    // profile/invoices/statement right away without a separate "Create login" step.
    const account = type === 'Customer' || type === 'Both' ? this.generateAccount(id, user) : undefined;
    return { ...this.getListRow(id), account };
  }

  update(id: number, dto: PartyDto, user: AuthUser) {
    const existing = this.db.get<any>('SELECT * FROM parties WHERE id = ?', [id]);
    if (!existing) throw new NotFoundException('Party not found');

    const fields: Record<string, string> = {};
    const name = dto.name !== undefined ? String(dto.name).trim() : existing.name;
    if (!name) fields.name = 'Required';
    const tin = dto.tin !== undefined
      ? (dto.tin != null && String(dto.tin).trim() !== '' ? String(dto.tin).trim() : null)
      : existing.tin;
    if (tin && tin.replace(/[^0-9A-Za-z]/g, '').length < 3) fields.tin = 'Enter a valid TIN';
    if (Object.keys(fields).length) throw new BadRequestException({ error: 'Please check the form', fields });

    const type = dto.type && PARTY_TYPES.includes(dto.type) ? dto.type : existing.type;
    const mrc1 = dto.mrc1 !== undefined ? dto.mrc1 : existing.mrc1;
    const mrc2 = dto.mrc2 !== undefined ? dto.mrc2 : existing.mrc2;
    const mrc3 = dto.mrc3 !== undefined ? dto.mrc3 : existing.mrc3;

    // Contract doesn't require a deep merge of `profile` — replacing wholesale (filled with
    // defaults for any missing fields) is simpler and explicitly allowed.
    const sourceProfile = dto.profile !== undefined ? dto.profile : JSON.parse(existing.profile || '{}');
    const profile = mergeCompanyProfile(sourceProfile, name);
    profile.updated_at = new Date().toISOString();
    profile.updated_by = user.username;

    this.db.run(
      "UPDATE parties SET tin=?, name=?, type=?, mrc1=?, mrc2=?, mrc3=?, profile=?, updated_at=datetime('now') WHERE id=?",
      [tin, name, type, mrc1, mrc2, mrc3, JSON.stringify(profile), id],
    );
    logActivity(this.db, user, 'update', 'parties', id, `updated party "${name}"`);
    return this.getListRow(id);
  }

  remove(id: number, user: AuthUser) {
    const existing = this.db.get<any>('SELECT * FROM parties WHERE id = ?', [id]);
    if (!existing) throw new NotFoundException('Party not found');
    const invCount = this.db.get<{ n: number }>('SELECT COUNT(*) n FROM invoices WHERE party_id = ?', [id])?.n ?? 0;
    if (invCount > 0) {
      throw new BadRequestException({ error: 'This party has recorded invoices and cannot be deleted' });
    }
    this.db.transaction(() => {
      const existingUser = this.db.get<{ id: number }>('SELECT id FROM users WHERE party_id = ?', [id]);
      if (existingUser) {
        this.db.run('DELETE FROM sessions WHERE user_id = ?', [existingUser.id]);
        this.db.run('DELETE FROM users WHERE id = ?', [existingUser.id]);
      }
      this.db.run('DELETE FROM parties WHERE id = ?', [id]);
    });
    logActivity(this.db, user, 'delete', 'parties', id, `deleted party "${existing.name}"`);
  }

  private usernameTaken(username: string): boolean {
    return !!this.db.get('SELECT 1 FROM users WHERE username = ?', [username])
      || !!this.db.get('SELECT 1 FROM parties WHERE login_username = ?', [username]);
  }

  private generateUsername(name: string): string {
    const base = slugify(name) || 'party';
    let candidate = base;
    let n = 0;
    while (this.usernameTaken(candidate)) {
      n += 1;
      candidate = n === 1 ? `${base}${Math.floor(100 + Math.random() * 900)}` : `${base}${n}${Math.floor(10 + Math.random() * 90)}`;
    }
    return candidate;
  }

  generateAccount(id: number, user: AuthUser) {
    const party = this.db.get<any>('SELECT * FROM parties WHERE id = ?', [id]);
    if (!party) throw new NotFoundException('Party not found');

    const plain = randomPassword();
    const hash = hashPassword(plain);
    const existingUser = this.db.get<{ id: number }>('SELECT id FROM users WHERE party_id = ?', [id]);

    let username: string;
    let created: boolean;

    if (party.login_username) {
      // Login already exists (reset password, invalidate sessions).
      username = party.login_username;
      created = false;
      if (existingUser) {
        this.db.run(
          "UPDATE users SET password_hash=?, must_change_password=1, active=1, updated_at=datetime('now') WHERE id=?",
          [hash, existingUser.id],
        );
        this.db.run('DELETE FROM sessions WHERE user_id = ?', [existingUser.id]);
      } else {
        // Data drift safety net: party has a username but no users row — (re)create it.
        this.db.run(
          'INSERT INTO users (username, full_name, password_hash, role_id, active, must_change_password, access_all_parties, party_id) VALUES (?, ?, ?, NULL, 1, 1, 0, ?)',
          [username, party.name, hash, id],
        );
      }
      this.db.run('UPDATE parties SET login_active=1 WHERE id=?', [id]);
    } else {
      username = this.generateUsername(party.name);
      created = true;
      this.db.transaction(() => {
        this.db.run('UPDATE parties SET login_username=?, login_active=1 WHERE id=?', [username, id]);
        this.db.run(
          'INSERT INTO users (username, full_name, password_hash, role_id, active, must_change_password, access_all_parties, party_id) VALUES (?, ?, ?, NULL, 1, 1, 0, ?)',
          [username, party.name, hash, id],
        );
      });
    }

    logActivity(this.db, user, created ? 'create' : 'update', 'parties', id, `${created ? 'created' : 'reset'} portal login "${username}" for "${party.name}"`);
    return { username, password: plain, created };
  }

  statement(id: number) {
    const result = getPartyStatement(this.db, id);
    if (!result) throw new NotFoundException('Party not found');
    return result;
  }
}
