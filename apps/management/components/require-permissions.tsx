'use client';

import type { ReactNode } from 'react';
import type { PermissionCheck } from '@campuspilot/api/routers/authorization/authorization.dto';
import { useQuery } from '@tanstack/react-query';
import { orpc } from '@/lib/orpc';

export type RequirePermissionsProps = {
  children: ReactNode;
  permissions: PermissionCheck | readonly PermissionCheck[];
  fallback?: ReactNode;
  mode?: 'all' | 'any';
};

/**
 * Renders children when the requested all/any permission policy is satisfied.
 * Pending, failed, incomplete, and denied checks fail closed.
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

  if (
    permissionsQuery.isPending ||
    permissionsQuery.isError ||
    permissionsQuery.data.results.length !== permissionList.length ||
    !(mode === 'any'
      ? permissionsQuery.data.results.some(Boolean)
      : permissionsQuery.data.results.every(Boolean))
  )
    return fallback;

  return children;
}
