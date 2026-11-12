'use client';

import { schoolFeatureCatalogue } from '@campuspilot/api/routers/school/feature-flags/feature-flags.dto';
import { formatSpend, UsageFreshness, useUsageRangeForm, useUsageSelection } from '@campuspilot/components/assistant-usage';
import { resolveQueryBoundary } from '@campuspilot/components/query-boundary';
import { Badge } from '@campuspilot/ui/components/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@campuspilot/ui/components/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@campuspilot/ui/components/table';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { orpc } from '@/lib/orpc';

import { useInrRate } from './inr-rate';
import { ModelTotalsTable } from './model-totals-table';
import { AssistantSettingsForm } from './school-ai-settings';
import { SourceTotals, UsageSpendCard, UsageStateCard, UsageToolbar } from './usage-section';

/** The `assistant` flag card: state, settings, and an invalid-settings warning. */
function AssistantSettingsCard({ schoolId }: { schoolId: string }) {
  const flagsQuery = useQuery(orpc.systemAdmin.getSchoolFeatureFlags.queryOptions({ input: { id: schoolId } }));
  const state = resolveQueryBoundary(flagsQuery);
  if (state.kind === 'pending') return <div className="h-72 animate-pulse rounded-lg bg-muted" />;
  if (state.kind === 'failed') return <UsageStateCard failed onRetry={() => void flagsQuery.refetch()} />;
  const stored = state.data.features.assistant;
  const invalid = state.data.invalidConfigs.includes('assistant');
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          {schoolFeatureCatalogue.assistant.label}
          <Badge variant={stored.enabled ? 'default' : 'outline'}>{stored.enabled ? 'Enabled' : 'Disabled'}</Badge>
        </CardTitle>
        <CardDescription>{schoolFeatureCatalogue.assistant.description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {invalid ? (
          <p className="text-xs text-destructive" role="alert">
            The stored settings are not valid, so nobody in this school can use the assistant. Save them again.
          </p>
        ) : null}
        <AssistantSettingsForm key={JSON.stringify([stored, invalid])} schoolId={schoolId} stored={stored} />
      </CardContent>
    </Card>
  );
}

const count = new Intl.NumberFormat('en-IN');

/** Who in the school spent the most in the range (deleted accounts keep their costs). */
function TopUsersTable({ users, inrPerUsd }: { users: Array<{ userId: string; name: string | null; email: string | null; requests: number; costUsd: string }>; inrPerUsd: string | null }) {
  if (users.length === 0) return null;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Top users</TableHead>
          <TableHead className="text-right">Requests</TableHead>
          <TableHead className="text-right">Spend</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {users.map((user) => (
          <TableRow key={user.userId}>
            <TableCell>{user.name ?? user.email ?? 'Deleted account'}</TableCell>
            <TableCell className="text-right tabular-nums">{count.format(user.requests)}</TableCell>
            <TableCell className="text-right tabular-nums">{formatSpend(user.costUsd, inrPerUsd)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** The school's spend over the picked range, with its models and top users. */
function SchoolUsage({ schoolId }: { schoolId: string }) {
  const [now] = useState(() => new Date());
  const form = useUsageRangeForm();
  const selection = useUsageSelection(form, now);
  const inrPerUsd = useInrRate();
  const usageQuery = useQuery({
    ...orpc.systemAdmin.getSchoolAssistantUsage.queryOptions({
      input: { id: schoolId, from: selection?.from ?? '', to: selection?.to ?? '' },
    }),
    enabled: selection !== null,
    placeholderData: keepPreviousData,
  });
  const refresh = useRefreshSchoolUsage();
  return (
    <section className="flex flex-col gap-4">
      <UsageToolbar form={form} />
      {usageQuery.data && selection ? (
        <UsageSpendCard
          title="Spend"
          days={usageQuery.data.days}
          total={usageQuery.data.total}
          grouping={selection.grouping}
          inrPerUsd={inrPerUsd}
          action={
            <UsageFreshness
              computedAt={usageQuery.data.computedAt}
              refreshing={refresh.isPending}
              onRefresh={() => refresh.mutate({ id: schoolId, from: selection.from, to: selection.to, refresh: true })}
            />
          }
        >
          <SourceTotals sources={usageQuery.data.sources} inrPerUsd={inrPerUsd} />
          <ModelTotalsTable models={usageQuery.data.models} inrPerUsd={inrPerUsd} />
          <TopUsersTable users={usageQuery.data.users} inrPerUsd={inrPerUsd} />
        </UsageSpendCard>
      ) : (
        <UsageStateCard failed={usageQuery.isError} onRetry={() => void usageQuery.refetch()} />
      )}
    </section>
  );
}

/**
 * Computes the school's usage again (`refresh`), bypassing the API's
 * hour-long cache, and shows the answer under the range it was asked for.
 */
function useRefreshSchoolUsage() {
  const queryClient = useQueryClient();
  return useMutation(
    orpc.systemAdmin.getSchoolAssistantUsage.mutationOptions({
      onSuccess: (usage, { refresh: _refresh, ...input }) =>
        queryClient.setQueryData(orpc.systemAdmin.getSchoolAssistantUsage.queryKey({ input }), usage),
    }),
  );
}

/** School › AI: the assistant's settings for the school and what it spends. */
export function SchoolAiPage({ schoolId }: { schoolId: string }) {
  return (
    <section className="mx-auto flex w-full max-w-5xl flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">AI</h1>
        <p className="text-sm text-muted-foreground">
          The in-app assistant for this school: whether it has it, its monthly limit and which roles it may be opened to, and what it spends.
        </p>
      </div>
      <AssistantSettingsCard schoolId={schoolId} />
      <SchoolUsage schoolId={schoolId} />
    </section>
  );
}
