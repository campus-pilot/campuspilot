'use client';

import { ScreenHeader } from '../screen';
import { CadetDeviceNotifications } from './cadet-device-notifications';
import { CadetNotificationInbox } from './cadet-notifications';

/**
 * The inbox screen inside the portal frame, which already guards the
 * session and carries the school's install chrome.
 */
export function CadetNotificationsPage() {
  return (
    <>
      <ScreenHeader title="Notifications" />
      <CadetDeviceNotifications />
      <CadetNotificationInbox />
    </>
  );
}
