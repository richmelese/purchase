// Role permissions on the client: which menu items, pages and buttons a user gets.
// The API enforces the same rules (purchase-backend/src/common/permissions.ts); this only hides
// what the server would refuse anyway.

export const isAdmin = (user) => user?.role === 'admin';

/** `task` (optional): a task of the role editor, e.g. can(u, 'purchases', 'edit', 'record_payment_p'). */
export function can(user, resource, right, task) {
  if (!user) return false;
  if (isAdmin(user)) return true;
  const perms = user.permissions?.[resource];
  return !!perms?.[right] && (!task || perms[task] !== false);
}

export const canAny = (user, ...grants) => grants.some(([resource, right, task]) => can(user, resource, right, task));

// Purchases split "edit" into two role-editor tasks (same rule as invoices.controller.ts).
/** Changing an invoice: editing it, its report status or withholding. */
export const updateGrant = (kind) => (kind === 'P' ? ['purchases', 'edit', 'update_purchase'] : ['sales', 'edit']);
/** Recording or deleting a credit payment on an invoice. */
export const paymentGrant = (kind) => (kind === 'P' ? ['purchases', 'edit', 'record_payment_p'] : ['sales', 'edit']);

/** Settings tabs and what each needs. */
export const SETTINGS_TABS = [
  { id: 'company', label: 'Company profile & tax rules', grants: [['settings', 'view']] },
  { id: 'lists', label: 'Dropdown lists (Setting)', grants: [['lookups', 'view'], ['lookups', 'edit']] },
  { id: 'users', label: 'Users', grants: [['users', 'view']] },
  { id: 'roles', label: 'Roles & Permissions', grants: [['roles', 'view']] },
  { id: 'activity', label: 'Activity log', grants: [['audit', 'view']] },
  { id: 'export', label: 'Export & backup', grants: [['export', 'view'], ['export', 'export']] },
];
export const settingsTabsFor = (user) => SETTINGS_TABS.filter((t) => canAny(user, ...t.grants));

// Page → required grants (any one is enough). First matching prefix wins.
const PAGES = [
  [/^\/purchases\/new$/, [['purchases', 'create']]],
  [/^\/purchases\/[^/]+\/edit$/, [updateGrant('P')]],
  [/^\/purchases(\/|$)/, [['purchases', 'view']]],
  [/^\/sales\/new$/, [['sales', 'create']]],
  [/^\/sales\/[^/]+\/edit$/, [['sales', 'edit']]],
  [/^\/sales(\/|$)/, [['sales', 'view']]],
  [/^\/reconciliation(\/|$)/, [['reconciliation', 'view']]],
  [/^\/withholding(\/|$)/, [['withholding', 'view']]],
  [/^\/credit(\/|$)/, [['credit', 'view']]],
  [/^\/inventory(\/|$)/, [['inventory', 'view']]],
  [/^\/vat(\/|$)/, [['vat', 'view']]],
  [/^\/parties(\/|$)/, [['parties', 'view']]],
  [/^\/products(\/|$)/, [['products', 'view']]],
  [/^\/reports(\/|$)/, [['reports', 'view']]],
  [/^\/admin(\/|$)/, [['users', 'view']]],
];

/** May the user open this page? (`tab` = the ?tab= of /settings) */
export function canOpenPage(user, pathname, tab) {
  if (isAdmin(user)) return true;
  if (pathname === '/settings') {
    const tabs = settingsTabsFor(user);
    return tab ? tabs.some((t) => t.id === tab) : tabs.length > 0;
  }
  const rule = PAGES.find(([re]) => re.test(pathname));
  return !rule || canAny(user, ...rule[1]);
}

export const COMPANY_RIGHTS = [
  { id: 'view', label: 'View' },
  { id: 'create', label: 'Create' },
  { id: 'edit', label: 'Edit' },
  { id: 'delete', label: 'Delete' },
  { id: 'export', label: 'Export' },
];

/**
 * Right for records of one company (an invoice's party, a supplier): users with access to all
 * companies have every right; otherwise the rights given for that company when the user was set up.
 * Records without a company follow the role alone.
 */
export function canCompany(user, partyId, right) {
  if (!user) return false;
  if (isAdmin(user) || user.access_all_parties || partyId == null) return true;
  return !!user.party_rights?.[partyId]?.[right];
}

// Full navigation catalog: each item specifies its route, label, icon, and grouping
export const NAV = [
  { group: 'Overview' },
  { href: '/', label: 'Dashboard', icon: 'dashboard' },
  { href: '/reports', label: 'Reports', icon: 'reports' },
  { group: 'Transactions' },
  { href: '/purchases', label: 'Purchases', icon: 'purchases' },
  { href: '/sales', label: 'Sales', icon: 'sales' },
  { href: '/reconciliation', label: 'Bank Reconciliation', icon: 'bank' },
  { href: '/withholding', label: 'Withholding', icon: 'withholding' },
  { href: '/credit', label: 'Credit & Payments', icon: 'credit' },
  { group: 'Stock' },
  { href: '/inventory', label: 'Inventory', icon: 'inventory' },
  { group: 'Tax' },
  { href: '/vat', label: 'VAT Declaration', icon: 'vat' },
  { group: 'Master data' },
  { href: '/parties', label: 'Supplier List', icon: 'suppliers' },
  { href: '/products', label: 'Product List', icon: 'products' },
  { group: 'Administration' },
  { href: '/settings?tab=roles', label: 'Roles & Permissions', icon: 'shield' },
  { href: '/settings?tab=users', label: 'Users', icon: 'users' },
  { href: '/settings', label: 'Settings', icon: 'settings' },
];

/** Menu for this user: allowed items only, and no empty group headings. */
export function visibleNav(user) {
  if (!user) return NAV.filter((n) => n.href === '/');
  const allowed = NAV.filter((n) => {
    if (n.group) return true;
    const [path, query] = n.href.split('?');
    const tab = new URLSearchParams(query || '').get('tab');
    if (path === '/settings' && !tab) return settingsTabsFor(user).some((t) => !['users', 'roles'].includes(t.id));
    return canOpenPage(user, path, tab);
  });
  return allowed.filter((n, i) => !n.group || (allowed[i + 1] && !allowed[i + 1].group));
}
