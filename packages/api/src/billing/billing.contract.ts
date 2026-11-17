import { BILLING_PERIOD_DAYS } from '@campuspilot/db/feature-flags/catalogue';

export { BILLING_PERIOD_DAYS };

/**
 * School billing rules shared by the API and the browser apps
 * (docs/school-billing.md). Zod and the catalogue only.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** The most periods one payment can cover (about a year of 28-day periods). */
export const MAX_PERIODS_PER_INVOICE = 13;

/**
 * The end of `count` consecutive billing periods starting at `start`: always
 * exactly {@link BILLING_PERIOD_DAYS} days each, so every period is equally
 * long whatever the calendar month.
 */
export function addBillingPeriods(start: Date, count: number): Date {
  return new Date(start.getTime() + count * BILLING_PERIOD_DAYS * DAY_MS);
}

/**
 * Where a payment's periods begin: right after the school's current
 * coverage (so time already paid or on trial is never lost), or now, cutting
 * the active period short (an upgrade from a trial, for example).
 */
export const BILLING_START_OPTIONS = ['after_current', 'now'] as const;
export type BillingStart = (typeof BILLING_START_OPTIONS)[number];

/**
 * The end of a school's coverage: walking its periods from `now`, as long as
 * each starts no later than the previous one ends. Null when no period covers
 * `now`. A payment made ahead extends this; a gap stops it.
 */
export function coveredUntil(periods: ReadonlyArray<{ startsAt: Date; endsAt: Date }>, now: Date): Date | null {
  let cursor = now.getTime();
  let covered = false;
  for (const period of [...periods].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())) {
    if (period.endsAt.getTime() <= cursor) continue;
    if (period.startsAt.getTime() > cursor) break;
    cursor = period.endsAt.getTime();
    covered = true;
  }
  return covered ? new Date(cursor) : null;
}
