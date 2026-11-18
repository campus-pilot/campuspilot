/**
 * Trial dates as the admin app shows and picks them (docs/school-billing.md).
 * The platform runs on Indian time, so a trial end is picked as a calendar
 * day in IST and ends at the last second of that day there; the server
 * stores the instant in UTC.
 */

import { BILLING_PERIOD_DAYS } from '@campuspilot/api/billing/billing.contract';
import { MAX_TRIAL_DAYS } from '@campuspilot/api/routers/system-admin/school/school.dto';

const IST = 'Asia/Kolkata';
const DAY_MS = 24 * 60 * 60 * 1000;

const istDayFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: IST, year: 'numeric', month: '2-digit', day: '2-digit' });
const istDateFormatter = new Intl.DateTimeFormat('en-IN', { timeZone: IST, day: 'numeric', month: 'short', year: 'numeric' });
const istShortDateFormatter = new Intl.DateTimeFormat('en-IN', { timeZone: IST, day: 'numeric', month: 'short' });

/** The IST calendar day of an instant, as `YYYY-MM-DD` (the value of a date input). */
export function istDay(instant: Date): string {
  return istDayFormatter.format(instant);
}

/** The day `days` days later, as `YYYY-MM-DD`. */
export function addDays(day: string, days: number): string {
  const [year, month, date] = day.split('-').map(Number);
  return new Date(Date.UTC(year!, month! - 1, date! + days)).toISOString().slice(0, 10);
}

/** The last second of an IST day, as the ISO date-time the trial procedures take. */
export function endOfIstDay(day: string): string {
  return `${day}T23:59:59+05:30`;
}

/** The proposed end of a new trial: one billing period (28 days) from today, in IST (docs/school-billing.md). */
export function defaultTrialEndDay(now: Date = new Date()): string {
  return addDays(istDay(now), BILLING_PERIOD_DAYS);
}

/** "17 Dec 2026", in IST. */
export function formatIstDate(instant: Date): string {
  return istDateFormatter.format(instant);
}

/** "17 Dec", in IST. */
export function formatIstShortDate(instant: Date): string {
  return istShortDateFormatter.format(instant);
}

/** Calendar days in IST from `now` to an instant: 0 on its last day. */
export function daysUntil(instant: Date, now: Date = new Date()): number {
  const dayNumber = (value: Date) => Date.parse(istDay(value)) / DAY_MS;
  return Math.max(0, dayNumber(instant) - dayNumber(now));
}

/** "in 23 days", "in 1 day", "today". */
export function formatDaysUntil(instant: Date, now: Date = new Date()): string {
  const days = daysUntil(instant, now);
  if (days === 0) return 'today';
  return days === 1 ? 'in 1 day' : `in ${days} days`;
}

/**
 * Why a picked end day cannot be saved, or null when it can: it must be a
 * day, end in the future and lie within {@link MAX_TRIAL_DAYS} days.
 */
export function trialEndDayProblem(day: string, now: Date = new Date()): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return 'Choose the day the trial ends.';
  const end = new Date(endOfIstDay(day));
  if (Number.isNaN(end.getTime())) return 'Choose the day the trial ends.';
  if (end.getTime() <= now.getTime()) return 'The trial must end in the future.';
  if (end.getTime() > now.getTime() + MAX_TRIAL_DAYS * DAY_MS) return `A trial can run for at most ${MAX_TRIAL_DAYS} days.`;
  return null;
}
