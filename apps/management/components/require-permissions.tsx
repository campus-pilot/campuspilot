'use client';

import type { ReactNode } from 'react';
import type { PermissionCheck } from '@campuspilot/api/routers/authorization/authorization.dto';
import { useQuery } from '@tanstack/react-query';
import { orpc } from '@/lib/orpc';
import { permissionGateState } from './require-permissions-model';

export type RequirePermissionsProps = {
  children: ReactNode;
  permissions: PermissionCheck | readonly PermissionCheck[];
  /**
   * Shown when the check answered and the permission policy is not met, and
   * when the check failed with no answer held (it fails closed).
   */
  fallback?: ReactNode;
  /**
   * Shown while the check has no answer yet. Defaults to nothing: an
   * unanswered check is not a refusal, so `fallback` (often "you do not
   * have access") never stands in for it. A caller whose `fallback` is a
   * read-only form of the same view rather than a refusal (a breadcrumb's
   * plain label, a form without its edit controls) passes that view here
   * too, so the screen does not blank while the check loads.
   */
  pending?: ReactNode;
  mode?: 'all' | 'any';
};

/**
 * Renders children when the requested all/any permission policy is satisfied,
 * `pending` while the check has no answer, and `fallback` when it answered
 * no (see `permissionGateState`). Never-answered, incomplete and denied
 * checks fail closed; an answer already held keeps applying through a
 * failed background refetch (see `permissionsSatisfied`).
 */
export function RequirePermissions({
  children,
  permissions,
  fallback = null,
  pending = null,
  mode = 'all',
}: RequirePermissionsProps) {
  const permissionList: PermissionCheck[] = Array.isArray(permissions)
    ? [...permissions]
    : [permissions as PermissionCheck];
  const permissionsQuery = useQuery(
    orpc.authorization.checkPermissions.queryOptions({
      input: { permissions: permissionList },
    }),
  );

  const state = permissionGateState(
    {
      isPending: permissionsQuery.isPending,
      isError: permissionsQuery.isError,
      results: permissionsQuery.data?.results,
    },
    permissionList.length,
    mode,
  );
  if (state === 'pending') return pending;
  if (state === 'denied') return fallback;

  return children;
}
