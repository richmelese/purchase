import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import type { PermissionMap } from '../../common/permissions';

export interface RoleBody {
  name: string;
  label: string;
  description?: string;
  permissions: PermissionMap;
}

interface RoleRow {
  id: number;
  name: string;
  label: string;
  description: string | null;
  permissions: string;
  is_system: number;
}

@Injectable()
export class RolesService {
  constructor(private readonly db: DatabaseService) {}

  private async toApi(r: RoleRow) {
    let permissions: PermissionMap = {};
    try {
      permissions = JSON.parse(r.permissions);
    } catch {
      permissions = {};
    }
    const userCount = await this.db.get<{ n: number }>('SELECT COUNT(*) n FROM users WHERE role_id = ?', [r.id]);
    return {
      id: r.id,
      name: r.name,
      label: r.label,
      description: r.description,
      permissions,
      is_system: !!r.is_system,
      user_count: userCount?.n ?? 0,
    };
  }

  async list() {
    const rows = await this.db.all<RoleRow>('SELECT * FROM roles ORDER BY id');
    return Promise.all(rows.map((r) => this.toApi(r)));
  }

  async create(body: RoleBody) {
    const fields: Record<string, string> = {};
    if (!body.name?.trim()) fields.name = 'Required';
    else if (await this.db.get('SELECT 1 FROM roles WHERE name = ?', [body.name.trim()])) {
      fields.name = 'That role name already exists';
    }
    if (!body.label?.trim()) fields.label = 'Required';
    if (Object.keys(fields).length) throw new BadRequestException({ error: 'Please check the form', fields });

    const row = await this.db.get<RoleRow>(
      'INSERT INTO roles (name, label, description, permissions, is_system) VALUES (?, ?, ?, ?, 0) RETURNING *',
      [body.name.trim(), body.label.trim(), body.description ?? null, JSON.stringify(body.permissions || {})],
    );
    return this.toApi(row!);
  }

  async update(id: number, body: RoleBody) {
    const row = await this.db.get<RoleRow>('SELECT * FROM roles WHERE id = ?', [id]);
    if (!row) throw new NotFoundException('Role not found');
    // Check the stored row's name, not the submitted body — the admin role's permissions must
    // stay the hardcoded all-true set, so the whole edit is refused regardless of what's sent.
    if (row.name === 'admin') {
      throw new BadRequestException({ error: "The administrator role's permissions cannot be changed" });
    }

    const fields: Record<string, string> = {};
    if (!body.name?.trim()) fields.name = 'Required';
    else {
      const dup = await this.db.get('SELECT 1 FROM roles WHERE name = ? AND id != ?', [body.name.trim(), id]);
      if (dup) fields.name = 'That role name already exists';
    }
    if (!body.label?.trim()) fields.label = 'Required';
    if (Object.keys(fields).length) throw new BadRequestException({ error: 'Please check the form', fields });

    const updated = await this.db.get<RoleRow>(
      'UPDATE roles SET name = ?, label = ?, description = ?, permissions = ? WHERE id = ? RETURNING *',
      [body.name.trim(), body.label.trim(), body.description ?? null, JSON.stringify(body.permissions || {}), id],
    );
    return this.toApi(updated!);
  }

  async remove(id: number) {
    const row = await this.db.get<RoleRow>('SELECT * FROM roles WHERE id = ?', [id]);
    if (!row) throw new NotFoundException('Role not found');
    if (row.is_system) throw new BadRequestException({ error: 'System roles cannot be deleted' });
    const userCount = await this.db.get<{ n: number }>('SELECT COUNT(*) n FROM users WHERE role_id = ?', [id]);
    if ((userCount?.n ?? 0) > 0) {
      throw new BadRequestException({ error: 'Cannot delete a role that is assigned to users' });
    }
    await this.db.run('DELETE FROM roles WHERE id = ?', [id]);
    return row;
  }
}
