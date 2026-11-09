import { SUPPORTED_CURRENCY_MINOR_UNITS, type CurrencyCode } from '@campuspilot/db/schema/jsonb/currencies';

/**
 * Server-side wording helpers shared by the remote channel renderers (web
 * push, WhatsApp). Text is built from catalogue facts at send time and never
 * stored (D-21). English only (D-13), Indian digit grouping.
 */

/**
 * Formats exact minor units (`"250000"`, `"INR"`) as `₹2,500.00`. The amount
 * is handed to `Intl` as a decimal string, never a float, so it stays exact.
 * An unsupported currency or a malformed amount falls back to the raw facts.
 */
export function formatMinorAmount(minor: string, currency: string): string {
  const exponent = SUPPORTED_CURRENCY_MINOR_UNITS[currency as CurrencyCode];
  if (exponent === undefined || !/^\d+$/.test(minor)) return `${currency} ${minor}`;
  const padded = minor.padStart(exponent + 1, '0');
  const decimal = exponent === 0 ? padded : `${padded.slice(0, -exponent)}.${padded.slice(-exponent)}`;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency,
    minimumFractionDigits: exponent,
    maximumFractionDigits: exponent,
  }).format(decimal as unknown as number);
}

function monthYear(year: number, month: number) {
  return new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(Date.UTC(year, month - 1, 1)),
  );
}

/**
 * Words for a billing period key as the billing domain stores it
 * (`<cadence>:YYYY-MM`, the local start month, see
 * `routers/school/billing/period.ts`): `monthly:2026-10` → `October 2026`,
 * `quarterly:2026-10` → `the quarter from October 2026`, `yearly:2026-04` →
 * `the year from April 2026`. A bare `YYYY-MM` reads as a month. Any other
 * value is shown as stored.
 */
export function formatPeriodKey(periodKey: string): string {
  const match = /^(?:(monthly|quarterly|yearly):)?(\d{4})-(\d{2})$/.exec(periodKey);
  if (!match) return periodKey;
  const month = Number(match[3]);
  if (month < 1 || month > 12) return periodKey;
  const start = monthYear(Number(match[2]), month);
  if (match[1] === 'quarterly') return `the quarter from ${start}`;
  if (match[1] === 'yearly') return `the year from ${start}`;
  return start;
}

/** `2026-10-01` → `1 October 2026`. */
export function formatIsoDate(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return isoDate;
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(date);
}
