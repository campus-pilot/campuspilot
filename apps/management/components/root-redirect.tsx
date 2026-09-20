'use client';

import { redirect } from 'next/navigation';
import { buildSignInRedirectPath } from '@campuspilot/auth/redirects';
import { authClient } from '@/lib/auth-client';
import { AuthLoading } from './auth-loading';

/** Routes the neutral app entry to the correct side of the auth boundary. */
export function RootRedirect() {
  const { data: session, isPending } = authClient.useSession();

  if (isPending) return <AuthLoading />;
  if (session) redirect('/school');

  redirect(buildSignInRedirectPath('/school', '/auth/login'));
}
