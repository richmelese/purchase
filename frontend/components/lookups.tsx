'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from '@/lib/api';
import { useToast } from './ui';
import { useT } from '@/lib/i18n';

// Every dropdown list comes from GET /lookups (the Setting sheet); there is no local copy to drift.
const NUMBERED = ['unit'];

export interface LookupValue {
  value: string;
  label: string;
  locked?: boolean;
}

export interface LookupListMeta {
  list: string;
  title: string;
  sheet?: string | null;
  editable?: boolean;
  numeric?: boolean;
}

interface LookupsState {
  lists: LookupListMeta[];
  values: Record<string, LookupValue[]>;
  loaded: boolean;
}

interface LookupsContextValue extends LookupsState {
  reload: () => void;
  set: (values: Record<string, LookupValue[]>) => void;
  options: (list: string) => { value: string; label: string }[];
  unitLabel: (v: unknown) => string;
  labelOf: (list: string, v: unknown) => string;
}

const Ctx = createContext<LookupsContextValue | null>(null);

export function LookupsProvider({ children }: { children: ReactNode }) {
  const toast = useToast();
  const { t } = useT();
  const [state, setState] = useState<LookupsState>({ lists: [], values: {}, loaded: false });
  const load = useCallback(() => api.get<{ lists: LookupListMeta[]; values: Record<string, LookupValue[]> }>('/lookups')
    .then((r) => setState({ lists: r.lists, values: r.values, loaded: true }))
    .catch((e) => toast(t('Dropdown lists could not be loaded: {error}', { error: e.message }), 'error')), [toast, t]);
  useEffect(() => { load(); }, [load]);

  const value = useMemo<LookupsContextValue>(() => {
    const units = Object.fromEntries((state.values.unit || []).map((u) => [+u.value, u.label]));
    // Labels come from the server in English; show them in the chosen language (values stay unchanged).
    return {
      ...state,
      reload: load,
      set: (values) => setState((s) => ({ ...s, values })),
      /** Options for <Select>; numbered lists show their ID like the workbook ("7 – PCS", "3 – Taxable local…"). */
      options: (list) => (NUMBERED.includes(list)
        ? (state.values[list] || []).map((u) => ({ value: u.value, label: `${u.value} – ${t(u.label)}` }))
        : (state.values[list] || []).map((u) => ({ ...u, label: t(u.label) }))),
      unitLabel: (v) => units[+(v as any)] || '',
      labelOf: (list, v) => {
        const o = (state.values[list] || []).find((x) => String(x.value) === String(v));
        if (!o) return t(String(v ?? ''));
        return NUMBERED.includes(list) ? `${o.value} – ${t(o.label)}` : t(o.label);
      },
    };
  }, [state, load, t]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useLookups = (): LookupsContextValue => useContext(Ctx)!;
