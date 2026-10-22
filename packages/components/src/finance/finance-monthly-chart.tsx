"use client";

import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@campuspilot/ui/components/chart";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@campuspilot/ui/components/card";
import {
  Bar,
  BarChart,
  CartesianGrid,
  XAxis,
  YAxis,
} from "recharts";

import { currencyExponent, formatMinor } from "./finance-model";

export type FinanceMonthlyActivity = {
  period: string;
  billedMinor: string;
  collectedMinor: string;
  creditAdjustmentMinor: string;
  refundMinor: string;
};

const chartConfig = {
  billed: { label: "Billed", color: "var(--color-red-500)" },
  collected: { label: "Collected", color: "var(--color-green-500)" },
  creditAdjustments: {
    label: "Credit adjustments",
    color: "var(--color-blue-500)",
  },
  refunds: { label: "Refunds", color: "var(--color-amber-500)" },
} satisfies ChartConfig;

const seriesMinorKeys = {
  billed: "billedMinor",
  collected: "collectedMinor",
  creditAdjustments: "creditAdjustmentMinor",
  refunds: "refundMinor",
} as const;

function periodLabel(period: string) {
  const [year, month] = period.split("-").map(Number);
  return new Intl.DateTimeFormat("en", {
    month: "short",
    year: "2-digit",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year!, month! - 1, 1)));
}

/** Recharts requires floating-point coordinates. Exact minor-unit strings stay
 * on each datum and are used by the tooltip, so financial display remains
 * lossless even though bar geometry is necessarily approximate. */
function chartValue(minor: string, currency: string) {
  return Number(minor) / 10 ** currencyExponent(currency);
}

function exactTooltipValue(
  item: { dataKey?: unknown; payload?: unknown },
  currency: string,
) {
  const dataKey = typeof item.dataKey === "string" ? item.dataKey : undefined;
  const minorKey = dataKey
    ? seriesMinorKeys[dataKey as keyof typeof seriesMinorKeys]
    : undefined;
  const payload =
    item.payload && typeof item.payload === "object"
      ? (item.payload as Record<string, unknown>)
      : undefined;
  const value =
    minorKey && payload && minorKey in payload
      ? payload[minorKey]
      : undefined;
  return typeof value === "string" ? formatMinor(value, currency) : "—";
}

export function FinanceMonthlyChart({
  currency,
  contextLabel,
  activity,
}: {
  currency: string;
  contextLabel: string;
  activity: FinanceMonthlyActivity[];
}) {
  const data = activity.map((item) => ({
    ...item,
    label: periodLabel(item.period),
    billed: chartValue(item.billedMinor, currency),
    collected: chartValue(item.collectedMinor, currency),
    creditAdjustments: chartValue(item.creditAdjustmentMinor, currency),
    refunds: chartValue(item.refundMinor, currency),
  }));
  const minimumWidth = Math.max(280, data.length * 88);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Monthly overview</CardTitle>
        <CardDescription>
          {currency} · {contextLabel}
        </CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <ChartContainer
          aria-label={`${currency} monthly ledger activity for ${contextLabel}`}
          className="h-[300px] w-full aspect-auto"
          config={chartConfig}
          style={{ minWidth: minimumWidth }}
        >
          <BarChart data={data} accessibilityLayer margin={{ left: 8, right: 8 }}>
            <CartesianGrid vertical={false} />
            <XAxis
              axisLine={false}
              dataKey="label"
              tickLine={false}
              tickMargin={8}
            />
            <YAxis
              axisLine={false}
              tickFormatter={(value: number) =>
                Intl.NumberFormat("en", { notation: "compact" }).format(value)
              }
              tickLine={false}
              width={54}
            />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  formatter={(_value, name, item) => (
                    <div className="flex min-w-48 items-center justify-between gap-4">
                      <span className="text-muted-foreground">
                        {chartConfig[name as keyof typeof chartConfig]?.label ??
                          name}
                      </span>
                      <span className="font-mono font-medium tabular-nums">
                        {exactTooltipValue(item, currency)}
                      </span>
                    </div>
                  )}
                />
              }
            />
            <ChartLegend
              content={
                <ChartLegendContent className="flex-wrap gap-x-3 gap-y-1" />
              }
            />
            <Bar
              dataKey="billed"
              fill="var(--color-billed)"
              radius={[3, 3, 0, 0]}
            />
            <Bar
              dataKey="collected"
              fill="var(--color-collected)"
              radius={[3, 3, 0, 0]}
            />
            <Bar
              dataKey="creditAdjustments"
              fill="var(--color-creditAdjustments)"
              radius={[3, 3, 0, 0]}
            />
            <Bar
              dataKey="refunds"
              fill="var(--color-refunds)"
              radius={[3, 3, 0, 0]}
            />
          </BarChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
