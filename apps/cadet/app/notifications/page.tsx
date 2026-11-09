import type { Metadata } from 'next';
import { Suspense } from 'react';
import { CadetNotificationsPage } from '@/components/notifications/cadet-notifications-page';
import { PortalShell } from '@/components/portal-shell';

export const metadata: Metadata = { title: 'Notifications' };

export default function NotificationsPage() {
  return (
    <PortalShell width="wide">
      <Suspense fallback={null}>
        <CadetNotificationsPage />
      </Suspense>
    </PortalShell>
  );
}
