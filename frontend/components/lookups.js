'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { useToast } from './ui';

// Every dropdown list comes from GET /lookups (the Setting sheet); there is no local copy to drift.
const NUMBERED = ['unit'];

const Ctx = createContext(null);

export function LookupsProvider({ children }) {
  const toast = useToast();
  const [state, setState] = useState({ lists: [], values: {}, loaded: false });
  const load = useCallback(() => api.get('/lookups')
    .then((r) => setState({ lists: r.lists, values: r.values, loaded: true }))
    .catch((e) => toast(`Dropdown lists could not be loaded: ${e.message}`, 'error')), [toast]);
  useEffect(() => { load(); }, [load]);

  const value = useMemo(() => {
    const units = Object.fromEntries((state.values.unit || []).map((u) => [+u.value, u.label]));
    return {
      ...state,
      reload: load,
      set: (values) => setState((s) => ({ ...s, values })),
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
