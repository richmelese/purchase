'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { can as canFor, canAny as canAnyFor, canCompany as canCompanyFor } from '@/lib/permissions';

const Ctx = createContext({ user: null, logout: () => {}, can: () => false, canAny: () => false });

export function SessionProvider({ children, initialUser = null }) {
  const [user, setUser] = useState(initialUser);
  useEffect(() => { api.get('/auth/me').then(setUser).catch(() => {}); }, []);
  const logout = useCallback(async () => {
    await api.post('/auth/logout').catch(() => {});
    window.location.href = '/login';
  }, []);
  const value = {
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

export const useSession = () => useContext(Ctx);
