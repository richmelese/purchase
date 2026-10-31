# SQLite → Postgres migration (in progress)

The backend used to run on `node:sqlite` (synchronous). It now runs on Postgres via the `pg`
driver (asynchronous). The foundation is already converted and working — `src/db/database.service.ts`,
`src/db/schema.ts`, `src/common/session.ts`, `src/common/user-loader.ts`, `src/common/auth.guard.ts`,
`src/common/activity-log.ts`, and `src/modules/auth/*` all compile and have been smoke-tested
against a real Postgres instance. **Do not re-convert or edit those files.**

Your job: convert your assigned module file(s) from the old sync pattern to the new async one.
This is almost entirely mechanical — the business logic is already correct and does not need to
change. Run `npx tsc --noEmit` from `backend/` — every error in your file(s) is something this
guide tells you how to fix. When your file(s) compile clean AND you've smoke-tested your module's
endpoints against a real Postgres database, you're done.

## What changed in `DatabaseService` (read `src/db/database.service.ts` for the real thing)

- `db.get<T>(sql, params)`, `db.all<T>(sql, params)`, `db.run(sql, params)` now all return
  **Promises**. Every call site needs `await`, and every enclosing method needs `async`.
- SQL strings keep using `?` placeholders exactly as before — `DatabaseService` converts them to
  Postgres's `$1, $2, ...` internally. **Don't rewrite placeholders.**
- `SQL_NOW` is exported from `database.service.ts`: a SQL expression producing
  `'YYYY-MM-DD HH:MM:SS'` in UTC, identical to SQLite's old `datetime('now')`. Replace any inline
  `datetime('now')` in your SQL with `${SQL_NOW}` (template-literal interpolation of the SQL
  fragment, e.g. `` `UPDATE x SET updated_at = ${SQL_NOW} WHERE id = ?` ``).
- **No more `result.lastInsertRowid`.** Postgres doesn't have it. Instead, add `RETURNING id` to
  the `INSERT` statement and use `db.get()` instead of `db.run()`:
  ```ts
  // before
  const result = this.db.run('INSERT INTO foo (a) VALUES (?)', [a]);
  const id = Number(result.lastInsertRowid);
  // after
  const row = await this.db.get<{ id: number }>('INSERT INTO foo (a) VALUES (?) RETURNING id', [a]);
  const id = row!.id;
  ```
- **Transactions**: `db.transaction(fn)` now takes an **async** callback that receives a
  transaction-scoped executor (call it `trx`) — use `trx.get/all/run`, NOT `this.db.get/all/run`,
  for every statement inside the callback, or they won't actually be part of the transaction:
  ```ts
  // before
  this.db.transaction(() => {
    this.db.run('DELETE FROM a WHERE id = ?', [id]);
    this.db.run('DELETE FROM b WHERE id = ?', [id]);
  });
  // after
  await this.db.transaction(async (trx) => {
    await trx.run('DELETE FROM a WHERE id = ?', [id]);
    await trx.run('DELETE FROM b WHERE id = ?', [id]);
  });
  ```
- `INSERT OR IGNORE` → `INSERT ... ON CONFLICT (<unique columns>) DO NOTHING` (check `schema.ts`
  for the relevant unique index/constraint to name as the conflict target).
- `logActivity(...)` now returns a Promise — `await` it.
- Guards (`AuthGuard.canActivate`) and anything called from one are now `async` — this is already
  done for the shared guard; if your module has its own guard touching the DB, make it
  `async canActivate(...): Promise<boolean>` the same way (Nest supports async guards natively).
- Nest controllers do **not** need an `async` keyword just because the service method they call
  became async — `return this.service.method(...)` already works when `method` returns a Promise
  (Nest awaits whatever a handler returns). Only add `async`/`await` in a controller method if it
  does more than one thing with the result (e.g. calls `logActivity` after).

## Mechanical conversion checklist (apply per file)

1. Add `async` to every method that calls `this.db.*` (directly or transitively through a private
   helper in the same file — convert those helpers too, and `await` them at their call sites).
2. Add `await` before every `this.db.get(...)`, `this.db.all(...)`, `this.db.run(...)`,
   `this.db.exec(...)` call.
3. Fix every `lastInsertRowid` site per the pattern above.
4. Fix every `.transaction(() => {...})` site per the pattern above (search your file for
   `.transaction(`).
5. Replace any inline `datetime('now')` with `` ${SQL_NOW} `` (import `SQL_NOW` from
   `'../../db/database.service'`).
6. Replace any `INSERT OR IGNORE` with the `ON CONFLICT ... DO NOTHING` form.
7. If a helper function in your file takes the db row result of another now-async function as a
   plain value (e.g. `for (const l of someRows)` where `someRows` used to be a sync array), make
   sure that line now does `for (const l of await someRows)` or (better) hoist the `await` to
   where `someRows` is assigned.
8. Run `npx tsc --noEmit` from `backend/` and fix every remaining error in your file(s) — they are
   all one of the patterns above.

## Testing against real Postgres

A dev Postgres is already running in Docker (`purchase-postgres`, port 5437, user/db `psm`).
**Don't test against that shared database** — other agents are converting their modules against
it at the same time and you'll collide on unique usernames/TINs/etc. Create your own database on
the same server instead:

```bash
docker exec purchase-postgres createdb -U psm psm_test_<yourmodule>
```

Then boot the backend against it for a quick smoke test (from `backend/`):

```bash
DATABASE_URL=postgres://psm:psm@localhost:5437/psm_test_<yourmodule> PORT=5000 HOST=127.0.0.1 node -r ts-node/register src/main.ts
```

Sign up (`POST /api/auth/status` then `/api/auth/signup` — first signup becomes admin), log in,
grab the session cookie, and exercise your module's endpoints with curl. The auth module is
already fully converted and working, so this will Just Work for creating your test user.

When done, you can drop your test database: `docker exec purchase-postgres dropdb -U psm psm_test_<yourmodule>`.

## Special case: `GET /api/backup` (export module only)

The old implementation streamed the raw SQLite file — that has no Postgres equivalent and the
`PRAGMA wal_checkpoint(FULL)` call in `export.controller.ts` must be removed. Replace the backup
with an application-level dump: query every table (see `schema.ts` for the full list) and write a
single `.sql` file of `INSERT INTO <table> (...) VALUES (...);` statements per row (in an order
that respects foreign keys — roughly: roles, parties, users, user_party_rights, sessions excluded
(not worth backing up), products, invoices, invoice_lines, payments, stock_issues, settings,
lookup_values, vat_adjustments, bank_accounts, bank_transactions, activity_log). Stream that text
as the download (`Content-Type: application/sql`, filename `psm-backup-<date>.sql`) instead of a
binary `.db` file. Keep the admin-only gate.

## Do not touch

- `src/db/database.service.ts`, `src/db/schema.ts` — already converted, finished.
- `src/common/session.ts`, `src/common/user-loader.ts`, `src/common/auth.guard.ts`,
  `src/common/activity-log.ts`, `src/modules/auth/*` — already converted, finished.
- Any other module's files outside your assignment.
- `src/app.module.ts` — already fully wired, no changes needed for this migration.
