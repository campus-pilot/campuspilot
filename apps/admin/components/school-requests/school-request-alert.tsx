'use client';

import { useQuery } from '@tanstack/react-query';
import { AppShellAlert } from '@campuspilot/components/app-shell';
import { orpc } from '@/lib/orpc';

/**
 * A shell warning while requests to create more schools wait for a decision
 * (docs/school-creation.md), linking to the School requests page. The
 * navigation has no counters, so this is where a new request surfaces. It
 * disappears once every request is decided.
 */
export function SchoolRequestAlert() {
  const pendingQuery = useQuery(
    orpc.systemAdmin.countPendingSchoolCreationRequests.queryOptions({ refetchInterval: 60_000 }),
  );
  const pending = pendingQuery.data?.pending ?? 0;
  if (pending === 0) return null;
  return (
    <AppShellAlert
      slug="school-creation-requests/pending"
      type="warning"
      message={
        pending === 1
          ? 'A request to create more schools is waiting for your decision.'
          : `${pending} requests to create more schools are waiting for your decision.`
      }
      actionLabel="Review requests"
      actionHref="/school-requests"
    />
  );
}
