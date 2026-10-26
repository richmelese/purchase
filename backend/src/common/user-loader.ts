import { DatabaseService } from '../db/database.service';
import type { PermissionMap } from './permissions';

export interface FullUser {
  id: number;
  username: string;
  full_name: string;
  role_id: number | null;
  role: string; // role name, 'company' for portal accounts, '' if unassigned
  role_label: string;
  permissions: PermissionMap;
  access_all_parties: boolean;
  party_rights: Record<string, Record<string, boolean>>;
  assigned_parties: { id: number; name: string; rights: Record<string, boolean> }[];
  assigned_party_ids: number[];
  party_id: number | null;
  company_name?: string;
  must_change_password: boolean;
  active: boolean;
  last_login: string | null;
  created_at: string;
}

interface UserRow {
  id: number; username: string; full_name: string; password_hash: string;
  role_id: number | null; active: number; must_change_password: number; access_all_parties: number;
  party_id: number | null; last_login: string | null; created_at: string;
}

/** Builds the full user shape (role, permissions, party rights) consumed across the API and by `GET /auth/me`. */
export function loadFullUser(db: DatabaseService, id: number): (FullUser & { password_hash: string }) | undefined {
  const row = db.get<UserRow & { password_hash: string }>('SELECT * FROM users WHERE id = ?', [id]);
  if (!row) return undefined;

  let role = '';
  let roleLabel = '';
  let permissions: PermissionMap = {};
  if (row.party_id) {
    role = 'company';
    roleLabel = 'Company account';
  } else if (row.role_id) {
    const roleRow = db.get<{ name: string; label: string; permissions: string }>(
      'SELECT name, label, permissions FROM roles WHERE id = ?', [row.role_id],
    );
    if (roleRow) {
      role = roleRow.name;
      roleLabel = roleRow.label;
      try { permissions = JSON.parse(roleRow.permissions); } catch { permissions = {}; }
    }
  }

  const rightsRows = db.all<{ party_id: number; view: number; create: number; edit: number; delete: number; export: number; name: string }>(
    `SELECT upr.*, p.name FROM user_party_rights upr JOIN parties p ON p.id = upr.party_id WHERE upr.user_id = ?`,
    [id],
  );
  const party_rights: Record<string, Record<string, boolean>> = {};
  const assigned_parties = rightsRows.map((r) => {
    const rights = { view: !!r.view, create: !!r.create, edit: !!r.edit, delete: !!r.delete, export: !!r.export };
    party_rights[String(r.party_id)] = rights;
    return { id: r.party_id, name: r.name, rights };
  });

  let company_name: string | undefined;
  if (row.party_id) {
    const party = db.get<{ name: string }>('SELECT name FROM parties WHERE id = ?', [row.party_id]);
    company_name = party?.name;
  }

  return {
    ...row,
    role, role_label: roleLabel, permissions,
    access_all_parties: !!row.access_all_parties,
    party_rights, assigned_parties, assigned_party_ids: assigned_parties.map((p) => p.id),
    company_name,
    must_change_password: !!row.must_change_password,
    active: !!row.active,
  };
}

/** Public shape returned by GET /auth/me and in user list rows — drops the password hash. */
export function publicUser(user: FullUser & { password_hash?: string }) {
  const { password_hash, ...rest } = user;
  return rest;
}
