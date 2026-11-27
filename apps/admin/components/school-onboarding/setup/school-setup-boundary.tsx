'use client';

import { Suspense } from 'react';
import { AdminPageSkeleton } from '@campuspilot/components/admin-page-skeleton';
import { SchoolSetupPage } from './school-setup-page';

/** The setup page behind a skeleton while its first read loads. */
export function SchoolSetupBoundary({ requestId }: { requestId: string }) {
  return (
    <Suspense fallback={<AdminPageSkeleton />}>
      <SchoolSetupPage requestId={requestId} />
    </Suspense>
  );
}
