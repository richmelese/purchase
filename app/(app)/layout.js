import { cookies } from 'next/headers';
import Sidebar from '@/components/Sidebar';
import { LookupsProvider } from '@/components/lookups';
import { SessionProvider } from '@/components/session';
import Topbar from '@/components/Topbar';
import { sessionUser } from '@/lib/server/backend';

export default async function AppLayout({ children }) {
  const cookieStore = await cookies();
  const cookieHeader = cookieStore.toString();
  const user = await sessionUser(cookieHeader);

  return (
    <SessionProvider initialUser={user}>
      <LookupsProvider>
        <div className="shell">
          <Sidebar />
          <main className="main">
            <Topbar />
            {children}
          </main>
        </div>
      </LookupsProvider>
    </SessionProvider>
  );
}
