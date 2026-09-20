'use client';

import type { ReactNode } from 'react';
import type { PermissionCheck } from '@campuspilot/api/routers/authorization/authorization.dto';
import { useQuery } from '@tanstack/react-query';
import { orpc } from '@/lib/orpc';

export type RequirePermissionsProps = {
  children: ReactNode;
  permissions: PermissionCheck | readonly PermissionCheck[];
  fallback?: ReactNode;
};

/**
 * Renders children only when every requested permission is allowed. Pending,
 * failed, and denied checks fail closed to the supplied fallback.
 */
export function RequirePermissions({
  children,
  permissions,
  fallback = null,
}: RequirePermissionsProps) {
  const permissionList: PermissionCheck[] = Array.isArray(permissions)
    ? [...permissions]
    : [permissions as PermissionCheck];
  const permissionsQuery = useQuery(
    orpc.authorization.checkPermissions.queryOptions({
      input: { permissions: permissionList },
    }),
  );

  if (!permissionsQuery.data?.results.every(Boolean)) return fallback;

  return children;
}
