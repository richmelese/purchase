'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from '@/lib/api';
import { can as canFor, canAny as canAnyFor, canCompany as canCompanyFor, type AppUser, type Grant } from '@/lib/permissions';

interface SessionContextValue {
  user: AppUser | null;
  logout: () => Promise<void>;
  isAdmin?: boolean;
  can: (resource: string, right: string, task?: string) => boolean;
  canAny: (...grants: Grant[]) => boolean;
  canFor: (resource: string, right: string, partyId?: number | null, task?: string) => boolean;
  canCompany: (partyId: number | null | undefined, right: string) => boolean;
}

const Ctx = createContext<SessionContextValue>({
  user: null, logout: async () => {}, can: () => false, canAny: () => false,
  canFor: () => false, canCompany: () => false,
});

export function SessionProvider({ children, initialUser = null }: { children: ReactNode; initialUser?: AppUser | null }) {
  const [user, setUser] = useState<AppUser | null>(initialUser);
  useEffect(() => { api.get<AppUser>('/auth/me').then(setUser).catch(() => {}); }, []);
  const logout = useCallback(async () => {
    await api.post('/auth/logout').catch(() => {});
    window.location.href = '/login';
  }, []);
  const value: SessionContextValue = {
    user,
    logout,
    isAdmin: user?.role === 'admin',
    /**
     * can('purchases', 'create') – what the user's role allows (false until the user is loaded).
     * An optional task narrows it: can('purchases', 'edit', 'record_payment_p').
     */
    can: (resource, right, task) => canFor(user, resource, right, task),
    canAny: (...grants) => canAnyFor(user, ...grants),
    /** canFor('sales', 'edit', inv.party_id[, task]) – role right AND the right for that company. */
    canFor: (resource, right, partyId, task) => canFor(user, resource, right, task) && canCompanyFor(user, partyId, right),
    /** canCompany(partyId, 'edit') – the right given for that company (true for all-company users). */
    canCompany: (partyId, right) => canCompanyFor(user, partyId, right),
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useSession = (): SessionContextValue => useContext(Ctx);
