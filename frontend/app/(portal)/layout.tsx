import type { ReactNode } from 'react';
import { LookupsProvider } from '@/components/lookups';
import { PortalShell } from '@/components/portal';

export default function PortalLayout({ children }: { children: ReactNode }) {
  return (
    <LookupsProvider>
      <PortalShell>{children}</PortalShell>
    </LookupsProvider>
  );
}
