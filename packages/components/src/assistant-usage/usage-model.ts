import { formatUsdText, sumUsd } from '@campuspilot/assistant-contract/money';
import { addTokenCounts, type TokenCount } from '@campuspilot/assistant-contract/usage';

/**
 * Pure helpers of the assistant usage views (admin AI pages, the school's
 * AI usage tab). Amounts arrive as exact USD decimal text and are only ever
 * added exactly (`sumUsd`); floats are used for bar heights alone. Days are
 * IST calendar days, the same days the API groups by.
 */

/** One IST day of spend, as the usage procedures return it. */
export type UsageDay = {
  date: string;
  requests: number;
  inputTokens: TokenCount;
  outputTokens: TokenCount;
  cacheReadInputTokens: TokenCount;
  cacheCreationInputTokens: TokenCount;
  costUsd: string;
};

export type UsageGrouping = 'day' | 'month';

/** One row of a usage chart or table: a day or a month. */
export type UsagePeriod = {
  /** `YYYY-MM-DD` for a day, `YYYY-MM` for a month. */
  period: string;
  label: string;
  requests: number;
  tokens: TokenCount;
  costUsd: string;
};

export const USAGE_RANGE_PRESETS = ['last7', 'currentMonth', 'lastMonth', 'custom'] as const;
export type UsageRangePreset = (typeof USAGE_RANGE_PRESETS)[number];

export const USAGE_RANGE_PRESET_LABELS: Record<UsageRangePreset, string> = {
  last7: 'Last 7 days',
  currentMonth: 'This month',
  lastMonth: 'Last month',
  custom: 'Custom',
};

const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
const DAY_MS = 86_400_000;

/** The IST calendar date (`YYYY-MM-DD`) of an instant. */
export function istDateOf(instant: Date): string {
  return new Date(instant.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

const shiftDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

const lastDayOfMonth = (year: number, monthIndex: number) =>
  new Date(Date.UTC(year, monthIndex + 1, 0)).toISOString().slice(0, 10);

/**
 * The inclusive IST date range of a preset on `now`: the last 7 days
 * (today included), this month so far, or the whole of last month. Null for
 * `custom`, whose dates the viewer picks.
 */
export function rangeForPreset(preset: UsageRangePreset, now: Date): { from: string; to: string } | null {
  const today = istDateOf(now);
  const [year, month] = today.split('-').map(Number) as [number, number];
  switch (preset) {
    case 'last7':
      return { from: shiftDays(today, -6), to: today };
    case 'currentMonth':
      return { from: `${today.slice(0, 7)}-01`, to: today };
    case 'lastMonth': {
      const start = new Date(Date.UTC(year, month - 2, 1)).toISOString().slice(0, 10);
      return { from: start, to: lastDayOfMonth(year, month - 2) };
    }
    case 'custom':
      return null;
  }
}

const dayLabel = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const monthLabel = new Intl.DateTimeFormat('en-IN', { month: 'short', year: 'numeric', timeZone: 'UTC' });

const tokensOf = (day: UsageDay) =>
  addTokenCounts(day.inputTokens, day.outputTokens, day.cacheReadInputTokens, day.cacheCreationInputTokens);

/** Days as they are, or added up per calendar month (exact USD sums). */
export function groupUsage(days: readonly UsageDay[], grouping: UsageGrouping): UsagePeriod[] {
  if (grouping === 'day') {
    return days.map((day) => ({
      period: day.date,
      label: dayLabel.format(new Date(`${day.date}T00:00:00Z`)),
      requests: day.requests,
      tokens: tokensOf(day),
      costUsd: day.costUsd,
    }));
  }
  const months = new Map<string, UsageDay[]>();
  for (const day of days) {
    const key = day.date.slice(0, 7);
    months.set(key, [...(months.get(key) ?? []), day]);
  }
  return [...months].map(([period, monthDays]) => ({
    period,
    label: monthLabel.format(new Date(`${period}-01T00:00:00Z`)),
    requests: monthDays.reduce((sum, day) => sum + day.requests, 0),
    tokens: addTokenCounts(...monthDays.map(tokensOf)),
    costUsd: sumUsd(monthDays.map((day) => day.costUsd)),
  }));
}

/** A rate the viewer typed: rupees per US dollar, a positive decimal. */
export const INR_RATE_PATTERN = /^\d{1,4}(\.\d{1,4})?$/;

const TEN = BigInt(10);
const toScaled = (amount: string, scale: number) => {
  const [whole = '0', fraction = ''] = amount.split('.');
  return BigInt(whole) * TEN ** BigInt(scale) + BigInt(fraction.slice(0, scale).padEnd(scale, '0'));
};

/**
 * A USD amount in rupees at the viewer's rate, for display only (rounded to
 * the paisa). The rate is never sent to the server.
 */
export function formatInr(costUsd: string, inrPerUsd: string): string {
  // USD at 8 decimals × rate at 4 decimals = rupees at 12 decimals; to paise.
  const scaled = toScaled(costUsd, 8) * toScaled(inrPerUsd, 4);
  const step = TEN ** BigInt(10);
  const paise = (scaled + step / BigInt(2)) / step;
  const text = paise.toString().padStart(3, '0');
  const rupees = Number(text.slice(0, -2)).toLocaleString('en-IN');
  return `₹${rupees}.${text.slice(-2)}`;
}

/** `$X`, or `$X (₹Y)` when the viewer set a rate. */
export function formatSpend(costUsd: string, inrPerUsd: string | null): string {
  const usd = formatUsdText(costUsd);
  return inrPerUsd ? `${usd} (${formatInr(costUsd, inrPerUsd)})` : usd;
}
