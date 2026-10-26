import { DatabaseService } from '../db/database.service';
import type { AuthUser } from './auth.guard';

export type ActivityAction = 'create' | 'update' | 'delete' | 'other';

export function logActivity(
  db: DatabaseService,
  user: AuthUser | undefined,
  action: ActivityAction,
  entity: string,
  entityId: string | number | null,
  summary: string,
) {
  db.run(
    'INSERT INTO activity_log (user_id, username, action, entity, entity_id, summary) VALUES (?, ?, ?, ?, ?, ?)',
    [user?.id ?? null, user?.username ?? null, action, entity, entityId == null ? null : String(entityId), summary],
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
  { id: 'issues', label: 'Stock issues' },
  { id: 'reconciliation', label: 'Bank reconciliation' },
  { id: 'vat', label: 'VAT declaration' },
  { id: 'auth', label: 'Sign-in' },
];
