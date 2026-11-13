import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';

export interface AuditQuery {
  limit?: string | number;
  entity?: string;
  q?: string;
}

export interface AuditRow {
  id: number;
  at: string;
  username: string | null;
  action: 'create' | 'update' | 'delete' | 'other';
  entity: string;
  summary: string;
  before: unknown;
  after: unknown;
}

interface AuditRowRaw {
  id: number;
  at: string;
  username: string | null;
  action: 'create' | 'update' | 'delete' | 'other';
  entity: string;
  summary: string;
  before: string | null;
  after: string | null;
}

function parseJson(raw: string | null): unknown {
  if (raw == null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 2000;

@Injectable()
export class AuditService {
  constructor(private readonly db: DatabaseService) {}

  async query({ limit, entity, q }: AuditQuery): Promise<AuditRow[]> {
    let n = Number(limit);
    if (!Number.isFinite(n) || n <= 0) n = DEFAULT_LIMIT;
    n = Math.min(Math.floor(n), MAX_LIMIT);

    const where: string[] = [];
    const params: unknown[] = [];
    if (entity) {
      where.push('entity = ?');
      params.push(entity);
    }
    if (q) {
      where.push('(summary LIKE ? OR username LIKE ?)');
      params.push(`%${q}%`, `%${q}%`);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    // created_at is already produced by sqlite's datetime('now') in exactly 'YYYY-MM-DD HH:MM:SS'
    // format — alias it as `at` rather than reformatting.
    const rows = await this.db.all<AuditRowRaw>(
      `SELECT id, created_at AS at, username, action, entity, summary, before, after FROM activity_log ${whereSql} ORDER BY id DESC LIMIT ?`,
      [...params, n],
    );
    return rows.map((r) => ({ ...r, before: parseJson(r.before), after: parseJson(r.after) }));
  }
}
