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
}

const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 2000;

@Injectable()
export class AuditService {
  constructor(private readonly db: DatabaseService) {}

  query({ limit, entity, q }: AuditQuery): AuditRow[] {
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
    return this.db.all<AuditRow>(
      `SELECT id, created_at AS at, username, action, entity, summary FROM activity_log ${whereSql} ORDER BY id DESC LIMIT ?`,
      [...params, n],
    );
  }
}
