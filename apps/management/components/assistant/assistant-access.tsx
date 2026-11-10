'use client';

import type { ReactNode } from 'react';

import { RequireFeature } from '@/components/require-feature';

import { useAssistantStatus } from './use-assistant';

type AssistantAccessProps = {
  schoolId: string;
  children: ReactNode;
  fallback?: ReactNode;
  /** Shown while the user's access loads; defaults to `fallback`. */
  pending?: ReactNode;
};

/**
 * Renders an assistant entry point (navbar panel button, sidebar link, ⌘K
 * entry) only when the school has the `assistant` feature and the user's
 * role may use it (`getStatus().allowed`: one of the user's roles is
 * eligible and switched on by the school). A school at its monthly limit
 * keeps the entry points, so the history and the reason stay in reach; the
 * composer says why it cannot send. The API enforces the same decision on
 * every call.
 */
export function AssistantAccess({ schoolId, children, fallback = null, pending }: AssistantAccessProps) {
  return (
    <RequireFeature schoolId={schoolId} feature="assistant" fallback={fallback}>
      <AssistantRoleGate schoolId={schoolId} fallback={fallback} pending={pending}>
        {children}
      </AssistantRoleGate>
    </RequireFeature>
  );
}

/** The role half of {@link AssistantAccess}; asked only once the feature is known to be on. */
function AssistantRoleGate({ schoolId, children, fallback = null, pending }: AssistantAccessProps) {
  const status = useAssistantStatus(schoolId);
  if (status.data?.allowed) return children;
  if (status.isPending) return pending ?? fallback;
  return fallback;
}
