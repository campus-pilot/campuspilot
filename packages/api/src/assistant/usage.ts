import type { DatabaseExecutor } from '@campuspilot/db';
import { user as userTable } from '@campuspilot/db/schema/auth';
import { assistantModelRequestTable } from '@campuspilot/db/schema/assistant';
import { schoolTable } from '@campuspilot/db/schema/school';
import { getRedisClient } from '@campuspilot/redis/client';
import { and, desc, eq, gte, lt, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';

import { IST_TIME_ZONE, istDate, istDayStart } from './ist';

/**
 * Assistant spend for people to read (the school's usage tab, the admin AI
 * pages), from the saved `assistant_model_request` rows: nothing is
 * recomputed from prices. Days are IST calendar days. Results are cached in
 * Redis for {@link USAGE_CACHE_SECONDS}, so these pages may be up to an hour
 * behind; limits use their own, shorter cache (`spend.ts`).
 */

/** How long a usage answer is reused. */
export const USAGE_CACHE_SECONDS = 60 * 60;

/** The longest range one request may ask for, in days. */
export const MAX_USAGE_RANGE_DAYS = 400;

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a YYYY-MM-DD date.')
  .refine((date) => istDate(istDayStart(date)) === date, 'Use a real calendar date.');

/** The fields of an inclusive range of IST calendar dates. */
export const usageRangeShape = {
  /** First IST calendar day, `YYYY-MM-DD`. */
  from: isoDate,
  /** Last IST calendar day (inclusive), `YYYY-MM-DD`. */
  to: isoDate,
};

/**
 * An input object with a usage range: its fields plus the range's own rules
 * (ordered, at most {@link MAX_USAGE_RANGE_DAYS} days). Inputs stay plain
 * top-level objects, as every procedure input must be.
 */
export function withUsageRange<T extends z.ZodRawShape>(shape: T) {
  return z
    .object({ ...shape, ...usageRangeShape })
    .refine((value) => rangeOf(value).from <= rangeOf(value).to, { message: 'The range must not end before it starts.', path: ['to'] })
    .refine((value) => rangeDays(rangeOf(value)) <= MAX_USAGE_RANGE_DAYS, {
      message: `Ask for at most ${MAX_USAGE_RANGE_DAYS} days at a time.`,
      path: ['from'],
    });
}

/** The range fields of a parsed input (the generic shape hides them from TypeScript). */
const rangeOf = (value: unknown) => value as { from: string; to: string };

/** Days in an inclusive range. */
const rangeDays = (range: { from: string; to: string }) =>
  (istDayStart(range.to).getTime() - istDayStart(range.from).getTime()) / 86_400_000 + 1;

/** An inclusive range of IST calendar dates. */
export const usageRangeSchema = withUsageRange({});

export type UsageRange = z.infer<typeof usageRangeSchema>;

const tokenShape = {
  requests: z.number().int(),
  inputTokens: z.number().int(),
  outputTokens: z.number().int(),
  cacheReadInputTokens: z.number().int(),
  cacheCreationInputTokens: z.number().int(),
  /** USD as decimal text, the exact sum of saved costs. */
  costUsd: z.string(),
};

/** One IST day's spend; every day of the range is listed, quiet days with zeros. */
export const usageDaySchema = z.object({ date: isoDate, ...tokenShape });

/** One set of prices a model was billed at (USD per million tokens), with how many requests used it. */
export const usagePriceSchema = z.object({
  inputUsdPerMtok: z.string(),
  outputUsdPerMtok: z.string(),
  cacheReadUsdPerMtok: z.string(),
  cacheWriteUsdPerMtok: z.string(),
  requests: z.number().int(),
});

/**
 * Spend per provider and model asked for (`requested_model`, the configured
 * model the provider bills under), with the prices that were saved, so a
 * wrong price is visible next to the provider's own console.
 */
export const usageModelSchema = z.object({
  provider: z.string(),
  model: z.string(),
  ...tokenShape,
  prices: z.array(usagePriceSchema),
});

export const usageSchoolSchema = z.object({
  schoolId: z.string(),
  /** Null when the school no longer exists. */
  schoolName: z.string().nullable(),
  requests: z.number().int(),
  costUsd: z.string(),
});

export const usageUserSchema = z.object({
  userId: z.string(),
  /** Null when the account was deleted; its costs are kept. */
  name: z.string().nullable(),
  email: z.string().nullable(),
  requests: z.number().int(),
  costUsd: z.string(),
});

export const assistantUsageSchema = z.object({
  from: isoDate,
  to: isoDate,
  total: z.object(tokenShape),
  days: z.array(usageDaySchema),
  models: z.array(usageModelSchema),
});

export type AssistantUsage = z.infer<typeof assistantUsageSchema>;

const sums = {
  requests: sql<number>`count(*)::int`,
  inputTokens: sql<number>`coalesce(sum(${assistantModelRequestTable.inputTokens}), 0)::int`,
  outputTokens: sql<number>`coalesce(sum(${assistantModelRequestTable.outputTokens}), 0)::int`,
  cacheReadInputTokens: sql<number>`coalesce(sum(${assistantModelRequestTable.cacheReadInputTokens}), 0)::int`,
  cacheCreationInputTokens: sql<number>`coalesce(sum(${assistantModelRequestTable.cacheCreationInputTokens}), 0)::int`,
  costUsd: sql<string>`coalesce(sum(${assistantModelRequestTable.costUsd}), 0)::text`,
};

const ZERO = { requests: 0, inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUsd: '0' };

/** The rows of a range (IST days, `to` inclusive), for one school or the platform. */
function rangeFilter(range: UsageRange, schoolId: string | null): SQL | undefined {
  const start = istDayStart(range.from);
  const end = new Date(istDayStart(range.to).getTime() + 86_400_000);
  return and(
    gte(assistantModelRequestTable.createdAt, start),
    lt(assistantModelRequestTable.createdAt, end),
    schoolId ? eq(assistantModelRequestTable.schoolId, schoolId) : undefined,
  );
}

/** Every IST date from `from` to `to`, inclusive. */
function datesOf(range: UsageRange): string[] {
  const dates: string[] = [];
  for (let day = istDayStart(range.from).getTime(); day <= istDayStart(range.to).getTime(); day += 86_400_000) {
    dates.push(istDate(new Date(day)));
  }
  return dates;
}

/** Postgres `numeric` sums come back with trailing zeros; shown as written. */
const trimUsd = (amount: string) => (amount.includes('.') ? amount.replace(/0+$/, '').replace(/\.$/, '') : amount);

async function computeUsage(db: DatabaseExecutor, range: UsageRange, schoolId: string | null): Promise<AssistantUsage> {
  const where = rangeFilter(range, schoolId);
  // The zone is a constant written into the statement, not a parameter:
  // grouping needs the select and group-by expressions to be identical.
  const istDay = sql<string>`to_char((${assistantModelRequestTable.createdAt} at time zone ${sql.raw(`'${IST_TIME_ZONE}'`)}), 'YYYY-MM-DD')`;
  const [totalRows, dayRows, modelRows, priceRows] = await Promise.all([
    db.select(sums).from(assistantModelRequestTable).where(where),
    db.select({ date: istDay, ...sums }).from(assistantModelRequestTable).where(where).groupBy(istDay),
    db
      .select({ provider: assistantModelRequestTable.provider, model: assistantModelRequestTable.requestedModel, ...sums })
      .from(assistantModelRequestTable)
      .where(where)
      .groupBy(assistantModelRequestTable.provider, assistantModelRequestTable.requestedModel)
      .orderBy(desc(sql`sum(${assistantModelRequestTable.costUsd})`), assistantModelRequestTable.requestedModel),
    db
      .select({
        provider: assistantModelRequestTable.provider,
        model: assistantModelRequestTable.requestedModel,
        inputUsdPerMtok: sql<string>`${assistantModelRequestTable.inputUsdPerMtok}::text`,
        outputUsdPerMtok: sql<string>`${assistantModelRequestTable.outputUsdPerMtok}::text`,
        cacheReadUsdPerMtok: sql<string>`${assistantModelRequestTable.cacheReadUsdPerMtok}::text`,
        cacheWriteUsdPerMtok: sql<string>`${assistantModelRequestTable.cacheWriteUsdPerMtok}::text`,
        requests: sql<number>`count(*)::int`,
      })
      .from(assistantModelRequestTable)
      .where(where)
      .groupBy(
        assistantModelRequestTable.provider,
        assistantModelRequestTable.requestedModel,
        assistantModelRequestTable.inputUsdPerMtok,
        assistantModelRequestTable.outputUsdPerMtok,
        assistantModelRequestTable.cacheReadUsdPerMtok,
        assistantModelRequestTable.cacheWriteUsdPerMtok,
      ),
  ]);
  const byDay = new Map(dayRows.map((row) => [row.date, row]));
  return {
    from: range.from,
    to: range.to,
    total: { ...ZERO, ...totalRows[0], costUsd: trimUsd(totalRows[0]?.costUsd ?? '0') },
    days: datesOf(range).map((date) => {
      const row = byDay.get(date);
      return row ? { ...row, date, costUsd: trimUsd(row.costUsd) } : { date, ...ZERO };
    }),
    models: modelRows.map((row) => ({
      ...row,
      costUsd: trimUsd(row.costUsd),
      prices: priceRows
        .filter((price) => price.provider === row.provider && price.model === row.model)
        .map(({ provider: _provider, model: _model, ...price }) => ({
          ...price,
          inputUsdPerMtok: trimUsd(price.inputUsdPerMtok),
          outputUsdPerMtok: trimUsd(price.outputUsdPerMtok),
          cacheReadUsdPerMtok: trimUsd(price.cacheReadUsdPerMtok),
          cacheWriteUsdPerMtok: trimUsd(price.cacheWriteUsdPerMtok),
        })),
    })),
  };
}

/**
 * Reuses a cached answer for an hour. Redis being unreachable only costs the
 * query; it never changes the answer.
 */
async function cached<T>(key: string, schema: z.ZodType<T>, compute: () => Promise<T>): Promise<T> {
  const redis = getRedisClient();
  const hit = await redis.get(key).catch(() => null);
  if (hit) {
    const parsed = schema.safeParse(JSON.parse(hit));
    if (parsed.success) return parsed.data;
  }
  const value = await compute();
  await redis.set(key, JSON.stringify(value), 'EX', USAGE_CACHE_SECONDS).catch(() => undefined);
  return value;
}

/** A school's assistant spend over a range of IST days. */
export function schoolAssistantUsage(db: DatabaseExecutor, schoolId: string, range: UsageRange) {
  return cached(`assistant:usage:school:${schoolId}:${range.from}:${range.to}`, assistantUsageSchema, () =>
    computeUsage(db, range, schoolId),
  );
}

export const schoolAssistantUsageDetailSchema = assistantUsageSchema.extend({
  /** The school's members who spent the most in the range, at most ten. */
  users: z.array(usageUserSchema),
});

/** A school's spend with its top users, for platform administrators. */
export function schoolAssistantUsageDetail(db: DatabaseExecutor, schoolId: string, range: UsageRange) {
  return cached(`assistant:usage:school-detail:${schoolId}:${range.from}:${range.to}`, schoolAssistantUsageDetailSchema, async () => {
    const [usage, users] = await Promise.all([
      computeUsage(db, range, schoolId),
      db
        .select({
          userId: assistantModelRequestTable.userId,
          name: userTable.name,
          email: userTable.email,
          requests: sums.requests,
          costUsd: sums.costUsd,
        })
        .from(assistantModelRequestTable)
        .leftJoin(userTable, eq(userTable.id, assistantModelRequestTable.userId))
        .where(rangeFilter(range, schoolId))
        .groupBy(assistantModelRequestTable.userId, userTable.name, userTable.email)
        .orderBy(desc(sql`sum(${assistantModelRequestTable.costUsd})`), assistantModelRequestTable.userId)
        .limit(10),
    ]);
    return { ...usage, users: users.map((row) => ({ ...row, costUsd: trimUsd(row.costUsd) })) };
  });
}

export const platformAssistantUsageSchema = assistantUsageSchema.extend({
  /** Every school with spend in the range, most first. */
  schools: z.array(usageSchoolSchema),
});

/** The platform's assistant spend (every school), per day, per model and per school. */
export function platformAssistantUsage(db: DatabaseExecutor, range: UsageRange) {
  return cached(`assistant:usage:platform:${range.from}:${range.to}`, platformAssistantUsageSchema, async () => {
    const [usage, schools] = await Promise.all([
      computeUsage(db, range, null),
      db
        .select({
          schoolId: assistantModelRequestTable.schoolId,
          schoolName: schoolTable.name,
          requests: sums.requests,
          costUsd: sums.costUsd,
        })
        .from(assistantModelRequestTable)
        .leftJoin(schoolTable, eq(schoolTable.id, assistantModelRequestTable.schoolId))
        .where(rangeFilter(range, null))
        .groupBy(assistantModelRequestTable.schoolId, schoolTable.name)
        .orderBy(desc(sql`sum(${assistantModelRequestTable.costUsd})`), assistantModelRequestTable.schoolId),
    ]);
    return { ...usage, schools: schools.map((row) => ({ ...row, costUsd: trimUsd(row.costUsd) })) };
  });
}
