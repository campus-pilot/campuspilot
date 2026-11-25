import { ORPCError } from '@orpc/server';
import type { Database, DatabaseExecutor } from '@campuspilot/db';
import { account, user } from '@campuspilot/db/schema/auth';
import { schoolTable } from '@campuspilot/db/schema/school';
import { and, eq } from 'drizzle-orm';

import { generateId } from '@campuspilot/db/id';

import { rpcError } from '../errors';
import { lockUser } from '../school-creation/school-creation.service';
import { provisionSelfServiceSchool } from '../school-creation/school-provisioning';
import { errorFacts } from '@campuspilot/logger/error-facts';

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
 * - on request (`personalSpace.create`), for someone with a linked Google
 *   account who has never had one, whether or not they belong to a school:
 *   from the "You are not part of a school yet" page and from the school
 *   switcher, so a person who signed up before personal spaces, or joined a
 *   school first, opens theirs when they want it (its trial starts then).
 */

/**
 * A personal space's slug: `personal-` and the random part of a fresh id, so
 * it never holds the person's name and needs no search for a free one.
 */
export function personalSpaceSlug(): string {
  return `personal-${generateId('school').split('_').pop()!}`;
}

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
  const [person] = await db
    .select({ demoSchoolId: user.demoSchoolId, personalSpaceCreatedAt: user.personalSpaceCreatedAt })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  if (!person) throw rpcError.unauthorized();
  const [[google], [personal]] = await Promise.all([
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
  ]);
  const refusal: PersonalSpaceRefusal | null =
    person.demoSchoolId !== null
      ? 'demo_account'
      : !google
        ? 'no_google_account'
        : // Decided from the permanent fact, not from the space's row: a deleted space was still the person's one.
          person.personalSpaceCreatedAt !== null
          ? 'already_has_one'
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
 * 2. provisions it with `provisionSelfServiceSchool`, the start shared with
 *    a self-created school (the same trial, the assistant with the
 *    self-service limit, the person as owner and principal), as kind
 *    `personal`, named by `personalSpaceName`, with a `personalSpaceSlug`
 *    that does not carry the name and no town (`location` is empty: a
 *    personal space prints nothing of its own).
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
  // The shared start of every self-provisioned school (trial, assistant, owner as principal). A personal space's slug
  // never carries the person's name (it is public in a sign-in link, docs/personal-space.md): `personal-` and a random
  // id, unique by construction, so it is inserted once.
  const { schoolId } = await provisionSelfServiceSchool(db, {
    ownerUserId: input.userId,
    now: input.now,
    school: { kind: 'personal', name: personalSpaceName(person?.name), location: '', registrationNo: null, slug: { exact: personalSpaceSlug() } },
  });
  // The permanent fact that the person had their one personal space, in the same transaction; never cleared.
  await db.update(user).set({ personalSpaceCreatedAt: input.now }).where(eq(user.id, input.userId));
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
    // Only safe facts of the error: a database error's message carries the query's values, the person's name among them.
    log.error({ ...errorFacts(error), userId }, 'personal-space.create-after-sign-up.failed');
  }
}
