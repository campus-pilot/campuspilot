'use client';

import { ChartContainer, ChartTooltip, type ChartConfig } from '@campuspilot/ui/components/chart';
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';

import { formatSpend, type UsagePeriod } from './usage-model';

const chartConfig = { cost: { label: 'Spend (USD)', color: 'var(--color-violet-500)' } } satisfies ChartConfig;

/** The tooltip names the exact saved amount; the bar height alone is a float. */
function SpendTooltip({ active, payload, inrPerUsd }: { active?: boolean; payload?: Array<{ payload?: unknown }>; inrPerUsd: string | null }) {
  const period = active ? (payload?.[0]?.payload as (UsagePeriod & { cost: number }) | undefined) : undefined;
  if (!period) return null;
  return (
    <div className="flex flex-col gap-0.5 rounded-md border bg-background px-2.5 py-1.5 text-xs shadow-sm">
      <span className="font-medium">{period.label}</span>
      <span className="tabular-nums">{formatSpend(period.costUsd, inrPerUsd)}</span>
      <span className="text-muted-foreground tabular-nums">{period.requests} requests</span>
    </div>
  );
}

/** Spend per day or month as bars. */
export function UsageChart({ periods, inrPerUsd, label }: { periods: readonly UsagePeriod[]; inrPerUsd: string | null; label: string }) {
  const data = periods.map((period) => ({ ...period, cost: Number(period.costUsd) }));
  return (
    <div className="overflow-x-auto">
      <ChartContainer
        aria-label={label}
        className="aspect-auto h-[240px] w-full"
        config={chartConfig}
        style={{ minWidth: Math.max(280, data.length * 28) }}
      >
        <BarChart data={data} accessibilityLayer margin={{ left: 8, right: 8 }}>
          <CartesianGrid vertical={false} />
          <XAxis axisLine={false} dataKey="label" tickLine={false} tickMargin={8} minTickGap={12} />
          <YAxis axisLine={false} tickLine={false} width={54} tickFormatter={(value: number) => `$${value}`} />
          <ChartTooltip cursor={false} content={<SpendTooltip inrPerUsd={inrPerUsd} />} />
          <Bar dataKey="cost" fill="var(--color-cost)" radius={3} />
        </BarChart>
      </ChartContainer>
    </div>
  );
}
