'use client';

import type { ReactNode } from 'react';
import type { PermissionCheck } from '@campuspilot/api/routers/authorization/authorization.dto';
import { useQuery } from '@tanstack/react-query';
import { orpc } from '@/lib/orpc';
import { permissionsSatisfied } from './require-permissions-model';

export type RequirePermissionsProps = {
  children: ReactNode;
  permissions: PermissionCheck | readonly PermissionCheck[];
  fallback?: ReactNode;
  /**
   * Shown while the check is still loading. Defaults to `fallback`, so a
   * caller that does not pass it behaves as before. Pass a neutral
   * placeholder where `fallback` is a refusal ("you don't have access"),
   * which would otherwise flash on every cold load before the answer is in.
   */
  pending?: ReactNode;
  mode?: 'all' | 'any';
};

/**
 * Renders children when the requested all/any permission policy is satisfied.
 * Pending, failed, incomplete, and denied checks fail closed: children never
 * render until the check has passed.
 */
export function RequirePermissions({
  children,
  permissions,
  fallback = null,
  pending = fallback,
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

  if (permissionsQuery.isPending) return pending;

  const satisfied = permissionsSatisfied(
    {
      isPending: permissionsQuery.isPending,
      isError: permissionsQuery.isError,
      results: permissionsQuery.data?.results,
    },
    permissionList.length,
    mode,
  );
  if (!satisfied) return fallback;

  return children;
}
