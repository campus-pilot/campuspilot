import { Suspense } from 'react';
import { CadetHome } from '@/components/cadet-home';
import { PortalShell } from '@/components/portal-shell';

export default function HomePage() {
  return (
    <PortalShell>
      <Suspense fallback={null}>
        <CadetHome />
      </Suspense>
    </PortalShell>
  );
}
