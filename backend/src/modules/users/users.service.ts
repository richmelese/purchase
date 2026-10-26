import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import { can } from '../../common/permissions';
import type { AuthUser } from '../../common/auth.guard';
import { loadFullUser, publicUser } from '../../common/user-loader';
import { hashPassword } from '../../common/password';

type PartyRights = Record<string, { view?: boolean; create?: boolean; edit?: boolean; delete?: boolean; export?: boolean }>;

export interface CreateUserBody {
  username: string;
  full_name: string;
  role_id?: number | null;
  role?: string;
  access_all_parties?: boolean;
  party_ids?: number[];
  party_rights?: PartyRights;
  password: string;
}

export interface UpdateUserBody {
  full_name?: string;
  active?: boolean;
  password?: string;
  role_id?: number | null;
  role?: string;
  access_all_parties?: boolean;
  party_ids?: number[];
  party_rights?: PartyRights;
}

// Fields gated by the `update_user` task.
const PROFILE_FIELDS = ['full_name', 'active', 'password'] as const;
// Fields gated by the `assign_roles_companies` task.
const ASSIGNMENT_FIELDS = ['role_id', 'role', 'access_all_parties', 'party_ids', 'party_rights'] as const;

@Injectable()
export class UsersService {
  constructor(private readonly db: DatabaseService) {}

  list() {
    const rows = this.db.all<{ id: number }>('SELECT id FROM users ORDER BY id');
    return rows.map((r) => publicUser(loadFullUser(this.db, r.id)!));
  }

  private insertPartyRights(userId: number, partyIds: number[], rights: PartyRights) {
    for (const partyIdRaw of partyIds) {
      const partyId = Number(partyIdRaw);
      if (!Number.isFinite(partyId)) continue;
      const r = rights?.[String(partyIdRaw)] || {};
      this.db.run(
        `INSERT INTO user_party_rights (user_id, party_id, view, "create", edit, "delete", "export") VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [userId, partyId, r.view ? 1 : 0, r.create ? 1 : 0, r.edit ? 1 : 0, r.delete ? 1 : 0, r.export ? 1 : 0],
      );
    }
  }

  create(body: CreateUserBody) {
    const fields: Record<string, string> = {};
    if (!body.username?.trim()) fields.username = 'Required';
    else if (this.db.get('SELECT 1 FROM users WHERE username = ?', [body.username.trim()])) {
      fields.username = 'That user name is already taken';
    }
    if (!body.full_name?.trim()) fields.full_name = 'Required';
    if (!body.password || body.password.length < 8) fields.password = 'At least 8 characters';
    if (Object.keys(fields).length) throw new BadRequestException({ error: 'Please check the form', fields });

    // access_all_parties defaults true (matches the users.access_all_parties column default).
    const accessAll = body.access_all_parties !== false;
    const result = this.db.run(
      `INSERT INTO users (username, full_name, password_hash, role_id, access_all_parties, must_change_password, active)
       VALUES (?, ?, ?, ?, ?, 1, 1)`,
      [body.username.trim(), body.full_name.trim(), hashPassword(body.password), body.role_id ?? null, accessAll ? 1 : 0],
    );
    const id = Number(result.lastInsertRowid);
    // access_all_parties:true clears/ignores any party_ids/party_rights sent, even if the client
    // sent non-empty arrays by mistake — skip the insert loop entirely per the contract.
    if (!accessAll && Array.isArray(body.party_ids) && body.party_ids.length) {
      this.insertPartyRights(id, body.party_ids, body.party_rights || {});
    }
    return publicUser(loadFullUser(this.db, id)!);
  }

  update(id: number, body: UpdateUserBody, actingUser: AuthUser) {
    const existing = this.db.get<{ id: number }>('SELECT id FROM users WHERE id = ?', [id]);
    if (!existing) throw new NotFoundException('User not found');

    const touchesProfile = PROFILE_FIELDS.some((k) => k in body);
    const touchesAssignment = ASSIGNMENT_FIELDS.some((k) => k in body);

    if (touchesProfile && !can(actingUser, 'users', 'edit', 'update_user')) {
      throw new ForbiddenException('Missing users.edit/update_user');
    }
    if (touchesAssignment && !can(actingUser, 'users', 'edit', 'assign_roles_companies')) {
      throw new ForbiddenException('Missing users.edit/assign_roles_companies');
    }

    const sets: string[] = [];
    const params: unknown[] = [];

    if (touchesProfile) {
      if ('full_name' in body) {
        if (!body.full_name?.trim()) throw new BadRequestException({ error: 'Please check the form', fields: { full_name: 'Required' } });
        sets.push('full_name = ?');
        params.push(body.full_name.trim());
      }
      if ('active' in body) {
        sets.push('active = ?');
        params.push(body.active ? 1 : 0);
      }
      if ('password' in body && body.password) {
        if (body.password.length < 8) {
          throw new BadRequestException({ error: 'Please check the form', fields: { password: 'At least 8 characters' } });
        }
        sets.push('password_hash = ?');
        params.push(hashPassword(body.password));
        sets.push('must_change_password = 1');
      }
    }

    if (touchesAssignment && 'role_id' in body) {
      sets.push('role_id = ?');
      params.push(body.role_id ?? null);
    }
    if (touchesAssignment && 'access_all_parties' in body) {
      sets.push('access_all_parties = ?');
      params.push(body.access_all_parties ? 1 : 0);
    }

    if (sets.length) {
      sets.push("updated_at = datetime('now')");
      this.db.run(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, [...params, id]);
    }

    if (touchesAssignment) {
      // Replace party rights wholesale whenever any assignment-group field is sent — mirrors
      // create's behavior and the contract's "access_all_parties:true clears them server-side".
      this.db.run('DELETE FROM user_party_rights WHERE user_id = ?', [id]);
      const becomesAccessAll = body.access_all_parties === true;
      if (!becomesAccessAll && Array.isArray(body.party_ids) && body.party_ids.length) {
        this.insertPartyRights(id, body.party_ids, body.party_rights || {});
      }
    }

    return publicUser(loadFullUser(this.db, id)!);
  }

  remove(id: number, actingUser: AuthUser) {
    if (id === actingUser.id) throw new BadRequestException({ error: 'You cannot delete your own account' });
    const target = loadFullUser(this.db, id);
    if (!target) throw new NotFoundException('User not found');
    if (target.role === 'admin' && actingUser.role !== 'admin') {
      throw new ForbiddenException('Only an administrator can delete an administrator account');
    }
    this.db.run('DELETE FROM users WHERE id = ?', [id]);
    return this.list();
  }
}
