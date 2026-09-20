import type { Metadata } from 'next';
import { AuthShell } from '@/components/auth-shell';
import { LogoutForm } from '@/components/logout-form';

export const metadata: Metadata = {
  title: 'Log out',
};

export default function LogoutPage() {
  return (
    <AuthShell>
      <LogoutForm />
    </AuthShell>
  );
}
