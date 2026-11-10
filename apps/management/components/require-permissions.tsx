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
  mode?: 'all' | 'any';
};

/**
 * Renders children when the requested all/any permission policy is satisfied.
 * Pending, never-answered, incomplete, and denied checks fail closed; an
 * answer already held keeps applying through a failed background refetch
 * (see `permissionsSatisfied`).
 */
export function RequirePermissions({
  children,
  permissions,
  fallback = null,
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
