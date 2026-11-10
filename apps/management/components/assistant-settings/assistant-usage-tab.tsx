'use client';

import {
  formatSpend,
  groupUsage,
  UsageChart,
  UsageRangeControls,
  UsageTable,
  useUsageRangeForm,
  useUsageSelection,
} from '@campuspilot/components/assistant-usage';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@campuspilot/ui/components/card';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { orpc } from '@/lib/orpc';

/**
 * Settings › Usage › AI usage: what the school's assistant use cost, in USD,
 * per IST day or month, from the costs saved with every model request. The
 * figures may be up to two hours behind.
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
  const periods = query.data && selection ? groupUsage(query.data.days, selection.grouping) : null;
  return (
    <div className="flex flex-col gap-4">
      <UsageRangeControls form={form} />
      <Card>
        <CardHeader>
          <CardTitle>AI assistant spend</CardTitle>
          <CardDescription>
            {query.data
              ? `${formatSpend(query.data.total.costUsd, null)} over ${query.data.total.requests} model requests. Days are in IST; figures may be up to two hours behind.`
              : 'Days are in IST; figures may be up to two hours behind.'}
          </CardDescription>
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
