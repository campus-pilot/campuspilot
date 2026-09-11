import type { ReactNode } from 'react';
import { AdminShell } from '@/components/admin-shell';
import { ProtectedRoute } from '@/components/protected-route';

export default function ProtectedLayout({ children }: { children: ReactNode }) {
  return (
    <ProtectedRoute>
      <AdminShell>{children}</AdminShell>
    </ProtectedRoute>
  );
}
