'use client';

import {
  formatSpend,
  groupUsage,
  UsageChart,
  UsageFreshness,
  UsageRangeControls,
  UsageTable,
  useUsageRangeForm,
  useUsageSelection,
} from '@campuspilot/components/assistant-usage';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@campuspilot/ui/components/card';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { orpc } from '@/lib/orpc';

/**
 * Settings › Usage › AI usage: what the school's assistant use cost, in USD,
 * per IST day or month, from the costs saved with every model request. The
 * API caches the figures for an hour; the card says when they were computed
 * and Refresh computes them again.
 */
export function AssistantUsageTab({ schoolId }: { schoolId: string }) {
  const [now] = useState(() => new Date());
  const form = useUsageRangeForm();
  const selection = useUsageSelection(form, now);
  const query = useQuery({
    ...orpc.school.getAssistantUsage.queryOptions({ input: { schoolId, from: selection?.from ?? '', to: selection?.to ?? '' } }),
    enabled: selection !== null,
    placeholderData: keepPreviousData,
  });
  const refresh = useRefreshUsage();
  const periods = query.data && selection ? groupUsage(query.data.days, selection.grouping) : null;
  return (
    <div className="flex flex-col gap-4">
      <UsageRangeControls form={form} />
      <Card>
        <CardHeader>
          <CardTitle>AI assistant spend</CardTitle>
          <CardDescription>
            {query.data
              ? `${formatSpend(query.data.total.costUsd, null)} over ${query.data.total.requests} model requests. Days are in IST.`
              : 'Days are in IST.'}
          </CardDescription>
          {query.data && selection ? (
            <CardAction>
              <UsageFreshness
                computedAt={query.data.computedAt}
                refreshing={refresh.isPending}
                onRefresh={() => refresh.mutate({ schoolId, from: selection.from, to: selection.to, refresh: true })}
              />
            </CardAction>
          ) : null}
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {periods && selection ? (
            <>
              <UsageChart periods={periods} inrPerUsd={null} label={`AI assistant spend per ${selection.grouping}`} />
              <UsageTable periods={periods} inrPerUsd={null} periodLabel={selection.grouping === 'day' ? 'Day' : 'Month'} />
            </>
          ) : query.isError ? (
            <p className="text-sm text-destructive">{query.error.message}</p>
          ) : (
            <div className="h-60 animate-pulse rounded-lg bg-muted" />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * Computes the usage again (`refresh`), bypassing the API's hour-long cache,
 * and shows the answer under the range it was asked for, so the page's query
 * keeps reading it without a second request.
 */
function useRefreshUsage() {
  const queryClient = useQueryClient();
  return useMutation(
    orpc.school.getAssistantUsage.mutationOptions({
      onSuccess: (usage, { refresh: _refresh, ...input }) =>
        queryClient.setQueryData(orpc.school.getAssistantUsage.queryKey({ input }), usage),
    }),
  );
}
