'use client';

import { useEffect, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { buildSignInRedirectPath } from '@campuspilot/auth/redirects';
import { authClient } from '@/lib/auth-client';
import { AuthLoading } from './auth-loading';

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { data: session, isPending } = authClient.useSession();

  useEffect(() => {
    if (isPending) return;
    if (!session) {
      const returnTo = `${pathname}${window.location.search}${window.location.hash}`;
      router.replace(buildSignInRedirectPath(returnTo));
      return;
    }
    if (session.user.role !== 'admin') router.replace('/unauthorized');
  }, [isPending, pathname, router, session]);

  if (isPending || !session || session.user.role !== 'admin') {
    return <AuthLoading />;
  }

  return children;
}
