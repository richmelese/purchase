import { DatabaseService } from '../db/database.service';
import type { AuthUser } from './auth.guard';

export type ActivityAction = 'create' | 'update' | 'delete' | 'other';

export interface ActivityLogDetails {
  before?: unknown;
  after?: unknown;
}

/** Returns a Promise — callers should `await` it so the log write finishes before the response does. */
export function logActivity(
  db: DatabaseService,
  user: AuthUser | undefined,
  action: ActivityAction,
  entity: string,
  entityId: string | number | null,
  summary: string,
  details?: ActivityLogDetails,
): Promise<unknown> {
  return db.run(
    'INSERT INTO activity_log (user_id, username, action, entity, entity_id, summary, before, after) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [
      user?.id ?? null,
      user?.username ?? null,
      action,
      entity,
      entityId == null ? null : String(entityId),
      summary,
      details?.before === undefined ? null : JSON.stringify(details.before),
      details?.after === undefined ? null : JSON.stringify(details.after),
    ],
  );
}

export const AUDIT_ENTITIES = [
  { id: 'purchases', label: 'Purchases' },
  { id: 'sales', label: 'Sales' },
  { id: 'products', label: 'Products' },
  { id: 'parties', label: 'Suppliers / customers' },
  { id: 'users', label: 'Users' },
  { id: 'roles', label: 'Roles' },
  { id: 'settings', label: 'Settings' },
  { id: 'lookups', label: 'Dropdown lists' },
  { id: 'payments', label: 'Payments' },
  { id: 'crv', label: 'CRV (cash receipts)' },
  { id: 'issues', label: 'Stock issues' },
  { id: 'reconciliation', label: 'Bank reconciliation' },
  { id: 'vat', label: 'VAT declaration' },
  { id: 'auth', label: 'Sign-in' },
];
