import type { DatabaseExecutor } from '@campuspilot/db';
import { readSchoolPlan } from '@campuspilot/db/feature-flags/store';
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

/**
 * The span a school's assistant limit counts spend over
 * (docs/school-billing.md): its active billing period, so every 28-day period
 * gets exactly one limit's worth however the calendar months fall. A school
 * without a period (on a standing tier alone) counts the IST calendar month
 * of `now`, as before billing periods existed.
 */
export async function schoolSpendWindow(
  db: DatabaseExecutor,
  schoolId: string,
  now: Date = new Date(),
): Promise<{ key: string; start: Date; end: Date }> {
  const period = (await readSchoolPlan(db, schoolId))?.period ?? null;
  if (period) return { key: `period:${period.id}`, start: period.startsAt, end: period.endsAt };
  const { month, start, end } = istMonthOf(now);
  return { key: month, start, end };
}

/**
 * A school's saved assistant spend in its current spend window
 * ({@link schoolSpendWindow}), in USD as decimal text (the sum of its
 * `assistant_model_request.cost_usd`). Cached in Redis for
 * {@link SPEND_CACHE_SECONDS}; when Redis cannot be reached the sum is read
 * from the database, never assumed.
 */
export async function schoolWindowSpendUsd(
  db: DatabaseExecutor,
  schoolId: string,
  now: Date = new Date(),
): Promise<string> {
  const { key: window, start, end } = await schoolSpendWindow(db, schoolId, now);
  const key = spendKey(schoolId, window);
  const redis = getRedisClient();
  const cached = await redis.get(key).catch(() => null);
  if (cached !== null) return cached;
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
  return total;
}
