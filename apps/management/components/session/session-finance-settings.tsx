'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { SCHOOL_ACTIONS } from '@campuspilot/api/routers/authorization/authorization.dto';
import {
  SessionFinanceView,
  type FinanceClassOverrides,
  type FinanceSchemaConfig,
} from '@campuspilot/components/session';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@campuspilot/ui/components/empty';
import { client, orpc } from '@/lib/orpc';
import { RequirePermissions } from '@/components/require-permissions';

export function SessionFinanceSettings({
  schoolId,
  sessionId,
  isActive,
  onDirtyChange,
}: {
  schoolId: string;
  sessionId: string;
  isActive: boolean;
  onDirtyChange: (isDirty: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const financeQuery = useQuery(
    orpc.school.getSessionFinance.queryOptions({
      input: { schoolId, sessionId },
    }),
  );
  const updateMutation = useMutation({
    mutationFn: (updates: {
      financeConfig: FinanceSchemaConfig | null;
      classOverrides: FinanceClassOverrides;
    }) =>
      client.school.updateSessionFinance({
        schoolId,
        sessionId,
        ...updates,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: orpc.school.getSessionFinance.queryKey({
          input: { schoolId, sessionId },
        }),
      });
    },
  });

  if (financeQuery.isPending) {
    return <div className="h-64 animate-pulse rounded-xl bg-muted" />;
  }

  if (financeQuery.isError) {
    return (
      <Empty className="border border-dashed p-8">
        <EmptyHeader>
          <EmptyTitle>Unable to load financial configuration</EmptyTitle>
          <EmptyDescription>
            {financeQuery.error instanceof Error
              ? financeQuery.error.message
              : 'Try refreshing the page.'}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  const readOnlyView = (
    <SessionFinanceView key={sessionId} finance={financeQuery.data} />
  );

  if (!isActive) return readOnlyView;

  return (
    <RequirePermissions
      permissions={{
        action: SCHOOL_ACTIONS.UPDATE_SESSION_FINANCE,
        resource: { kind: 'school', schoolId },
      }}
      fallback={readOnlyView}
    >
      <SessionFinanceView
        key={sessionId}
        finance={financeQuery.data}
        isSaving={updateMutation.isPending}
        onDirtyChange={onDirtyChange}
        onSave={async (updates) => {
          await updateMutation.mutateAsync(updates);
        }}
      />
    </RequirePermissions>
  );
}
