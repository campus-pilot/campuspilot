'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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

export function SessionFinanceSettings({
  schoolId,
  sessionId,
  isEditable,
  onDirtyChange,
}: {
  schoolId: string;
  sessionId: string;
  isEditable: boolean;
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
      onDirtyChange(false);
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

  return (
    <SessionFinanceView
      key={sessionId}
      finance={financeQuery.data}
      isSaving={updateMutation.isPending}
      onSave={
        isEditable
          ? async (updates) => {
              await updateMutation.mutateAsync(updates);
            }
          : undefined
      }
      onDirtyChange={isEditable ? onDirtyChange : undefined}
    />
  );
}
