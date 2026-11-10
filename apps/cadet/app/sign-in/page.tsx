import { Suspense } from 'react';
import type { Metadata } from 'next';
import { PortalShell } from '@/components/portal-shell';
import { SignInForm } from '@/components/sign-in-form';

export const metadata: Metadata = {
  title: 'Sign in',
};

export default function SignInPage() {
  return (
    <PortalShell>
      <Suspense fallback={null}>
        <SignInForm />
      </Suspense>
    </PortalShell>
  );
}
