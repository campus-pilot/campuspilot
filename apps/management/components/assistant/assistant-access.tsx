'use client';

import { SCHOOL_ACTIONS } from '@campuspilot/api/routers/authorization/authorization.dto';
import type { ReactNode } from 'react';

import { RequirePermissions } from '@/components/require-permissions';
import { assistantClient } from '@/lib/assistant-client';

/**
 * Renders the assistant UI only when this deployment has an assistant and the
 * user may use it in the school. The service checks the same permission.
 */
export function AssistantAccess({
  schoolId,
  children,
  fallback = null,
}: {
  schoolId: string;
  children: ReactNode;
  fallback?: ReactNode;
}) {
  if (!assistantClient) return fallback;
  return (
    <RequirePermissions
      permissions={{ action: SCHOOL_ACTIONS.USE_ASSISTANT, resource: { kind: 'school', schoolId } }}
      fallback={fallback}
    >
      {children}
    </RequirePermissions>
  );
}
