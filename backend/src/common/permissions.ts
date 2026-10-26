// Server-side mirror of frontend/lib/permissions.js — this is the authoritative copy; the
// frontend only hides what this would refuse anyway. GET /api/roles/resources serves RESOURCES
// below so the Roles & Permissions editor UI is driven entirely by this catalog.

export interface ResourceTask {
  id: string;
  label: string;
  right: string; // the right this task refines
}

export interface ResourceDef {
  id: string;
  name: string;
  description: string;
  tasks: ResourceTask[];
}

export const RIGHTS = [
  { id: 'view', label: 'View' },
  { id: 'create', label: 'Create' },
  { id: 'edit', label: 'Edit' },
  { id: 'delete', label: 'Delete' },
  { id: 'export', label: 'Export' },
];

export const RESOURCES: ResourceDef[] = [
  { id: 'purchases', name: 'Purchases', description: 'Purchase invoices', tasks: [
    { id: 'update_purchase', label: 'Edit a recorded purchase', right: 'edit' },
    { id: 'record_payment_p', label: 'Record or delete a credit payment', right: 'edit' },
  ] },
  { id: 'sales', name: 'Sales', description: 'Sales invoices', tasks: [] },
  { id: 'reconciliation', name: 'Bank reconciliation', description: 'Bank accounts and transactions', tasks: [
    { id: 'create_bank_tx', label: 'Add bank transactions', right: 'create' },
    { id: 'run_automatch', label: 'Run auto-match', right: 'edit' },
    { id: 'import_bank', label: 'Import a bank statement', right: 'create' },
  ] },
  { id: 'withholding', name: 'Withholding', description: 'Withholding summary', tasks: [] },
  { id: 'credit', name: 'Credit & payments', description: 'Payables / receivables aging', tasks: [] },
  { id: 'inventory', name: 'Inventory', description: 'Stock in/out, issues', tasks: [] },
  { id: 'vat', name: 'VAT declaration', description: 'Monthly VAT declaration', tasks: [] },
  { id: 'parties', name: 'Supplier / customer list', description: 'Parties and their profiles', tasks: [] },
  { id: 'products', name: 'Product list', description: 'Products and stock settings', tasks: [] },
  { id: 'reports', name: 'Reports', description: 'Dashboard and reports', tasks: [] },
  { id: 'settings', name: 'Company settings', description: 'Company profile and tax rules', tasks: [] },
  { id: 'lookups', name: 'Dropdown lists', description: 'Setting-sheet dropdown lists', tasks: [] },
  { id: 'users', name: 'Users', description: 'User accounts', tasks: [
    { id: 'update_user', label: 'Edit a user’s name/password/status', right: 'edit' },
    { id: 'assign_roles_companies', label: 'Assign roles and company access', right: 'edit' },
  ] },
  { id: 'roles', name: 'Roles & permissions', description: 'Role definitions', tasks: [] },
  { id: 'audit', name: 'Activity log', description: 'Audit trail', tasks: [] },
  { id: 'export', name: 'Export & backup', description: 'Excel exports and database backup', tasks: [] },
];

export type PermissionMap = Record<string, Record<string, boolean>>;

export interface PermissionUser {
  role: string;
  permissions?: PermissionMap;
  access_all_parties?: boolean;
  party_rights?: Record<string, Record<string, boolean>>;
}

export const isAdmin = (user?: PermissionUser | null) => user?.role === 'admin';

export function can(user: PermissionUser | null | undefined, resource: string, right: string, task?: string): boolean {
  if (!user) return false;
  if (isAdmin(user)) return true;
  const perms = user.permissions?.[resource];
  return !!perms?.[right] && (!task || perms[task] !== false);
}

export const canAny = (user: PermissionUser | null | undefined, ...grants: [string, string, string?][]) =>
  grants.some(([resource, right, task]) => can(user, resource, right, task));

export function canCompany(user: PermissionUser | null | undefined, partyId: number | null | undefined, right: string): boolean {
  if (!user) return false;
  if (isAdmin(user) || user.access_all_parties || partyId == null) return true;
  return !!user.party_rights?.[String(partyId)]?.[right];
}

export const DEFAULT_SEED_ROLES: { name: string; label: string; description: string; permissions: PermissionMap; is_system: boolean }[] = [
  {
    name: 'admin', label: 'Administrator', description: 'Full access to everything.', is_system: true,
    permissions: Object.fromEntries(RESOURCES.map((r) => [r.id, Object.fromEntries([...RIGHTS.map((x) => [x.id, true]), ...r.tasks.map((t) => [t.id, true])])])),
  },
  {
    name: 'viewer', label: 'Viewer', description: 'Read-only on the main day-to-day screens.', is_system: true,
    permissions: Object.fromEntries(['purchases', 'sales', 'withholding', 'credit', 'inventory', 'vat', 'parties', 'products', 'reports'].map((r) => [r, { view: true }])),
  },
];
