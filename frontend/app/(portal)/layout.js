import { LookupsProvider } from '@/components/lookups';
import { PortalShell } from '@/components/portal';

export default function PortalLayout({ children }) {
  return (
    <LookupsProvider>
      <PortalShell>{children}</PortalShell>
    </LookupsProvider>
  );
}
