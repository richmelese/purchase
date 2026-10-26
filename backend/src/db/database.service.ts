import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { DatabaseSync, type StatementSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { SCHEMA_SQL } from './schema';
import { DEFAULT_SEED_ROLES } from '../common/permissions';

/**
 * Thin wrapper around node's built-in `node:sqlite` (DatabaseSync) — no native dependency,
 * matching the project's "SQLite built into Node.js" design. All access is synchronous,
 * which is fine for a single-process, file-backed local app.
 */
@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private db!: DatabaseSync;
  private readonly statementCache = new Map<string, StatementSync>();

  onModuleInit() {
    const path = resolve(process.env.DATABASE_PATH || 'data/psm.db');
    mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.db.exec(SCHEMA_SQL);
    this.seedRoles();
    this.seedSettings();
  }

  private seedRoles() {
    const insert = this.statement('INSERT OR IGNORE INTO roles (name, label, description, permissions, is_system) VALUES (?, ?, ?, ?, ?)');
    for (const role of DEFAULT_SEED_ROLES) {
      insert.run(role.name, role.label, role.description, JSON.stringify(role.permissions), role.is_system ? 1 : 0);
    }
  }

  /** Singleton settings row (id=1) — vat_rate/wh_rate defaults every tax-calculation module reads. */
  private seedSettings() {
    this.db.exec("INSERT OR IGNORE INTO settings (id) VALUES (1)");
  }

  onModuleDestroy() {
    this.db?.close();
  }

  private statement(sql: string): StatementSync {
    let stmt = this.statementCache.get(sql);
    if (!stmt) {
      stmt = this.db.prepare(sql);
      this.statementCache.set(sql, stmt);
    }
    return stmt;
  }

  get<T = any>(sql: string, params: Record<string, unknown> | unknown[] = []): T | undefined {
    const stmt = this.statement(sql);
    return (Array.isArray(params) ? stmt.get(...(params as any[])) : stmt.get(params as any)) as T | undefined;
  }

  all<T = any>(sql: string, params: Record<string, unknown> | unknown[] = []): T[] {
    const stmt = this.statement(sql);
    return (Array.isArray(params) ? stmt.all(...(params as any[])) : stmt.all(params as any)) as T[];
  }

  run(sql: string, params: Record<string, unknown> | unknown[] = []) {
    const stmt = this.statement(sql);
    return Array.isArray(params) ? stmt.run(...(params as any[])) : stmt.run(params as any);
  }

  exec(sql: string) {
    this.db.exec(sql);
  }

  /** Runs `fn` inside a BEGIN/COMMIT, rolling back on throw. */
  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }
}
