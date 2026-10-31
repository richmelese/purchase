import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Pool, type PoolClient, types } from 'pg';
import { SCHEMA_SQL } from './schema';
import { DEFAULT_SEED_ROLES } from '../common/permissions';

// `pg` returns BIGINT (the type of COUNT(*)) as a string by default, to avoid precision loss on
// huge counts — unlike node:sqlite, which always gave back a plain JS number. Every COUNT(*) in
// this codebase (invoice_count, user_count, tx_count, ...) relies on getting a real number back
// (comparisons, `?? 0` fallbacks, JSON responses the frontend expects as numbers), so parse OID 20
// (int8/bigint) as an integer globally rather than hunting down every call site.
types.setTypeParser(20, (val: string) => parseInt(val, 10));

/** '?' positional placeholders (as written everywhere in this codebase) -> Postgres '$1 $2 ...'. */
function toPgQuery(sql: string): string {
  let n = 0;
  return sql.replace(/\?/g, () => `$${++n}`);
}

/**
 * Shared query surface for both the pool (outside a transaction) and a checked-out client
 * (inside one) — same `get`/`all`/`run` shape the whole app already calls, just async now.
 */
class Executor {
  constructor(private readonly client: Pool | PoolClient) {}

  async get<T = any>(sql: string, params: unknown[] = []): Promise<T | undefined> {
    const res = await this.client.query(toPgQuery(sql), params);
    return res.rows[0] as T | undefined;
  }

  async all<T = any>(sql: string, params: unknown[] = []): Promise<T[]> {
    const res = await this.client.query(toPgQuery(sql), params);
    return res.rows as T[];
  }

  async run(sql: string, params: unknown[] = []): Promise<{ rowCount: number }> {
    const res = await this.client.query(toPgQuery(sql), params);
    return { rowCount: res.rowCount ?? 0 };
  }

  async exec(sql: string): Promise<void> {
    await this.client.query(sql);
  }
}

/** Produces 'YYYY-MM-DD HH:MM:SS' in UTC — identical to SQLite's old `datetime('now')` — so
 * every existing string-compare/sort against these columns keeps working unchanged. */
export const SQL_NOW = "to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')";

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private pool!: Pool;
  private root!: Executor;

  async onModuleInit() {
    const connectionString = process.env.DATABASE_URL || 'postgres://psm:psm@localhost:5437/psm';
    this.pool = new Pool({ connectionString });
    this.root = new Executor(this.pool);
    await this.root.exec(SCHEMA_SQL);
    await this.seedRoles();
    await this.seedSettings();
  }

  private async seedRoles() {
    for (const role of DEFAULT_SEED_ROLES) {
      await this.root.run(
        `INSERT INTO roles (name, label, description, permissions, is_system) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (name) DO NOTHING`,
        [role.name, role.label, role.description, JSON.stringify(role.permissions), role.is_system ? 1 : 0],
      );
    }
  }

  /** Singleton settings row (id=1) — vat_rate/wh_rate defaults every tax-calculation module reads. */
  private async seedSettings() {
    await this.root.exec('INSERT INTO settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING');
  }

  async onModuleDestroy() {
    await this.pool?.end();
  }

  get<T = any>(sql: string, params: unknown[] = []): Promise<T | undefined> {
    return this.root.get<T>(sql, params);
  }

  all<T = any>(sql: string, params: unknown[] = []): Promise<T[]> {
    return this.root.all<T>(sql, params);
  }

  run(sql: string, params: unknown[] = []): Promise<{ rowCount: number }> {
    return this.root.run(sql, params);
  }

  exec(sql: string): Promise<void> {
    return this.root.exec(sql);
  }

  /**
   * Runs `fn` against a single checked-out connection inside BEGIN/COMMIT, rolling back on
   * throw. `fn` receives a transaction-scoped executor (`get`/`all`/`run`/`exec`) — use THAT
   * inside the callback, not `this.db`, so every statement actually runs on the same connection.
   */
  async transaction<T>(fn: (trx: Executor) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    const trx = new Executor(client);
    try {
      await client.query('BEGIN');
      const result = await fn(trx);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}

export type { Executor };
