'use client';

// Company portal: what a supplier / customer sees when it signs in with its own company account.
import { createContext, useContext } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { Loading, useFetch } from './ui';
import Icon from './icons';

const Ctx = createContext(null);
export const usePortal = () => useContext(Ctx);

export function PortalShell({ children }) {
  const { data, error } = useFetch('/portal/company');
  const signOut = async () => {
    await api.post('/auth/logout').catch(() => {});
    window.location.href = '/login';
  };
  return (
    <div className="portal">
      <header className="portal-top no-print">
        <Link href="/portal" className="portal-brand">
          <span className="portal-logo"><Icon name="suppliers" size={20} /></span>
          <span>
            <strong>{data?.company.name || 'Company portal'}</strong>
            <small>{data ? `Company portal · ${data.issuer.company_name}` : ' '}</small>
          </span>
        </Link>
        <div className="portal-user">
          {data && <span className="small muted">Signed in as <b>{data.account.username}</b></span>}
          <Link className="btn btn-sm" href="/change-password"><Icon name="key" size={15} /> Change password</Link>
          <button className="btn btn-sm" onClick={signOut}><Icon name="logout" size={15} /> Sign out</button>
        </div>
      </header>
      <main className="portal-main">
        {!data ? <Loading error={error} /> : <Ctx.Provider value={data}>{children}</Ctx.Provider>}
      </main>
    </div>
  );
}
