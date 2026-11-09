'use client';

import { Button } from '@campuspilot/ui/components/button';
import { useMutation, useQuery } from '@tanstack/react-query';
import { redirect, useRouter } from 'next/navigation';

import { authClient } from '@/lib/auth-client';
import { orpc } from '@/lib/orpc';
import { turnOffDeviceNotifications } from '@/lib/web-push.client';
import { CadetSchoolChrome } from './cadet-school-chrome';
import { CadetDeviceNotifications } from './notifications/cadet-device-notifications';
import { CadetNotificationBell } from './notifications/cadet-notifications';

/**
 * Signs out of the Cadet Portal only; a staff session in the same browser
 * stays. This device's notifications for the student are turned off first
 * (best effort), so a signed-out device stops showing their notifications.
 */
function SignOutButton() {
  const router = useRouter();
  const signOut = useMutation({
    mutationFn: async () => {
      await turnOffDeviceNotifications().catch(() => undefined);
      return authClient.signOut();
    },
    onSuccess: () => router.replace('/sign-in'),
  });
  return (
    <Button type="button" variant="outline" disabled={signOut.isPending} onClick={() => signOut.mutate()}>
      {signOut.isPending ? 'Signing out…' : 'Sign out'}
    </Button>
  );
}

/** The signed-in student's own admission; who they are comes from the session. */
function AdmissionName() {
  const admission = useQuery(orpc.getAdmission.queryOptions());
  if (admission.isPending) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (admission.isError) return <p className="text-sm text-destructive">Unable to load your details. Reload to try again.</p>;
  return <h1 className="text-2xl font-semibold tracking-tight">{admission.data.name}</h1>;
}

export function CadetHome() {
  const { data: session, isPending } = authClient.useSession();
  if (isPending) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!session) redirect('/sign-in');
  return (
    <div className="flex flex-col gap-6">
      <CadetSchoolChrome />
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-col gap-1">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Cadet Portal</p>
          <AdmissionName />
        </div>
        <CadetNotificationBell />
      </div>
      <CadetDeviceNotifications />
      <div>
        <SignOutButton />
      </div>
    </div>
  );
}
