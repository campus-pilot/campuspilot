import type { DatabaseExecutor } from '@campuspilot/db';
import { assistantModelRequestTable } from '@campuspilot/db/schema/assistant';
import { getRedisClient } from '@campuspilot/redis/client';
import { and, eq, gte, lt, sql } from 'drizzle-orm';

import { istMonthOf } from './ist';

/**
 * How long a school's month spend is reused for limit checks. A limit may
 * therefore be overshot by what the school spends in this window, as
 * agreed; checking every model request against a fresh sum would cost a
 * query per request.
 */
export const SPEND_CACHE_SECONDS = 10 * 60;

const spendKey = (schoolId: string, month: string) => `assistant:spend:${schoolId}:${month}`;

/**
 * A school's saved assistant spend in the IST month of `now`, in USD as
 * decimal text (the sum of its `assistant_model_request.cost_usd`). Cached in
 * Redis for {@link SPEND_CACHE_SECONDS}; when Redis cannot be reached the sum
 * is read from the database, never assumed.
 */
export async function schoolMonthSpendUsd(
  db: DatabaseExecutor,
  schoolId: string,
  now: Date = new Date(),
): Promise<string> {
  const { month, start, end } = istMonthOf(now);
  const key = spendKey(schoolId, month);
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
