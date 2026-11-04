import { Suspense } from 'react';
import type { Metadata } from 'next';
import { AuthLoading } from '@/components/auth-loading';
import { AuthShell } from '@/components/auth-shell';
import { OAuthConsent } from '@/components/oauth-consent';

export const metadata: Metadata = {
  title: 'Connect an app',
};

export default function OAuthConsentPage() {
  return (
    <Suspense fallback={<AuthLoading />}>
      <AuthShell>
        <OAuthConsent />
      </AuthShell>
    </Suspense>
  );
}
