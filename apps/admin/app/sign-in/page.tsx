import { Suspense } from 'react';
import type { Metadata } from 'next';
import { SignInForm } from '@/components/sign-in-form';
import { AuthLoading } from '@/components/auth-loading';

export const metadata: Metadata = {
  title: 'Sign in | CampusPilot Admin',
};

export default function SignInPage() {
  return (
    <Suspense fallback={<AuthLoading />}>
      <SignInForm />
    </Suspense>
  );
}
