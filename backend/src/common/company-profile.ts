// Shared CompanyProfile JSON shape ("Other Detail Registration Format", Form 00001) — used
// identically for the company's own profile (`settings.profile`, see modules/settings) and for
// each Party's own profile (`parties.profile`, see modules/parties). Keep both modules in sync by
// importing `defaultCompanyProfile`/`companyProfileOptions` from here instead of redefining the
// shape inline. See docs/API_CONTRACT.md "Company Profile JSON shape" for the full spec.

export interface ContactEntry {
  name: string;
  phone: string;
  phone2: string;
  email: string;
  remark: string;
  title?: string; // only present on the `other` role
}

export interface LicenseItem {
  license_no: string;
  field: string;
  status: string;
  registration_date: string | null;
}

export interface BankItem {
  bank_name: string;
  account_number: string;
  opened: string | null;
  closed: string | null;
  branch: string;
}

export interface ReceiptItem {
  type: string;
  requirement: string;
  print_status: string;
}

export interface ReceiptStatusItem {
  type: string;
  current: string;
  collection: string;
  old_void: string;
}

export interface CompanyProfile {
  general: {
    round: number;
    company_name: string;
    tin_copy: boolean;
    vat_copy: boolean;
    tin: string;
    tin_issue_date: string | null;
    vat_registered: boolean | null;
    vat_number: string;
    vat_registration_date: string | null;
    tax_center: string;
    commercial_reg_no: string;
    commercial_reg_date: string | null;
    license_count: number;
    first_license_date: string | null;
    business_type: 'PLC' | 'SOL' | 'SC' | 'Other';
    business_type_other: string;
  };
  address: {
    round: number;
    region: string;
    zone: string;
    woreda: string;
    house_no: string;
    location: string;
    email: string;
    phone: string;
    phone2: string;
  };
  contacts: {
    round: number;
    [roleKey: string]: ContactEntry | number;
  };
  licenses: {
    round: number;
    commercial_certificate: boolean;
    license_total: number;
    license_collected: number;
    items: LicenseItem[];
  };
  banks: {
    round: number;
    items: BankItem[];
  };
  receipts: {
    round: number;
    items: ReceiptItem[];
  };
  receipt_status: {
    round: number;
    mor_old_ordered: number;
    mor_old_collected: number;
    mor_new_ordered: number;
    mor_new_collected: number;
    items: ReceiptStatusItem[];
  };
  updated_at?: string | null;
  updated_by?: string | null;
}

export interface CompanyProfileOptions {
  rounds: number[];
  business_types: string[];
  contact_roles: { key: string; label: string }[];
  max_licenses: number;
  max_banks: number;
  choices: {
    requirement: string[];
    print_status: string[];
    current: string[];
    collection: string[];
    old_void: string[];
  };
}

/** Roster of contact roles rendered under `contacts.*` — `other` is the only one with a `title` field. */
export const CONTACT_ROLES: { key: string; label: string }[] = [
  { key: 'owner', label: 'Owner' },
  { key: 'manager', label: 'General Manager' },
  { key: 'accountant', label: 'Accountant' },
  { key: 'other', label: 'Other' },
];

/** Fixed receipt-type roster shared by `receipts.items` and `receipt_status.items` (keyed by `type`). */
export const RECEIPT_TYPE_ROSTER: string[] = [
  'Sales Invoice',
  'Cash Sales Receipt',
  'Credit Sales Invoice',
  'Payment Voucher',
  'Goods Received Note',
];

const MAX_LICENSES = 5;
const MAX_BANKS = 5;

/** Server-computed catalog sent alongside every profile GET — NOT persisted, free to define sensibly. */
export function companyProfileOptions(): CompanyProfileOptions {
  return {
    rounds: [1, 2, 3],
    business_types: ['PLC', 'SOL', 'SC', 'Other'],
    contact_roles: CONTACT_ROLES,
    max_licenses: MAX_LICENSES,
    max_banks: MAX_BANKS,
    choices: {
      requirement: ['Required', 'Not required'],
      print_status: ['Printed', 'Not printed'],
      current: ['Yes', 'No'],
      collection: ['Yes', 'No'],
      old_void: ['Voided', 'Not voided'],
    },
  };
}

/** Blank CompanyProfile with every section/roster pre-populated — the starting point for a new party or a fresh company settings row. */
export function defaultCompanyProfile(companyName = ''): CompanyProfile {
  const contacts: CompanyProfile['contacts'] = { round: 1 };
  for (const role of CONTACT_ROLES) {
    contacts[role.key] = {
      name: '', phone: '', phone2: '', email: '', remark: '',
      ...(role.key === 'other' ? { title: '' } : {}),
    };
  }
  return {
    general: {
      round: 1, company_name: companyName, tin_copy: false, vat_copy: false, tin: '',
      tin_issue_date: null, vat_registered: null, vat_number: '', vat_registration_date: null,
      tax_center: '', commercial_reg_no: '', commercial_reg_date: null, license_count: 0,
      first_license_date: null, business_type: 'PLC', business_type_other: '',
    },
    address: { round: 1, region: '', zone: '', woreda: '', house_no: '', location: '', email: '', phone: '', phone2: '' },
    contacts,
    licenses: { round: 1, commercial_certificate: false, license_total: 0, license_collected: 0, items: [] },
    banks: { round: 1, items: [] },
    receipts: { round: 1, items: RECEIPT_TYPE_ROSTER.map((type) => ({ type, requirement: '', print_status: '' })) },
    receipt_status: {
      round: 1, mor_old_ordered: 0, mor_old_collected: 0, mor_new_ordered: 0, mor_new_collected: 0,
      items: RECEIPT_TYPE_ROSTER.map((type) => ({ type, current: '', collection: '', old_void: '' })),
    },
    updated_at: null,
    updated_by: null,
  };
}

/** Merges a persisted (possibly partial/stale) profile JSON onto the current default shape, so new fields added later always appear. */
export function mergeCompanyProfile(stored: Partial<CompanyProfile> | null | undefined, companyName = ''): CompanyProfile {
  const base = defaultCompanyProfile(companyName);
  if (!stored || typeof stored !== 'object') return base;
  return {
    general: { ...base.general, ...(stored.general || {}) },
    address: { ...base.address, ...(stored.address || {}) },
    contacts: { ...base.contacts, ...(stored.contacts || {}) },
    licenses: { ...base.licenses, ...(stored.licenses || {}), items: (stored.licenses?.items as LicenseItem[]) ?? base.licenses.items },
    banks: { ...base.banks, ...(stored.banks || {}), items: (stored.banks?.items as BankItem[]) ?? base.banks.items },
    receipts: { ...base.receipts, ...(stored.receipts || {}), items: (stored.receipts?.items as ReceiptItem[]) ?? base.receipts.items },
    receipt_status: {
      ...base.receipt_status, ...(stored.receipt_status || {}),
      items: (stored.receipt_status?.items as ReceiptStatusItem[]) ?? base.receipt_status.items,
    },
    updated_at: stored.updated_at ?? null,
    updated_by: stored.updated_by ?? null,
  };
}
