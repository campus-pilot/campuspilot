'use client';

import { useEffect, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { authClient } from '@/lib/auth-client';
import { AuthLoading } from './auth-loading';

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { data: session, isPending } = authClient.useSession();

  useEffect(() => {
    if (isPending) return;
    if (!session) {
      router.replace('/sign-in');
      return;
    }
    if (session.user.role !== 'admin') router.replace('/unauthorized');
  }, [isPending, router, session]);

  if (isPending || !session || session.user.role !== 'admin') {
    return <AuthLoading />;
  }

  return children;
}
