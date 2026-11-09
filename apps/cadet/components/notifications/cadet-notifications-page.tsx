'use client';

import Link from 'next/link';
import { redirect } from 'next/navigation';

import { authClient } from '@/lib/auth-client';
import { CadetSchoolChrome } from '../cadet-school-chrome';
import { CadetDeviceNotifications } from './cadet-device-notifications';
import { CadetNotificationInbox } from './cadet-notifications';

/** Session-guarded inbox page body, like the portal home. */
export function CadetNotificationsPage() {
  const { data: session, isPending } = authClient.useSession();
  if (isPending) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!session) redirect('/sign-in');
  return (
    <div className="flex flex-col gap-4">
      <CadetSchoolChrome />
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Notifications</h1>
        <Link href="/" className="text-sm text-muted-foreground underline-offset-4 hover:underline">
          Home
        </Link>
      </div>
      <CadetDeviceNotifications />
      <CadetNotificationInbox />
    </div>
  );
}
