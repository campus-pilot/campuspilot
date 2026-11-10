'use client';

import { formatSpend, useUsageRangeForm, useUsageSelection } from '@campuspilot/components/assistant-usage';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@campuspilot/ui/components/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@campuspilot/ui/components/table';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';

import { orpc } from '@/lib/orpc';

import { useInrRate } from './inr-rate';
import { ModelTotalsTable } from './model-totals-table';
import { UsageSpendCard, UsageStateCard, UsageToolbar } from './usage-section';

const count = new Intl.NumberFormat('en-IN');

/** Each school's spend in the range, linking to its AI page. */
function SchoolSpendTable({
  schools,
  inrPerUsd,
}: {
  schools: Array<{ schoolId: string; schoolName: string | null; requests: number; costUsd: string }>;
  inrPerUsd: string | null;
}) {
  if (schools.length === 0) return <p className="text-sm text-muted-foreground">No school used the assistant in this range.</p>;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>School</TableHead>
          <TableHead className="text-right">Requests</TableHead>
          <TableHead className="text-right">Spend</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {schools.map((school) => (
          <TableRow key={school.schoolId}>
            <TableCell>
              {school.schoolName ? (
                <Link className="underline-offset-4 hover:underline" href={`/school/${school.schoolId}/usage/ai`}>
                  {school.schoolName}
                </Link>
              ) : (
                'Deleted school'
              )}
            </TableCell>
            <TableCell className="text-right tabular-nums">{count.format(school.requests)}</TableCell>
            <TableCell className="text-right tabular-nums">{formatSpend(school.costUsd, inrPerUsd)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** A titled card around one table of the billing page. */
function TableCard({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto">{children}</CardContent>
    </Card>
  );
}

/**
 * AI billing: the platform's assistant spend for drift checks against the
 * providers' consoles. Totals per provider and model show the prices that
 * were saved, so a wrong env price is visible.
 */
export function PlatformAiBilling() {
  const [now] = useState(() => new Date());
  // Billing compares months with the providers' consoles, so it opens on this month.
  const form = useUsageRangeForm({ defaultPreset: 'currentMonth' });
  const selection = useUsageSelection(form, now);
  const inrPerUsd = useInrRate();
  const usageQuery = useQuery({
    ...orpc.systemAdmin.getPlatformAssistantUsage.queryOptions({ input: { from: selection?.from ?? '', to: selection?.to ?? '' } }),
    enabled: selection !== null,
    placeholderData: keepPreviousData,
  });
  const usage = usageQuery.data;
  return (
    <section className="mx-auto flex w-full max-w-6xl flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">AI billing</h1>
        <p className="text-sm text-muted-foreground">
          What the in-app assistant cost across all schools, from the cost saved with every model request. Compare months with each
          provider’s console: consoles group days in their own time zone, these pages in IST.
        </p>
      </div>
      <UsageToolbar form={form} />
      {usage && selection ? (
        <>
          <UsageSpendCard title="Platform spend" days={usage.days} total={usage.total} grouping={selection.grouping} inrPerUsd={inrPerUsd} />
          <TableCard title="Per provider and model" description="Tokens, requests and spend, with the prices that were saved.">
            <ModelTotalsTable models={usage.models} inrPerUsd={inrPerUsd} />
          </TableCard>
          <TableCard title="Per school" description={`${formatSpend(usage.total.costUsd, inrPerUsd)} in all.`}>
            <SchoolSpendTable schools={usage.schools} inrPerUsd={inrPerUsd} />
          </TableCard>
        </>
      ) : (
        <UsageStateCard failed={usageQuery.isError} onRetry={() => void usageQuery.refetch()} />
      )}
    </section>
  );
}
