import { Suspense, type ReactNode } from 'react';
import { AuthLoading } from '@/components/auth-loading';
import { ProtectedRoute } from '@/components/protected-route';

export default function ProtectedLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<AuthLoading />}>
      <ProtectedRoute>{children}</ProtectedRoute>
    </Suspense>
  );
}

