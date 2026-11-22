import { ORPCError } from '@orpc/server';
import type { DatabaseExecutor } from '@campuspilot/db';
import { user } from '@campuspilot/db/schema/auth';
import { schoolTable } from '@campuspilot/db/schema/school';
import {
  schoolCreationRequestTable,
  schoolCreationTable,
} from '@campuspilot/db/schema/school-creation';
import { schoolMemberTable } from '@campuspilot/db/schema/school-member';
import { and, count, desc, eq, sql } from 'drizzle-orm';

import { rpcError } from '../errors';
import { provisionSelfServiceSchool } from './school-provisioning';
import { slugifySchoolName } from '../workflows/demo-school/slug';
import { offerSchoolOnboarding } from '../school-onboarding/school-onboarding.service';
import {
  SCHOOL_CREATION_REFUSAL_MESSAGES,
  SCHOOL_CREATION_REFUSED_REASON,
  SELF_SERVICE_TRIAL_PERIODS,
  SELF_SERVICE_TRIAL_TIER,
  type SchoolCreationRefusal,
} from './school-creation.contract';

/**
 * Self-service school creation (docs/school-creation.md): who may create a
 * school, the creation itself, and requests for a larger allowance.
 */

/** The facts a person's school creation is decided from, and the decision. */
export type SchoolCreationStatus = {
  /** Schools the person may create over the life of the account. */
  limit: number;
  /** Schools the person has created, including deleted, handed over or left ones. */
  used: number;
  /** Why the person may not create a school now; null when they may. */
  refusal: SchoolCreationRefusal | null;
};

/**
 * Reads the person's allowance and decides whether they may create a school
 * (the order of refusals is in `school-creation.contract.ts`). Inside a
 * creation, call it after {@link lockUser} so the decision holds until commit.
 */
export async function readSchoolCreationStatus(
  db: DatabaseExecutor,
  userId: string,
): Promise<SchoolCreationStatus> {
  const [account] = await db
    .select({
      limit: user.schoolCreationLimit,
      demoSchoolId: user.demoSchoolId,
      emailVerified: user.emailVerified,
      emailIsPlaceholder: user.emailIsPlaceholder,
    })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  if (!account) throw rpcError.unauthorized();

  const [created] = await db
    .select({ used: count() })
    .from(schoolCreationTable)
    .where(eq(schoolCreationTable.userId, userId));
  const used = created?.used ?? 0;

  // Owning a school is the only membership that does not stop someone from
  // creating another; any school they were added to by someone else does.
  const [otherSchool] = await db
    .select({ schoolId: schoolMemberTable.schoolId })
    .from(schoolMemberTable)
    .innerJoin(schoolTable, eq(schoolTable.id, schoolMemberTable.schoolId))
    .where(and(eq(schoolMemberTable.userId, userId), sql`${schoolTable.ownerUserId} is distinct from ${userId}`))
    .limit(1);

  const refusal: SchoolCreationRefusal | null =
    account.demoSchoolId !== null
      ? 'demo_account'
      : !account.emailVerified || account.emailIsPlaceholder
        ? 'unverified_email'
        : otherSchool
          ? 'member_of_other_school'
          : used >= account.limit
            ? 'limit_reached'
            : null;
  return { limit: account.limit, used, refusal };
}

/**
 * Locks the person's account row until the transaction ends, so two
 * creations (or a creation and an approval) for one person run one after the
 * other and the allowance cannot be overspent by sending requests in parallel.
 */
export async function lockUser(db: DatabaseExecutor, userId: string): Promise<void> {
  await db.execute(sql`select ${user.id} from ${user} where ${user.id} = ${userId} for update`);
}

/** The FORBIDDEN error for a refused creation; `data` carries the refusal for clients. */
export function schoolCreationRefusedError(refusal: SchoolCreationRefusal) {
  return new ORPCError('FORBIDDEN', {
    message: SCHOOL_CREATION_REFUSAL_MESSAGES[refusal],
    data: { reason: SCHOOL_CREATION_REFUSED_REASON, refusal },
  });
}

export type CreateOwnSchoolInput = {
  userId: string;
  name: string;
  location: string;
  registrationNo: string | null;
  now: Date;
};

/**
 * Creates a school for the person, in the caller's transaction:
 *
 * 1. locks the person and checks they may create one (refused with
 *    {@link schoolCreationRefusedError});
 * 2. to 5. are `provisionSelfServiceSchool`, shared with personal spaces:
 * 2. inserts the school (kind `school`, slug from its name) with the person
 *    as owner and no subscription;
 * 3. starts a {@link SELF_SERVICE_TRIAL_TIER} trial of
 *    {@link SELF_SERVICE_TRIAL_PERIODS} billing period (28 days), which is
 *    where the school's billing cycle begins: it ends on its own and the
 *    school is then read-only until an administrator records a payment
 *    (docs/school-billing.md);
 * 4. switches the assistant on with its monthly limit (which also switches it
 *    on for the default roles);
 * 5. makes the person a member with the principal role;
 * 6. records the creation in the ledger;
 * 7. offers the school its guided setup (`school_onboarding`), which opens
 *    as the owner's next screen.
 */
export async function createOwnSchool(db: DatabaseExecutor, input: CreateOwnSchoolInput): Promise<{ schoolId: string }> {
  await lockUser(db, input.userId);
  const status = await readSchoolCreationStatus(db, input.userId);
  if (status.refusal) throw schoolCreationRefusedError(status.refusal);

  // The shared start of every self-provisioned school (trial, assistant, owner as principal); the slug comes from the name.
  const { schoolId } = await provisionSelfServiceSchool(db, {
    ownerUserId: input.userId,
    now: input.now,
    school: {
      kind: 'school',
      name: input.name,
      location: input.location,
      registrationNo: input.registrationNo,
      slug: { fromName: slugifySchoolName(input.name) || 'school' },
    },
  });
  // Only a school someone creates counts against their allowance and is offered the guided setup.
  await db.insert(schoolCreationTable).values({ userId: input.userId, schoolId });
  await offerSchoolOnboarding(db, schoolId);
  return { schoolId };
}

/** The person's newest request, or null when they never asked. */
export async function readLatestSchoolCreationRequest(db: DatabaseExecutor, userId: string) {
  const [request] = await db
    .select({
      id: schoolCreationRequestTable.id,
      requestedLimit: schoolCreationRequestTable.requestedLimit,
      reason: schoolCreationRequestTable.reason,
      status: schoolCreationRequestTable.status,
      grantedLimit: schoolCreationRequestTable.grantedLimit,
      decisionNote: schoolCreationRequestTable.decisionNote,
      decidedAt: schoolCreationRequestTable.decidedAt,
      createdAt: schoolCreationRequestTable.createdAt,
    })
    .from(schoolCreationRequestTable)
    .where(eq(schoolCreationRequestTable.userId, userId))
    .orderBy(desc(schoolCreationRequestTable.createdAt), desc(schoolCreationRequestTable.id))
    .limit(1);
  return request ?? null;
}

/**
 * Files a request for a larger allowance. Only a person whose one obstacle is
 * the allowance may ask (or who may still create, to plan ahead): asking does
 * not lift any other refusal, so it is refused with that refusal instead. The
 * new total must be above the current allowance, and a person has at most one
 * pending request (CONFLICT; the partial unique index backs this up).
 */
export async function requestLargerSchoolLimit(
  db: DatabaseExecutor,
  input: { userId: string; requestedLimit: number; reason: string },
): Promise<void> {
  await lockUser(db, input.userId);
  const status = await readSchoolCreationStatus(db, input.userId);
  if (status.refusal !== null && status.refusal !== 'limit_reached') {
    throw schoolCreationRefusedError(status.refusal);
  }
  if (input.requestedLimit <= status.limit) {
    throw rpcError.badRequest(`Ask for more than the ${status.limit} school${status.limit === 1 ? '' : 's'} you may already create.`);
  }
  const [pending] = await db
    .select({ id: schoolCreationRequestTable.id })
    .from(schoolCreationRequestTable)
    .where(and(eq(schoolCreationRequestTable.userId, input.userId), eq(schoolCreationRequestTable.status, 'pending')))
    .limit(1);
  if (pending) throw rpcError.conflict('You already have a request waiting for CampusPilot.');
  await db.insert(schoolCreationRequestTable).values({
    userId: input.userId,
    requestedLimit: input.requestedLimit,
    reason: input.reason,
  });
}
