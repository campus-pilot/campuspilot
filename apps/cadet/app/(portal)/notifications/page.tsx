import type { Metadata } from 'next';
import { Suspense } from 'react';
import { CadetNotificationsPage } from '@/components/notifications/cadet-notifications-page';

export const metadata: Metadata = { title: 'Notifications' };

export default function NotificationsPage() {
  return (
    <Suspense fallback={null}>
      <CadetNotificationsPage />
    </Suspense>
  );
}
