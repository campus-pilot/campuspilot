import { Suspense } from 'react';
import type { Metadata } from 'next';
import { AuthLoading } from '@/components/auth-loading';
import { AuthShell } from '@/components/auth-shell';
import { LoginForm } from '@/components/login-form';

export const metadata: Metadata = {
  title: 'Sign in',
};

export default function LoginPage() {
  return (
    <Suspense fallback={<AuthLoading />}>
      <AuthShell>
        <LoginForm />
      </AuthShell>
    </Suspense>
  );
}
