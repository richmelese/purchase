import { common } from './common';
import { shell } from './shell';
import { invoices } from './invoices';
import { masterdata } from './masterdata';
import { settings } from './settings';
import { reconciliation } from './reconciliation';

// Area files first, common last: the shared glossary wins if a key is defined twice.
export const AM: Record<string, string> = { ...shell, ...invoices, ...masterdata, ...settings, ...reconciliation, ...common };
