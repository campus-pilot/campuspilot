import { ORPCError } from '@orpc/server';
import type { Database, DatabaseExecutor } from '@campuspilot/db';
import { account, user } from '@campuspilot/db/schema/auth';
import { schoolTable } from '@campuspilot/db/schema/school';
import { schoolMemberTable } from '@campuspilot/db/schema/school-member';
import { schoolUserRoleTable } from '@campuspilot/db/schema/school-user-role';
import { and, eq } from 'drizzle-orm';

import { rpcError } from '../errors';
import { setSchoolFeature } from '../feature-flags/feature-flags.service';
import { addBillingPeriods } from '../billing/billing.contract';
import { startTrialPeriod } from '../billing/billing.service';
import { lockUser } from '../school-creation/school-creation.service';
import {
  SELF_SERVICE_ASSISTANT_MONTHLY_LIMIT_USD,
  SELF_SERVICE_TRIAL_PERIODS,
  SELF_SERVICE_TRIAL_TIER,
} from '../school-creation/school-creation.contract';
import { uniqueSlug } from '../workflows/demo-school/identity';
import { slugifySchoolName } from '../workflows/demo-school/slug';
import { log } from './log';
import {
  PERSONAL_SPACE_REFUSAL_MESSAGES,
  PERSONAL_SPACE_REFUSED_REASON,
  personalSpaceName,
  type PersonalSpaceRefusal,
} from './personal-space.contract';

/**
 * Personal spaces (docs/personal-space.md): who may get one and creating it.
 * Two ways create one, through the same {@link createPersonalSpace}:
 * - automatically, right after a new account signs up with Google
 *   ({@link createPersonalSpaceAfterGoogleSignUp}, run by the Better Auth hook
 *   `apps/server` registers);
 * - on request, from the "You are not part of a school yet" page
 *   (`personalSpace.create`), for someone with a linked Google account and no
 *   school at all.
 */

/** The facts a personal space is decided from, and the decision. */
export type PersonalSpaceStatus = {
  /** The person's personal space; null when they have none. */
  schoolId: string | null;
  /** Why they may not get one now; null when they may. */
  refusal: PersonalSpaceRefusal | null;
};

/**
 * Reads the facts and decides (the order of refusals is in
 * `personal-space.contract.ts`). Inside a creation, call it after
 * {@link lockUser} so the decision holds until commit.
 */
export async function readPersonalSpaceStatus(db: DatabaseExecutor, userId: string): Promise<PersonalSpaceStatus> {
  const [person] = await db.select({ demoSchoolId: user.demoSchoolId }).from(user).where(eq(user.id, userId)).limit(1);
  if (!person) throw rpcError.unauthorized();
  const [[google], [personal], [membership]] = await Promise.all([
    db
      .select({ id: account.id })
      .from(account)
      .where(and(eq(account.userId, userId), eq(account.providerId, 'google')))
      .limit(1),
    db
      .select({ id: schoolTable.id })
      .from(schoolTable)
      .where(and(eq(schoolTable.ownerUserId, userId), eq(schoolTable.kind, 'personal')))
      .limit(1),
    db.select({ schoolId: schoolMemberTable.schoolId }).from(schoolMemberTable).where(eq(schoolMemberTable.userId, userId)).limit(1),
  ]);
  const refusal: PersonalSpaceRefusal | null =
    person.demoSchoolId !== null
      ? 'demo_account'
      : !google
        ? 'no_google_account'
        : personal
          ? 'already_has_one'
          : membership
            ? 'member_of_school'
            : null;
  return { schoolId: personal?.id ?? null, refusal };
}

/** The FORBIDDEN error for a refused creation; `data` carries the refusal for clients. */
export function personalSpaceRefusedError(refusal: PersonalSpaceRefusal) {
  return new ORPCError('FORBIDDEN', {
    message: PERSONAL_SPACE_REFUSAL_MESSAGES[refusal],
    data: { reason: PERSONAL_SPACE_REFUSED_REASON, refusal },
  });
}

/**
 * Creates the person's personal space, in the caller's transaction:
 *
 * 1. locks the person and checks they may get one (refused with
 *    {@link personalSpaceRefusedError});
 * 2. inserts the school of kind `personal`, named by `personalSpaceName`,
 *    with the person as owner, no standing tier and no town (`location` is
 *    empty: a personal space prints nothing of its own);
 * 3. starts the same trial a self-created school gets
 *    (`SELF_SERVICE_TRIAL_TIER` for `SELF_SERVICE_TRIAL_PERIODS` billing
 *    period), after which it is read-only like any school;
 * 4. switches the assistant on with the self-service limit, which the
 *    standalone papers need;
 * 5. makes the person a member with the principal role.
 *
 * It writes no `school_creation` row (the space does not use the allowance)
 * and offers no guided setup (a personal space has no sessions or classes).
 */
export async function createPersonalSpace(
  db: DatabaseExecutor,
  input: { userId: string; now: Date },
): Promise<{ schoolId: string }> {
  await lockUser(db, input.userId);
  const status = await readPersonalSpaceStatus(db, input.userId);
  if (status.refusal) throw personalSpaceRefusedError(status.refusal);
  const [person] = await db.select({ name: user.name }).from(user).where(eq(user.id, input.userId)).limit(1);
  const name = personalSpaceName(person?.name);

  const created: { id?: string } = {};
  await uniqueSlug(slugifySchoolName(name) || 'personal', async (candidate) => {
    const [row] = await db
      .insert(schoolTable)
      .values({ slug: candidate, name, location: '', registrationNo: null, tier: null, ownerUserId: input.userId, kind: 'personal' })
      .onConflictDoNothing({ target: schoolTable.slug })
      .returning({ id: schoolTable.id });
    created.id = row?.id;
    return row === undefined;
  });
  if (!created.id) throw rpcError.internal();
  const schoolId = created.id;

  await startTrialPeriod(db, {
    schoolId,
    tier: SELF_SERVICE_TRIAL_TIER,
    endsAt: addBillingPeriods(input.now, SELF_SERVICE_TRIAL_PERIODS),
    createdBy: input.userId,
  });
  // A system write (no administrator made it), hence no `updatedBy`.
  await setSchoolFeature(db, {
    schoolId,
    feature: 'assistant',
    enabled: true,
    config: { monthlyLimitUsd: SELF_SERVICE_ASSISTANT_MONTHLY_LIMIT_USD, voice: { enabled: false } },
    updatedBy: null,
  });
  await db.insert(schoolMemberTable).values({ schoolId, userId: input.userId });
  await db.insert(schoolUserRoleTable).values({ schoolId, userId: input.userId, role: 'principal', meta: null });
  return { schoolId };
}

/**
 * The automatic path: called right after Better Auth created a new account
 * through a Google sign-in (the hook decides that from the endpoint; see
 * `isGoogleSignUpEndpoint` in `@campuspilot/auth`). It runs after the user
 * and their Google account are committed, so {@link createPersonalSpace}
 * reads the linked Google account like the manual path does. A refusal
 * (a demo account, an account that is already a member somewhere) creates
 * nothing and is not an error. Any failure is logged and swallowed: a
 * personal space must never stop someone from signing in, and the person can
 * still create it from the "not part of a school" page.
 */
export async function createPersonalSpaceAfterGoogleSignUp(db: Database, userId: string): Promise<void> {
  try {
    const created = await db.transaction(async (tx) => {
      await lockUser(tx, userId);
      const status = await readPersonalSpaceStatus(tx, userId);
      if (status.refusal) return null;
      return createPersonalSpace(tx, { userId, now: new Date() });
    });
    if (created) log.info({ userId, schoolId: created.schoolId }, 'personal-space.created');
  } catch (error) {
    log.error({ err: error, userId }, 'personal-space.create-after-sign-up.failed');
  }
}
