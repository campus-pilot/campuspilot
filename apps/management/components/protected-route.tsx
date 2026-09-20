'use client';

import type { ReactNode } from 'react';
import { redirect, usePathname, useSearchParams } from 'next/navigation';
import { buildSignInRedirectPath } from '@campuspilot/auth/redirects';
import { authClient } from '@/lib/auth-client';
import { AuthLoading } from './auth-loading';

/**
 * Keeps protected static routes behind the client session boundary while
 * retaining their path and query string for the post-login return trip.
 */
export function ProtectedRoute({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { data: session, isPending } = authClient.useSession();

  if (isPending) return <AuthLoading />;

  if (!session) {
    const query = searchParams.toString();
    const returnTo = `${pathname}${query ? `?${query}` : ''}`;
    redirect(buildSignInRedirectPath(returnTo, '/auth/login'));
  }

  return children;
}
