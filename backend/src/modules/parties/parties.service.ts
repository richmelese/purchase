import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService, SQL_NOW } from '../../db/database.service';
import { logActivity } from '../../common/activity-log';
import { hashPassword, randomPassword } from '../../common/password';
import type { AuthUser } from '../../common/auth.guard';
import { defaultCompanyProfile, mergeCompanyProfile, companyProfileOptions } from '../../common/company-profile';
import { getPartyStatement, invoiceTotals, loadRules, type SettingsRules } from './statement';

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

  async list(type?: string, q?: string) {
    let sql = `SELECT id, tin, name, mrc1, mrc2, mrc3, type, phone, address, email, login_username, login_active
               FROM parties WHERE merged_into_id IS NULL`;
    const params: unknown[] = [];
    if (type) { sql += ' AND type = ?'; params.push(type); }
    if (q) { sql += ' AND (tin LIKE ? OR name LIKE ?)'; params.push(`%${q}%`, `%${q}%`); }
    sql += ' ORDER BY name';
    const rows = await this.db.all<any>(sql, params);
    const rules = await loadRules(this.db);
    return Promise.all(rows.map((r) => this.toListRow(r, rules)));
  }

  private async toListRow(r: any, rules?: SettingsRules) {
    const effectiveRules = rules ?? (await loadRules(this.db));
    const purchased = await invoiceTotals(this.db, r.id, 'P', effectiveRules);
    const sold = await invoiceTotals(this.db, r.id, 'S', effectiveRules);
    const countRow = await this.db.get<{ n: number }>('SELECT COUNT(*) n FROM invoices WHERE party_id = ?', [r.id]);
    const invoice_count = countRow?.n ?? 0;
    return {
      id: r.id, tin: r.tin, name: r.name, mrc1: r.mrc1, mrc2: r.mrc2, mrc3: r.mrc3, type: r.type,
      phone: r.phone, address: r.address, email: r.email,
      login_username: r.login_username ?? null, login_active: !!r.login_active,
      purchased: purchased.amount, sold: sold.amount, invoice_count,
    };
  }

  private async getListRow(id: number) {
    const row = await this.db.get<any>(
      `SELECT id, tin, name, mrc1, mrc2, mrc3, type, phone, address, email, login_username, login_active
       FROM parties WHERE id = ?`, [id],
    );
    if (!row) throw new NotFoundException('Party not found');
    return this.toListRow(row);
  }

  profileTemplate() {
    return { profile: defaultCompanyProfile(), options: companyProfileOptions() };
  }

  async getOne(id: number) {
    const row = await this.db.get<any>('SELECT * FROM parties WHERE id = ?', [id]);
    if (!row) throw new NotFoundException('Party not found');
    let stored: any = {};
    try { stored = JSON.parse(row.profile || '{}'); } catch { stored = {}; }
    return {
      id: row.id, tin: row.tin, name: row.name, type: row.type, mrc1: row.mrc1, mrc2: row.mrc2, mrc3: row.mrc3,
      merged_into_id: row.merged_into_id ?? null,
      profile: mergeCompanyProfile(stored, row.name),
      options: companyProfileOptions(),
    };
  }

  /** Other active (non-merged-away) parties already using `tin`, excluding `excludeId` — used to
   * warn (not block) on a duplicate TIN during create/update. */
  private async findTinMatches(tin: string, excludeId?: number) {
    let sql = 'SELECT id, name, type FROM parties WHERE tin = ? AND merged_into_id IS NULL';
    const params: unknown[] = [tin];
    if (excludeId !== undefined) { sql += ' AND id != ?'; params.push(excludeId); }
    sql += ' ORDER BY id';
    return this.db.all<{ id: number; name: string; type: string }>(sql, params);
  }

  async create(dto: PartyDto, user: AuthUser) {
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

    // Warn (don't block) if another active party already uses this TIN — the client explicitly
    // chose "warn, don't block" over a hard uniqueness constraint; see merge() for the
    // after-the-fact correction workflow.
    const tinMatches = tin ? await this.findTinMatches(tin) : [];

    const result = await this.db.get<{ id: number }>(
      'INSERT INTO parties (tin, name, type, mrc1, mrc2, mrc3, profile) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id',
      [tin, name, type, dto.mrc1 ?? null, dto.mrc2 ?? null, dto.mrc3 ?? null, JSON.stringify(profile)],
    );
    const id = Number(result!.id);
    await logActivity(this.db, user, 'create', 'parties', id, `created party "${name}"`);

    // Customers get a portal login automatically, so they can sign in and see their own
    // profile/invoices/statement right away without a separate "Create login" step.
    const account = type === 'Customer' || type === 'Both' ? await this.generateAccount(id, user) : undefined;
    const created = { ...(await this.getListRow(id)), account };
    if (tinMatches.length) {
      return { ...created, tin_warning: { message: 'Another party already uses this TIN', matches: tinMatches } };
    }
    return created;
  }

  async update(id: number, dto: PartyDto, user: AuthUser) {
    const existing = await this.db.get<any>('SELECT * FROM parties WHERE id = ?', [id]);
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

    // Warn (don't block) if the TIN is changing to one another active party already uses.
    const tinChanged = tin !== existing.tin;
    const tinMatches = tin && tinChanged ? await this.findTinMatches(tin, id) : [];

    await this.db.run(
      `UPDATE parties SET tin=?, name=?, type=?, mrc1=?, mrc2=?, mrc3=?, profile=?, updated_at=${SQL_NOW} WHERE id=?`,
      [tin, name, type, mrc1, mrc2, mrc3, JSON.stringify(profile), id],
    );
    await logActivity(this.db, user, 'update', 'parties', id, `updated party "${name}"`, {
      before: { tin: existing.tin, name: existing.name, type: existing.type, mrc1: existing.mrc1, mrc2: existing.mrc2, mrc3: existing.mrc3 },
      after: { tin, name, type, mrc1, mrc2, mrc3 },
    });
    const updated = await this.getListRow(id);
    if (tinMatches.length) {
      return { ...updated, tin_warning: { message: 'Another party already uses this TIN', matches: tinMatches } };
    }
    return updated;
  }

  async remove(id: number, user: AuthUser) {
    const existing = await this.db.get<any>('SELECT * FROM parties WHERE id = ?', [id]);
    if (!existing) throw new NotFoundException('Party not found');
    const invCountRow = await this.db.get<{ n: number }>('SELECT COUNT(*) n FROM invoices WHERE party_id = ?', [id]);
    const invCount = invCountRow?.n ?? 0;
    if (invCount > 0) {
      throw new BadRequestException({ error: 'This party has recorded invoices and cannot be deleted' });
    }
    const mergedCountRow = await this.db.get<{ n: number }>('SELECT COUNT(*) n FROM parties WHERE merged_into_id = ?', [id]);
    if ((mergedCountRow?.n ?? 0) > 0) {
      throw new BadRequestException({ error: 'Other parties have been merged into this one and cannot be deleted' });
    }
    await this.db.transaction(async (trx) => {
      const existingUser = await trx.get<{ id: number }>('SELECT id FROM users WHERE party_id = ?', [id]);
      if (existingUser) {
        await trx.run('DELETE FROM sessions WHERE user_id = ?', [existingUser.id]);
        await trx.run('DELETE FROM users WHERE id = ?', [existingUser.id]);
      }
      await trx.run('DELETE FROM parties WHERE id = ?', [id]);
    });
    await logActivity(this.db, user, 'delete', 'parties', id, `deleted party "${existing.name}"`);
  }

  /**
   * Merges the duplicate party `id` into the survivor `intoId` (manual's "authorized merge
   * workflow"): moves every party_id foreign key over, then marks the duplicate as merged
   * (merged_into_id) rather than deleting it, so its name/TIN/old id stay resolvable as history.
   */
  async merge(id: number, intoId: number, user: AuthUser) {
    if (!Number.isFinite(intoId)) {
      throw new BadRequestException({ error: 'into_id is required' });
    }
    if (id === intoId) {
      throw new BadRequestException({ error: 'A party cannot be merged into itself' });
    }
    const dup = await this.db.get<any>('SELECT * FROM parties WHERE id = ?', [id]);
    if (!dup) throw new NotFoundException('Party not found');
    const survivor = await this.db.get<any>('SELECT * FROM parties WHERE id = ?', [intoId]);
    if (!survivor) throw new NotFoundException('Target party not found');
    if (dup.merged_into_id != null) {
      throw new BadRequestException({ error: `This party has already been merged into another party (#${dup.merged_into_id})` });
    }
    if (survivor.merged_into_id != null) {
      throw new BadRequestException({ error: `Target party has already been merged into another party (#${survivor.merged_into_id})` });
    }

    await this.db.transaction(async (trx) => {
      // Move every FK reference from the duplicate's id to the survivor's (see schema.ts for the
      // full list of `party_id` columns referencing parties(id)).
      await trx.run('UPDATE invoices SET party_id = ? WHERE party_id = ?', [intoId, id]);
      await trx.run('UPDATE payments SET party_id = ? WHERE party_id = ?', [intoId, id]);

      // user_party_rights has a composite PK (user_id, party_id) — if a user already has a rights
      // row for the survivor, reassigning the duplicate's row would collide on that PK, so drop
      // the duplicate's row for those users before reassigning the rest.
      await trx.run(
        `DELETE FROM user_party_rights dup
         WHERE dup.party_id = ? AND EXISTS (
           SELECT 1 FROM user_party_rights surv WHERE surv.party_id = ? AND surv.user_id = dup.user_id
         )`,
        [id, intoId],
      );
      await trx.run('UPDATE user_party_rights SET party_id = ? WHERE party_id = ?', [intoId, id]);

      // A merged-away party shouldn't still have a working portal login: deactivate its user
      // account (and sessions) before reassigning the FK, same as parties.remove() does.
      if (dup.login_active) {
        const dupUser = await trx.get<{ id: number }>('SELECT id FROM users WHERE party_id = ?', [id]);
        if (dupUser) {
          await trx.run(`UPDATE users SET active=0, updated_at=${SQL_NOW} WHERE id=?`, [dupUser.id]);
          await trx.run('DELETE FROM sessions WHERE user_id = ?', [dupUser.id]);
        }
        await trx.run('UPDATE parties SET login_active=0 WHERE id=?', [id]);
      }
      await trx.run('UPDATE users SET party_id = ? WHERE party_id = ?', [intoId, id]);

      await trx.run(`UPDATE parties SET merged_into_id = ?, updated_at=${SQL_NOW} WHERE id = ?`, [intoId, id]);
    });

    await logActivity(
      this.db, user, 'update', 'parties', intoId,
      `merged party "${dup.name}" (TIN ${dup.tin || 'none'}) into "${survivor.name}"`,
      { before: { duplicate_id: id, duplicate_name: dup.name, duplicate_tin: dup.tin }, after: { merged_into_id: intoId } },
    );

    return this.getOne(intoId);
  }

  private async usernameTaken(username: string): Promise<boolean> {
    return !!(await this.db.get('SELECT 1 FROM users WHERE username = ?', [username]))
      || !!(await this.db.get('SELECT 1 FROM parties WHERE login_username = ?', [username]));
  }

  private async generateUsername(name: string): Promise<string> {
    const base = slugify(name) || 'party';
    let candidate = base;
    let n = 0;
    while (await this.usernameTaken(candidate)) {
      n += 1;
      candidate = n === 1 ? `${base}${Math.floor(100 + Math.random() * 900)}` : `${base}${n}${Math.floor(10 + Math.random() * 90)}`;
    }
    return candidate;
  }

  async generateAccount(id: number, user: AuthUser) {
    const party = await this.db.get<any>('SELECT * FROM parties WHERE id = ?', [id]);
    if (!party) throw new NotFoundException('Party not found');

    const plain = randomPassword();
    const hash = hashPassword(plain);
    const existingUser = await this.db.get<{ id: number }>('SELECT id FROM users WHERE party_id = ?', [id]);

    let username: string;
    let created: boolean;

    if (party.login_username) {
      // Login already exists (reset password, invalidate sessions).
      username = party.login_username;
      created = false;
      if (existingUser) {
        await this.db.run(
          `UPDATE users SET password_hash=?, must_change_password=1, active=1, updated_at=${SQL_NOW} WHERE id=?`,
          [hash, existingUser.id],
        );
        await this.db.run('DELETE FROM sessions WHERE user_id = ?', [existingUser.id]);
      } else {
        // Data drift safety net: party has a username but no users row — (re)create it.
        await this.db.run(
          'INSERT INTO users (username, full_name, password_hash, role_id, active, must_change_password, access_all_parties, party_id) VALUES (?, ?, ?, NULL, 1, 1, 0, ?)',
          [username, party.name, hash, id],
        );
      }
      await this.db.run('UPDATE parties SET login_active=1 WHERE id=?', [id]);
    } else {
      username = await this.generateUsername(party.name);
      created = true;
      const finalUsername = username;
      await this.db.transaction(async (trx) => {
        await trx.run('UPDATE parties SET login_username=?, login_active=1 WHERE id=?', [finalUsername, id]);
        await trx.run(
          'INSERT INTO users (username, full_name, password_hash, role_id, active, must_change_password, access_all_parties, party_id) VALUES (?, ?, ?, NULL, 1, 1, 0, ?)',
          [finalUsername, party.name, hash, id],
        );
      });
    }

    await logActivity(this.db, user, created ? 'create' : 'update', 'parties', id, `${created ? 'created' : 'reset'} portal login "${username}" for "${party.name}"`);
    return { username, password: plain, created };
  }

  async statement(id: number) {
    const result = await getPartyStatement(this.db, id);
    if (!result) throw new NotFoundException('Party not found');
    return result;
  }
}
