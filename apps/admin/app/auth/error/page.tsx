import { Suspense } from 'react';
import type { Metadata } from 'next';
import { AuthErrorScreen } from '@/components/auth-error-screen';
import { AuthLoading } from '@/components/auth-loading';

export const metadata: Metadata = {
  title: 'Sign-in error | CampusPilot Admin',
};

export default function AuthErrorPage() {
  return (
    <Suspense fallback={<AuthLoading />}>
      <AuthErrorScreen />
    </Suspense>
  );
}
