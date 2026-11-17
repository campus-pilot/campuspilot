import type { DatabaseExecutor } from '@campuspilot/db';
import { schoolTable } from '@campuspilot/db/schema/school';
import { schoolMemberTable } from '@campuspilot/db/schema/school-member';
import { ORPCError } from '@orpc/server';
import { and, eq, isNotNull } from 'drizzle-orm';

import type { Context } from '../context';
import {
  SCHOOL_SUSPENDED_MESSAGE,
  SCHOOL_SUSPENDED_REASON,
  type SchoolSuspendedData,
} from './school-suspension.contract';

/**
 * School suspension (docs/school-suspension.md). A platform administrator
 * suspends a school that misuses the platform; the school is then
 * **read-only**: its staff and students still sign in and read everything,
 * and every change is refused with {@link schoolSuspendedError}. Nothing is
 * deleted or hidden, and lifting the suspension restores everything at once.
 *
 * "Suspended" is one fact, `school.suspended_at`, and every enforcement
 * point asks it through this file so they cannot drift apart:
 * - staff procedures: `assertSchoolWritableByCaller`, from the `requireAuth`
 *   middleware of every protected procedure that is not a read;
 * - Cadet Portal procedures: `assertSchoolNotSuspended`, from
 *   `cadetProcedure` for every procedure that is not a read;
 * - upload routes outside oRPC and the assistant's access decision call
 *   `isSchoolSuspended` / `assertSchoolNotSuspended` themselves.
 */

/**
 * The one error every surface throws for a change asked of a suspended
 * school: FORBIDDEN with `data: { reason: 'SCHOOL_SUSPENDED' }`. A plain
 * permission denial is FORBIDDEN without that data, so clients tell the two
 * apart (`isSchoolSuspendedError`) without parsing the message.
 */
export function schoolSuspendedError() {
  return new ORPCError('FORBIDDEN', {
    message: SCHOOL_SUSPENDED_MESSAGE,
    data: { reason: SCHOOL_SUSPENDED_REASON } satisfies SchoolSuspendedData,
  });
}

/** Whether the school is suspended now. A school that does not exist is not. */
export async function isSchoolSuspended(db: DatabaseExecutor, schoolId: string): Promise<boolean> {
  const [school] = await db
    .select({ id: schoolTable.id })
    .from(schoolTable)
    .where(and(eq(schoolTable.id, schoolId), isNotNull(schoolTable.suspendedAt)))
    .limit(1);
  return school !== undefined;
}

/**
 * Throws the suspended-school error when the school is suspended. For
 * callers that have already established who is asking (the Cadet Portal,
 * whose school comes from the login; upload routes after their permission
 * check).
 */
export async function assertSchoolNotSuspended(db: DatabaseExecutor, schoolId: string): Promise<void> {
  if (await isSchoolSuspended(db, schoolId)) throw schoolSuspendedError();
}

/**
 * Refuses a staff change to a suspended school. Runs before the procedure's
 * own permission checks (it is part of `requireAuth`), so it must not tell
 * an outsider anything: only a **member** of the school gets the suspended
 * error. Anyone else falls through to the permission check, which answers
 * them exactly as for a school that is not suspended.
 *
 * It holds the school's members, whoever they are, and decides from
 * membership and the suspension alone (no permission is involved, so it
 * needs no policy decision). A platform administrator works on a school
 * through platform grants without being a member, and is therefore not
 * held: the platform can still correct a suspended school's data. An
 * administrator who is also a member (the principal of a demo school they
 * created) is held like every member and lifts the suspension first; one
 * impersonating a staff member acts as that member and is refused like
 * them.
 */
export async function assertSchoolWritableByCaller(context: Pick<Context, 'db' | 'session'>, schoolId: string): Promise<void> {
  const userId = context.session?.user.id;
  if (!userId) return;
  const [suspended] = await context.db
    .select({ id: schoolTable.id })
    .from(schoolTable)
    .innerJoin(
      schoolMemberTable,
      and(eq(schoolMemberTable.schoolId, schoolTable.id), eq(schoolMemberTable.userId, userId)),
    )
    .where(and(eq(schoolTable.id, schoolId), isNotNull(schoolTable.suspendedAt)))
    .limit(1);
  if (suspended) throw schoolSuspendedError();
}
