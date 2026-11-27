import type { DatabaseExecutor } from '@campuspilot/db';
import { user as userTable } from '@campuspilot/db/schema/auth';
import { assistantModelRequestTable } from '@campuspilot/db/schema/assistant';
import { and, desc, eq, gte, lt, sql } from 'drizzle-orm';
import { z } from 'zod';

import { getSchoolFeatureConfig } from '../feature-flags/feature-flags.service';
import { staffIdentityColumns, toStaffIdentity } from '../users/staff-identity';
import type { AssistantAccessDecision } from './access';
import { spendPercentOfLimit } from './money';
import { readSchoolWindowSpend, schoolSpendWindow, SPEND_CACHE_SECONDS } from './spend';

/**
 * A school's AI allowance as the school sees it: the share of its current
 * spend window's limit used, in percent, never the dollars behind it
 * (docs/school-billing.md, "The AI limit counts per period"). The window and
 * the total are the ones the limit check uses (`schoolSpendWindow`,
 * `readSchoolWindowSpend`), so the meter reads 100% exactly when the
 * assistant refuses. The admin app keeps its dollar views (`usage.ts`).
 */

/** One person's share of the allowance this window. */
export const allowanceUserSchema = z.object({
  userId: z.string(),
  /** Null when the account was deleted; what it used still counts. */
  name: z.string().nullable(),
  /** Null for a phone-only account (its stored address is a placeholder) and deleted accounts (`toStaffIdentity`). */
  email: z.string().nullable(),
  /** Sign-in phone number in E.164, or null. */
  phoneNumber: z.string().nullable(),
  /** Their spend this window as a percentage of the limit, rounded down to one decimal (`spendPercentOfLimit`). */
  usedPercent: z.number(),
});

export const schoolAssistantAllowanceSchema = z.object({
  /** Whether the school has an AI limit at all. Without one there is no percentage to show. */
  limited: z.boolean(),
  /**
   * The school's spend this window as a percentage of its limit, rounded down
   * to one decimal: 100 or more exactly when the limit is reached. Not capped
   * (spend may pass the limit by what the spend cache let through). Null
   * without a limit.
   */
  usedPercent: z.number().nullable(),
  /** When the current window began. */
  windowStart: z.date(),
  /** When it ends (exclusive): the allowance resets then. */
  windowEnd: z.date(),
  /**
   * How old `usedPercent` may be, in seconds: it is the limit check's cached
   * total (`SPEND_CACHE_SECONDS`). The cache holds only the sum, so its exact
   * age is not known; the screen says "within the last 10 minutes".
   */
  maxAgeSeconds: z.number().int(),
  /**
   * Everyone who used the assistant this window, largest share first, people
   * who since left the school and deleted accounts included. Empty without a
   * limit. Read fresh from the saved rows while `usedPercent` may be cached,
   * so the shares can add up to slightly more than the total.
   */
  users: z.array(allowanceUserSchema),
});

export type SchoolAssistantAllowance = z.infer<typeof schoolAssistantAllowanceSchema>;

/**
 * Reads a school's allowance (see {@link schoolAssistantAllowanceSchema}).
 * The limit comes from the assistant feature's config (CONFLICT when that is
 * unusable, like every config reader).
 */
export async function readSchoolAssistantAllowance(
  db: DatabaseExecutor,
  schoolId: string,
  now: Date = new Date(),
): Promise<SchoolAssistantAllowance> {
  const limitUsd = (await getSchoolFeatureConfig(db, schoolId, 'assistant'))?.monthlyLimitUsd ?? null;
  if (limitUsd === null) {
    const window = await schoolSpendWindow(db, schoolId, now);
    return {
      limited: false,
      usedPercent: null,
      windowStart: window.start,
      windowEnd: window.end,
      maxAgeSeconds: SPEND_CACHE_SECONDS,
      users: [],
    };
  }
  const spend = await readSchoolWindowSpend(db, schoolId, now);
  const userSpend = sql<string>`coalesce(sum(${assistantModelRequestTable.costUsd}), 0)::text`;
  const rows = await db
    .select({
      userId: assistantModelRequestTable.userId,
      name: userTable.name,
      ...staffIdentityColumns,
      spendUsd: userSpend,
    })
    .from(assistantModelRequestTable)
    // No foreign key on `user_id`: a deleted account's spend stays, without a name.
    .leftJoin(userTable, eq(userTable.id, assistantModelRequestTable.userId))
    .where(
      and(
        eq(assistantModelRequestTable.schoolId, schoolId),
        gte(assistantModelRequestTable.createdAt, spend.start),
        lt(assistantModelRequestTable.createdAt, spend.end),
      ),
    )
    .groupBy(assistantModelRequestTable.userId, userTable.name, userTable.email, userTable.emailIsPlaceholder, userTable.phoneNumber)
    .orderBy(desc(sql`sum(${assistantModelRequestTable.costUsd})`), assistantModelRequestTable.userId);
  return {
    limited: true,
    usedPercent: spendPercentOfLimit(spend.spendUsd, limitUsd),
    windowStart: spend.start,
    windowEnd: spend.end,
    maxAgeSeconds: SPEND_CACHE_SECONDS,
    users: rows.map((row) => ({
      userId: row.userId,
      name: row.name,
      // A deleted account has no identity left to show.
      ...(row.email === null || row.emailIsPlaceholder === null
        ? { email: null, phoneNumber: null }
        : toStaffIdentity({ email: row.email, emailIsPlaceholder: row.emailIsPlaceholder, phoneNumber: row.phoneNumber })),
      usedPercent: spendPercentOfLimit(row.spendUsd, limitUsd),
    })),
  };
}

/** The allowance an assistant user sees in the panel: the school's share used and when it resets. */
export type AssistantAllowance = { usedPercent: number; resetsAt: Date };

/**
 * The allowance for someone who may see the assistant, from their access
 * decision: null without a limit. The decision's own spend
 * (`windowSpend`) is used when it read one, so the percentage is the figure
 * the decision was made from; a decision that stopped before the limit check
 * (a read-only school) reads the same cached total once more.
 */
export async function assistantAllowanceOf(
  db: DatabaseExecutor,
  schoolId: string,
  decision: AssistantAccessDecision,
): Promise<AssistantAllowance | null> {
  if (!decision.limit.known || decision.limit.monthlyLimitUsd === null) return null;
  const spend = decision.windowSpend ?? (await readSchoolWindowSpend(db, schoolId));
  return { usedPercent: spendPercentOfLimit(spend.spendUsd, decision.limit.monthlyLimitUsd), resetsAt: spend.end };
}
