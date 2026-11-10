'use client';

import { SCHOOL_ACTIONS } from '@campuspilot/api/routers/authorization/authorization.dto';
import type { ReactNode } from 'react';

import { RequirePermissions } from '@/components/require-permissions';

/**
 * Renders the assistant UI only when the user may use it in the school. The
 * API checks the same permission.
 */
export function AssistantAccess({
  schoolId,
  children,
  fallback = null,
  pending,
}: {
  schoolId: string;
  children: ReactNode;
  fallback?: ReactNode;
  /** Shown while the permission check loads; defaults to `fallback`. */
  pending?: ReactNode;
}) {
  return (
    <RequirePermissions
      permissions={{ action: SCHOOL_ACTIONS.USE_ASSISTANT, resource: { kind: 'school', schoolId } }}
      fallback={fallback}
      pending={pending}
    >
      {children}
    </RequirePermissions>
  );
}
