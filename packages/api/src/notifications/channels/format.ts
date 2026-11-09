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

/** `2026-10` → `October 2026`; any other billing period key is shown as stored. */
export function formatPeriodKey(periodKey: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(periodKey);
  if (!match) return periodKey;
  const month = Number(match[2]);
  if (month < 1 || month > 12) return periodKey;
  return new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(Date.UTC(Number(match[1]), month - 1, 1)),
  );
}

/** `2026-10-01` → `1 October 2026`. */
export function formatIsoDate(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return isoDate;
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(date);
}
