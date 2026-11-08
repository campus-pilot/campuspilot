'use client';

import { Button } from '@campuspilot/ui/components/button';
import { useMutation, useQuery } from '@tanstack/react-query';
import { redirect, useRouter } from 'next/navigation';

import { authClient } from '@/lib/auth-client';
import { orpc } from '@/lib/orpc';

/** Signs out of the Cadet Portal only; a staff session in the same browser stays. */
function SignOutButton() {
  const router = useRouter();
  const signOut = useMutation({
    mutationFn: () => authClient.signOut(),
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
      <div className="flex flex-col gap-1">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Cadet Portal</p>
        <AdmissionName />
      </div>
      <div>
        <SignOutButton />
      </div>
    </div>
  );
}
