'use client';

import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { DemoSchoolPurgeDto } from '@campuspilot/api/routers/system-admin/demo-school/demo-school.dto';
import { SYSTEM_ACTIONS } from '@campuspilot/api/routers/authorization/authorization.dto';
import { AppShellAlert } from '@campuspilot/components/app-shell';
import { orpc } from '@/lib/orpc';
import { useRetryDemoPurge } from './demo-job-hooks';
import { showDemoPurgeToast } from './demo-job-toast';

/**
 * Registers one shell warning per demo purge that needs an admin: a purge
 * that failed (after its automatic retries, or between them), or one whose
 * hand-over to the workflow engine keeps failing. The purged school no longer
 * has a settings page, so the shell's alert list is where this surfaces.
 * Admins who may purge get a Retry action; others see the warning only. An
 * alert disappears when its purge leaves the list (retried or completed).
 */
export function DemoPurgeAlerts() {
  const purgesQuery = useQuery(
    orpc.systemAdmin.listDemoSchoolPurges.queryOptions({
      input: { filters: { needsAttention: true } },
      refetchInterval: 60_000,
    }),
  );
  const permissionQuery = useQuery(
    orpc.authorization.checkPermissions.queryOptions({
      input: { permissions: [{ action: SYSTEM_ACTIONS.PURGE_DEMO_SCHOOL, resource: { kind: 'system' } }] },
    }),
  );
  if (!purgesQuery.data) return null;
  // Fails closed: no action until the check has answered yes.
  const canRetry = permissionQuery.data?.results[0] === true;
  return purgesQuery.data.items.map((purge) => (
    <DemoPurgeAlert key={purge.schoolId} purge={purge} canRetry={canRetry} />
  ));
}

function purgeAlertMessage(purge: DemoSchoolPurgeDto) {
  const name = purge.schoolName ?? purge.schoolId;
  if (purge.status === 'pending') {
    return `The purge of demo school ${name} is waiting for the workflow engine: ${purge.lastSubmitError ?? 'not reachable'}`;
  }
  const next = purge.automaticRetryPending ? ' It will be retried automatically.' : '';
  return `The purge of demo school ${name} failed: ${purge.error ?? 'unknown error'}.${next}`;
}

function DemoPurgeAlert({ purge, canRetry }: { purge: DemoSchoolPurgeDto; canRetry: boolean }) {
  const retry = useRetryDemoPurge(purge.schoolId);
  const { mutateAsync } = retry;
  const onAction = useCallback(
    async (closeDialog: () => void) => {
      closeDialog();
      await mutateAsync();
      showDemoPurgeToast({ schoolId: purge.schoolId, schoolName: purge.schoolName ?? purge.schoolId });
    },
    [mutateAsync, purge.schoolId, purge.schoolName],
  );
  const alert = {
    slug: `demo-purge/${purge.schoolId}`,
    type: 'warning' as const,
    message: purgeAlertMessage(purge),
  };
  // Only a failed purge can be retried; a pending one is already being re-sent.
  if (!canRetry || purge.status !== 'failed') return <AppShellAlert {...alert} />;
  return <AppShellAlert {...alert} actionLabel="Retry purge" onAction={onAction} />;
}
