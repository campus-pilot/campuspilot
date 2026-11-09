import { formatMinorIndian } from '@campuspilot/components/finance/finance-model';

/**
 * Display formatting for the Cadet Portal. Amounts arrive as exact integer
 * minor-unit strings and stay strings (no floating point); whole amounts
 * drop their zero paise ("₹4,850" rather than "₹4,850.00").
 */
export function formatMoney(minor: string, currency: string) {
  return formatMinorIndian(minor, currency).replace(/\.0+$/, '');
}

/** Absolute value of a signed minor-unit string. */
export function absMinor(minor: string) {
  return minor.startsWith('-') ? minor.slice(1) : minor;
}

export const isZeroMinor = (minor: string) => /^-?0$/.test(minor);

/**
 * A calendar date in the given IANA time zone (the session's finance zone
 * for ledger entries); without one, the device's zone.
 */
export function formatDate(value: Date | string, options: { timeZone?: string | null; withYear?: boolean } = {}) {
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    ...(options.withYear === false ? {} : { year: 'numeric' }),
    ...(options.timeZone ? { timeZone: options.timeZone } : {}),
  }).format(new Date(value));
}

/** "November 2026" for month group headings. */
export function formatMonth(value: Date | string, timeZone?: string | null) {
  return new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric', ...(timeZone ? { timeZone } : {}) }).format(
    new Date(value),
  );
}

/** A plain `YYYY-MM-DD` calendar date (no time zone involved), e.g. a bill's issue date. */
export function formatCalendarDate(date: string) {
  return formatDate(`${date}T00:00:00Z`, { timeZone: 'UTC' });
}

/** "monthly:2026-11" → "November 2026"; other periods are shown as their start month. */
export function billPeriodLabel(periodKey: string | null) {
  const match = periodKey ? /:(\d{4})-(\d{2})$/.exec(periodKey) : null;
  if (!match) return null;
  return formatMonth(`${match[1]}-${match[2]}-01T00:00:00Z`, 'UTC');
}

/** "82.4%", or "82%" for whole numbers. */
export function formatPercent(value: number) {
  return `${Number.isInteger(value) ? value : value.toFixed(1)}%`;
}

/** Signed one-decimal difference with a real minus sign, e.g. "+3.3" or "−1.2". */
export function signedPoints(value: number) {
  const rounded = Math.abs(value).toFixed(1).replace(/\.0$/, '');
  return `${value < 0 ? '−' : '+'}${rounded}`;
}

export function initialsOf(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join('');
}

export const firstNameOf = (name: string) => name.trim().split(/\s+/)[0] ?? name;

/** Time-of-day greeting from the device clock. */
export function greetingFor(hour: number) {
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}
