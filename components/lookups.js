'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import {
  UNITS, PAYMENT_TYPES, RECEIPT_TYPES, TRANSACTION_TYPES, REPORT_STATUSES, WH_RECEIPT_TYPES,
  PURCHASE_TYPES, SALES_TYPES, VAT_CATEGORIES, CALENDAR_TYPES,
} from '@/lib/shared/calc';

// Used until the server lists arrive (and if they fail to load).
const FALLBACK = {
  payment_type: PAYMENT_TYPES.map((v) => ({ value: v, label: v })),
  vat_category: VAT_CATEGORIES,
  calendar_type: CALENDAR_TYPES,
  purchase_type: PURCHASE_TYPES.map((t) => ({ value: t.value, label: `${t.label} [${t.line}]` })),
  sales_type: SALES_TYPES.map((t) => ({ value: t.value, label: `${t.label} [${t.line}]` })),
  receipt_type: RECEIPT_TYPES.map((v) => ({ value: v, label: v })),
  unit: UNITS,
  wh_receipt_type: WH_RECEIPT_TYPES.map((v) => ({ value: v, label: v })),
  transaction_type: TRANSACTION_TYPES.map((v) => ({ value: v, label: v })),
  report_status: REPORT_STATUSES.map((v) => ({ value: v, label: v })),
  product_category: [],
  department: [],
  payment_method: ['Bank transfer', 'Cash', 'Cheque', 'Mobile money'].map((v) => ({ value: v, label: v })),
};

const NUMBERED = ['unit'];

const Ctx = createContext(null);

export function LookupsProvider({ children }) {
  const [state, setState] = useState({ lists: [], values: FALLBACK });
  const load = useCallback(() => api.get('/lookups').then((r) => setState({ lists: r.lists, values: { ...FALLBACK, ...r.values } })).catch(() => {}), []);
  useEffect(() => { load(); }, [load]);

  const value = useMemo(() => {
    const units = Object.fromEntries(state.values.unit.map((u) => [+u.value, u.label]));
    return {
      ...state,
      reload: load,
      set: (values) => setState((s) => ({ ...s, values: { ...FALLBACK, ...values } })),
      /** Options for <Select>; numbered lists show their ID like the workbook ("7 – PCS", "3 – Taxable local…"). */
      options: (list) => (NUMBERED.includes(list)
        ? (state.values[list] || []).map((u) => ({ value: u.value, label: `${u.value} – ${u.label}` }))
        : state.values[list] || []),
      unitLabel: (v) => units[+v] || '',
      labelOf: (list, v) => {
        const o = (state.values[list] || []).find((x) => String(x.value) === String(v));
        if (!o) return v;
        return NUMBERED.includes(list) ? `${o.value} – ${o.label}` : o.label;
      },
    };
  }, [state, load]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useLookups = () => useContext(Ctx);
