import { Suspense } from 'react';

import { CadetNotificationOpen } from '@/components/notifications/cadet-notification-open';

/**
 * Where a web push click lands (`public/sw.js`): turns the notification's
 * type and identifiers into the item's route and goes there.
 */
export default function NotificationOpenPage() {
  return (
    <Suspense fallback={null}>
      <CadetNotificationOpen />
    </Suspense>
  );
}
