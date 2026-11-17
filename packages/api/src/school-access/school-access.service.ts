import type { DatabaseExecutor } from '@campuspilot/db';
import { resolveSchoolPlan, type SchoolTier } from '@campuspilot/db/feature-flags/catalogue';
import { activeSchoolTrialCondition, type ActiveSchoolTrial } from '@campuspilot/db/feature-flags/store';
import { schoolTable } from '@campuspilot/db/schema/school';
import { schoolMemberTable } from '@campuspilot/db/schema/school-member';
import { schoolTrialTable } from '@campuspilot/db/schema/school-trial';
import { ORPCError } from '@orpc/server';
import { and, eq } from 'drizzle-orm';

import type { Context } from '../context';
import {
  SCHOOL_NO_PLAN_REASON,
  SCHOOL_SUSPENDED_REASON,
  SCHOOL_WRITE_REFUSAL_MESSAGES,
  type SchoolWriteRefusalReason,
  type SchoolWriteRefusedData,
} from './school-access.contract';

/**
 * Whether a school's own people may change its data
 * (docs/school-suspension.md, docs/school-trials.md). A school is
 * **read-only** while either of two separate facts holds:
 * - an administrator suspended it (`school.suspended_at`);
 * - it has no active plan: no subscribed tier and no active trial
 *   (`resolveSchoolPlan` gives no tier).
 * Its staff and students then still sign in and read everything, and every
 * change is refused with {@link schoolWriteRefusedError}. Nothing is deleted
 * or hidden.
 *
 * Every enforcement point decides through this file so they cannot drift
 * apart:
 * - staff procedures: `assertSchoolWritableByCaller`, from the `requireAuth`
 *   middleware of every protected procedure that is not a read;
 * - Cadet Portal procedures: `assertSchoolWritable`, from `cadetProcedure`
 *   for every procedure that is not a read;
 * - upload routes outside oRPC call `assertSchoolWritableByCaller`, and the
 *   assistant's access decision reads {@link readSchoolWriteFacts}.
 */

/** The two facts that make a school read-only, read together. */
export type SchoolWriteFacts = {
  /** An administrator suspended the school. */
  suspended: boolean;
  /** The school has a subscribed tier or an active trial. */
  hasActivePlan: boolean;
};

/**
 * Why a change to the school is refused, or null when it is not. The one
 * decision: a suspension wins when both apply, because it is the
 * administrator's deliberate act and lifting it alone would still leave the
 * school without a plan to explain.
 */
export function resolveSchoolWriteRefusal(facts: SchoolWriteFacts): SchoolWriteRefusalReason | null {
  if (facts.suspended) return SCHOOL_SUSPENDED_REASON;
  if (!facts.hasActivePlan) return SCHOOL_NO_PLAN_REASON;
  return null;
}

/**
 * The one error every surface throws for a change asked of a read-only
 * school: FORBIDDEN with `data: { reason }`. A plain permission denial is
 * FORBIDDEN without that data, so clients tell them apart
 * (`schoolWriteRefusalOf`) without parsing the message.
 */
export function schoolWriteRefusedError(reason: SchoolWriteRefusalReason) {
  return new ORPCError('FORBIDDEN', {
    message: SCHOOL_WRITE_REFUSAL_MESSAGES[reason],
    data: { reason } satisfies SchoolWriteRefusedData,
  });
}

/** The refusal for a suspended school. */
export function schoolSuspendedError() {
  return schoolWriteRefusedError(SCHOOL_SUSPENDED_REASON);
}

/** The refusal for a school without an active plan. */
export function schoolNoPlanError() {
  return schoolWriteRefusedError(SCHOOL_NO_PLAN_REASON);
}

/**
 * The school's write facts, read in one query, or null when there is
 * nothing to hold: the school does not exist or, with `memberUserId`, that
 * user is not a member of it.
 */
export async function readSchoolWriteFacts(
  db: DatabaseExecutor,
  schoolId: string,
  options: { memberUserId?: string } = {},
): Promise<SchoolWriteFacts | null> {
  const base = db
    .select({ suspendedAt: schoolTable.suspendedAt, subscribedTier: schoolTable.tier, trialTier: schoolTrialTable.tier })
    .from(schoolTable)
    .leftJoin(schoolTrialTable, and(eq(schoolTrialTable.schoolId, schoolTable.id), activeSchoolTrialCondition()))
    .$dynamic();
  const query =
    options.memberUserId === undefined
      ? base
      : base.innerJoin(
          schoolMemberTable,
          and(eq(schoolMemberTable.schoolId, schoolTable.id), eq(schoolMemberTable.userId, options.memberUserId)),
        );
  const [row] = await query.where(eq(schoolTable.id, schoolId)).limit(1);
  if (!row) return null;
  const plan = resolveSchoolPlan({
    subscribedTier: row.subscribedTier,
    activeTrial: row.trialTier === null ? null : { tier: row.trialTier },
  });
  return { suspended: row.suspendedAt !== null, hasActivePlan: plan.tier !== null };
}

/** Whether the school is suspended now. A school that does not exist is not. */
export async function isSchoolSuspended(db: DatabaseExecutor, schoolId: string): Promise<boolean> {
  return (await readSchoolWriteFacts(db, schoolId))?.suspended ?? false;
}

/**
 * Throws the read-only school error when a change to the school is refused.
 * For callers that have already established who is asking (the Cadet
 * Portal, whose school comes from the login). A school that does not exist
 * is not held here; the caller's own lookup answers it.
 */
export async function assertSchoolWritable(db: DatabaseExecutor, schoolId: string): Promise<void> {
  const facts = await readSchoolWriteFacts(db, schoolId);
  const refusal = facts && resolveSchoolWriteRefusal(facts);
  if (refusal) throw schoolWriteRefusedError(refusal);
}

/**
 * Refuses a staff change to a read-only school. Runs before the procedure's
 * own permission checks (it is part of `requireAuth`), so it must not tell
 * an outsider anything: only a **member** of the school gets the refusal.
 * Anyone else falls through to the permission check, which answers them
 * exactly as for a school that may be changed.
 *
 * It holds the school's members, whoever they are, and decides from
 * membership and the two facts alone (no permission is involved, so it needs
 * no policy decision). A platform administrator works on a school through
 * platform grants without being a member, and is therefore not held: the
 * platform can still correct a read-only school's data. An administrator who
 * is also a member (the principal of a demo school they created) is held like
 * every member; one impersonating a staff member acts as that member and is
 * refused like them.
 */
export async function assertSchoolWritableByCaller(context: Pick<Context, 'db' | 'session'>, schoolId: string): Promise<void> {
  const userId = context.session?.user.id;
  if (!userId) return;
  const facts = await readSchoolWriteFacts(context.db, schoolId, { memberUserId: userId });
  const refusal = facts && resolveSchoolWriteRefusal(facts);
  if (refusal) throw schoolWriteRefusedError(refusal);
}

/**
 * What the school's own apps show about its plan, as separate facts
 * (docs/school-trials.md): whether it has an active plan (a subscription or
 * an active trial; without one it is read-only), and when the trial ends
 * while a trial gives the plan (null otherwise, also when a trial runs
 * below the subscription and changes nothing).
 */
export function schoolPlanFactsOf(input: {
  subscribedTier: SchoolTier | null;
  trial: Pick<ActiveSchoolTrial, 'tier' | 'endsAt'> | null;
}): { hasActivePlan: boolean; trialEndsAt: string | null } {
  const plan = resolveSchoolPlan({ subscribedTier: input.subscribedTier, activeTrial: input.trial });
  return {
    hasActivePlan: plan.tier !== null,
    trialEndsAt: plan.source === 'trial' && input.trial ? input.trial.endsAt.toISOString() : null,
  };
}
