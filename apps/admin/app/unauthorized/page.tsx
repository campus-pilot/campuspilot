'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  sessionUserSignInIdentity,
  staffSignInLabel,
} from '@campuspilot/components/staff-account/staff-sign-in-label';
import { AccessDenied } from '@/components/access-denied';
import { AuthLoading } from '@/components/auth-loading';
import { authClient } from '@/lib/auth-client';

export default function UnauthorizedPage() {
  const router = useRouter();
  const { data: session, isPending } = authClient.useSession();

  useEffect(() => {
    if (isPending) return;
    if (!session) router.replace('/sign-in');
    if (session?.user.role === 'admin') router.replace('/');
  }, [isPending, router, session]);

  if (isPending || !session || session.user.role === 'admin') {
    return <AuthLoading />;
  }

  // A phone-only account's stored email is a placeholder; show what the
  // person actually signs in with.
  return (
    <AccessDenied
      signInLabel={staffSignInLabel(sessionUserSignInIdentity(session.user))}
    />
  );
}
