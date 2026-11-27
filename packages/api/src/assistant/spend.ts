import type { DatabaseExecutor } from '@campuspilot/db';
import { BILLING_PERIOD_DAYS } from '@campuspilot/db/feature-flags/catalogue';
import { readSchoolPlan } from '@campuspilot/db/feature-flags/store';
import { measure } from '@campuspilot/logger/perf';
import { assistantModelRequestTable } from '@campuspilot/db/schema/assistant';
import { getRedisClient } from '@campuspilot/redis/client';
import { and, eq, gte, lt, sql } from 'drizzle-orm';

import { istMonthOf } from './ist';

/**
 * How long a school's spend is reused for limit checks. A limit may
 * therefore be overshot by what the school spends in this window, as
 * agreed; checking every model request against a fresh sum would cost a
 * query per request.
 */
export const SPEND_CACHE_SECONDS = 10 * 60;

const spendKey = (schoolId: string, window: string) => `assistant:spend:${schoolId}:${window}`;

const STEP_MS = BILLING_PERIOD_DAYS * 24 * 60 * 60 * 1000;

/**
 * The span a school's assistant limit counts spend over
 * (docs/school-billing.md): the 28-day step of its active billing period that
 * holds `now`, so every 28 days get exactly one limit's worth however the
 * calendar months fall. Paid and free periods are one step long; a longer or
 * extended trial gets one limit per 28 days from its start. A school without
 * a period (on a standing tier alone) counts the IST calendar month of `now`,
 * as before billing periods existed.
 */
export async function schoolSpendWindow(
  db: DatabaseExecutor,
  schoolId: string,
  now: Date = new Date(),
): Promise<{ key: string; start: Date; end: Date }> {
  // One more query before the cached spend is read, on every access check
  // (each model request and tool call). Timed so the performance logs show
  // whether it ever costs enough to fold into the read-only check's query.
  const period = (await measure('assistant.spend.window', () => readSchoolPlan(db, schoolId)))?.period ?? null;
  if (period) {
    const lastStep = Math.max(0, Math.ceil((period.endsAt.getTime() - period.startsAt.getTime()) / STEP_MS) - 1);
    const step = Math.min(lastStep, Math.max(0, Math.floor((now.getTime() - period.startsAt.getTime()) / STEP_MS)));
    const start = new Date(period.startsAt.getTime() + step * STEP_MS);
    const end = new Date(Math.min(start.getTime() + STEP_MS, period.endsAt.getTime()));
    return { key: `period:${period.id}:${step}`, start, end };
  }
  const { month, start, end } = istMonthOf(now);
  return { key: month, start, end };
}

/**
 * A school's saved assistant spend in its current spend window, with the
 * window it was counted over: the one figure the limit check, the school's
 * allowance meter and the assistant panel's allowance all read, so they
 * always agree.
 */
export type SchoolWindowSpend = {
  /** USD as decimal text: the sum of the window's `assistant_model_request.cost_usd`, up to {@link SPEND_CACHE_SECONDS} old. */
  spendUsd: string;
  /** When the window began. */
  start: Date;
  /** When the window ends (exclusive): the allowance resets then. */
  end: Date;
};

/**
 * A school's saved assistant spend in its current spend window
 * ({@link schoolSpendWindow}), with that window. Cached in Redis for
 * {@link SPEND_CACHE_SECONDS}; when Redis cannot be reached the sum is read
 * from the database, never assumed.
 */
export async function readSchoolWindowSpend(
  db: DatabaseExecutor,
  schoolId: string,
  now: Date = new Date(),
): Promise<SchoolWindowSpend> {
  const { key: window, start, end } = await schoolSpendWindow(db, schoolId, now);
  const key = spendKey(schoolId, window);
  const redis = getRedisClient();
  const cached = await redis.get(key).catch(() => null);
  if (cached !== null) return { spendUsd: cached, start, end };
  const [row] = await db
    .select({ total: sql<string>`coalesce(sum(${assistantModelRequestTable.costUsd}), 0)::text` })
    .from(assistantModelRequestTable)
    .where(
      and(
        eq(assistantModelRequestTable.schoolId, schoolId),
        gte(assistantModelRequestTable.createdAt, start),
        lt(assistantModelRequestTable.createdAt, end),
      ),
    );
  const total = row?.total ?? '0';
  await redis.set(key, total, 'EX', SPEND_CACHE_SECONDS).catch(() => undefined);
  return { spendUsd: total, start, end };
}

/**
 * A school's saved assistant spend in its current spend window, in USD as
 * decimal text ({@link readSchoolWindowSpend} without the window).
 */
export async function schoolWindowSpendUsd(
  db: DatabaseExecutor,
  schoolId: string,
  now: Date = new Date(),
): Promise<string> {
  return (await readSchoolWindowSpend(db, schoolId, now)).spendUsd;
}
