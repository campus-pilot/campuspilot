import { schoolMemberTable } from '@campuspilot/db/schema/school-member';
import { and, eq } from 'drizzle-orm';

import type { Context } from '../context';
import { rpcError } from '../errors';
import { o } from '../index';

/**
 * Requires the signed-in user to be a current member of the school, without
 * asking for any particular permission, and returns their user id. Used for
 * reads every member needs whatever their role (their own inbox, which
 * features the school has). Anonymous callers get UNAUTHORIZED, everyone
 * else who is not a member FORBIDDEN, including platform administrators who
 * are not members of the school.
 */
export async function assertSchoolMember(
  context: Pick<Context, 'db' | 'session'>,
  schoolId: string,
): Promise<string> {
  const userId = context.session?.user.id;
  if (!userId) throw rpcError.unauthorized();
  const [membership] = await context.db
    .select({ userId: schoolMemberTable.userId })
    .from(schoolMemberTable)
    .where(and(eq(schoolMemberTable.schoolId, schoolId), eq(schoolMemberTable.userId, userId)))
    .limit(1);
  if (!membership) throw rpcError.forbidden();
  return userId;
}

/** Input-aware middleware form of {@link assertSchoolMember}. */
export function requireSchoolMember<TInput extends { schoolId: string }>() {
  return o.middleware<Record<never, never>, TInput>(async ({ context, next }, input) => {
    await assertSchoolMember(context, input.schoolId);
    return next();
  });
}
