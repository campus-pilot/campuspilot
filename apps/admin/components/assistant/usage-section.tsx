'use client';

import {
  formatSpend,
  groupUsage,
  UsageChart,
  UsageRangeControls,
  UsageTable,
  type UsageDay,
  type UsageGrouping,
  type UsageRangeFormApi,
} from '@campuspilot/components/assistant-usage';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@campuspilot/ui/components/card';
import type { ReactNode } from 'react';

import { InrRateControl } from './inr-rate';

/** Totals shown above a usage chart. */
export type UsageTotals = { requests: number; costUsd: string };

/** The range picker, the INR rate and the stated freshness, shared by the AI pages. */
export function UsageToolbar({ form }: { form: UsageRangeFormApi }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <UsageRangeControls form={form} />
      <InrRateControl />
    </div>
  );
}

/** Spend for the chosen range: totals, a chart and a table, per day or month. */
export function UsageSpendCard({
  title,
  days,
  total,
  grouping,
  inrPerUsd,
  children,
}: {
  title: string;
  days: readonly UsageDay[];
  total: UsageTotals;
  grouping: UsageGrouping;
  inrPerUsd: string | null;
  children?: ReactNode;
}) {
  const periods = groupUsage(days, grouping);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>
          {formatSpend(total.costUsd, inrPerUsd)} over {total.requests} model requests. Days are IST; figures may be up to two hours
          behind.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <UsageChart periods={periods} inrPerUsd={inrPerUsd} label={`${title} per ${grouping}`} />
        <UsageTable periods={periods} inrPerUsd={inrPerUsd} periodLabel={grouping === 'day' ? 'Day' : 'Month'} />
        {children}
      </CardContent>
    </Card>
  );
}

/** A placeholder while usage loads or after it failed, in the card's place. */
export function UsageStateCard({ failed, onRetry }: { failed: boolean; onRetry: () => void }) {
  if (!failed) return <div className="h-72 animate-pulse rounded-lg bg-muted" />;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Unable to load usage</CardTitle>
        <CardDescription>
          <button type="button" className="underline" onClick={onRetry}>
            Try again
          </button>
        </CardDescription>
      </CardHeader>
    </Card>
  );
}
