import { Suspense } from 'react';
import type { Metadata } from 'next';
import { OAuthConsent } from '@/components/oauth-consent';
import { PortalShell } from '@/components/portal-shell';

export const metadata: Metadata = {
  title: 'Connect an app',
};

export default function OAuthConsentPage() {
  return (
    <PortalShell>
      <Suspense fallback={null}>
        <OAuthConsent />
      </Suspense>
    </PortalShell>
  );
}
