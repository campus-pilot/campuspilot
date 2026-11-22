import type { DatabaseExecutor } from '@campuspilot/db';
import type { SchoolKind } from '@campuspilot/db/school-kind';
import { schoolTable } from '@campuspilot/db/schema/school';
import { schoolMemberTable } from '@campuspilot/db/schema/school-member';
import { schoolUserRoleTable } from '@campuspilot/db/schema/school-user-role';

import { addBillingPeriods } from '../billing/billing.contract';
import { startTrialPeriod } from '../billing/billing.service';
import { rpcError } from '../errors';
import { setSchoolFeature } from '../feature-flags/feature-flags.service';
import { uniqueSlug } from '../workflows/demo-school/identity';
import {
  SELF_SERVICE_ASSISTANT_MONTHLY_LIMIT_USD,
  SELF_SERVICE_TRIAL_PERIODS,
  SELF_SERVICE_TRIAL_TIER,
} from './school-creation.contract';

/**
 * How a self-provisioned school gets its slug, each an explicit choice of the
 * caller:
 * - `fromName`: the slug of its name, with the next free numeric suffix
 *   (a school someone creates; the insert itself claims the slug, so a slug
 *   taken meanwhile moves on);
 * - `exact`: one given slug, inserted once (a personal space, whose slug must
 *   not carry the person's name; it is unique by construction).
 */
export type ProvisionedSlug = { fromName: string } | { exact: string };

/**
 * What a school someone provisions for themselves starts with, the one place
 * shared by `createOwnSchool` (docs/school-creation.md) and
 * `createPersonalSpace` (docs/personal-space.md), so the two cannot drift
 * apart. In the caller's transaction, after the caller locked the person and
 * decided they may:
 *
 * 1. inserts the school with the person as owner, no standing tier, and the
 *    kind, name, location and slug the caller states;
 * 2. starts a {@link SELF_SERVICE_TRIAL_TIER} trial of
 *    {@link SELF_SERVICE_TRIAL_PERIODS} billing period, the start of the
 *    school's billing cycle;
 * 3. switches the assistant on with {@link SELF_SERVICE_ASSISTANT_MONTHLY_LIMIT_USD}
 *    (which also switches it on for the default roles);
 * 4. makes the person a member with the principal role.
 *
 * What differs stays with each caller: the kind, the name and slug, the
 * allowance ledger (`school_creation`, only for a school) and the guided
 * setup (only for a school).
 */
export async function provisionSelfServiceSchool(
  db: DatabaseExecutor,
  input: {
    ownerUserId: string;
    now: Date;
    school: { kind: SchoolKind; name: string; location: string; registrationNo: string | null; slug: ProvisionedSlug };
  },
): Promise<{ schoolId: string }> {
  const { school } = input;
  const insert = (slug: string) =>
    db
      .insert(schoolTable)
      .values({
        slug,
        name: school.name,
        location: school.location,
        registrationNo: school.registrationNo,
        tier: null,
        ownerUserId: input.ownerUserId,
        kind: school.kind,
      })
      .onConflictDoNothing({ target: schoolTable.slug })
      .returning({ id: schoolTable.id });

  let schoolId: string | undefined;
  if ('exact' in school.slug) {
    const [row] = await insert(school.slug.exact);
    schoolId = row?.id;
  } else {
    await uniqueSlug(school.slug.fromName, async (candidate) => {
      const [row] = await insert(candidate);
      schoolId = row?.id;
      return row === undefined;
    });
  }
  // An exact slug that is taken is a broken invariant (it is unique by construction), never retried.
  if (!schoolId) throw rpcError.internal();

  await startTrialPeriod(db, {
    schoolId,
    tier: SELF_SERVICE_TRIAL_TIER,
    endsAt: addBillingPeriods(input.now, SELF_SERVICE_TRIAL_PERIODS),
    createdBy: input.ownerUserId,
  });
  // A system write (no administrator made it), hence no `updatedBy`.
  await setSchoolFeature(db, {
    schoolId,
    feature: 'assistant',
    enabled: true,
    config: { monthlyLimitUsd: SELF_SERVICE_ASSISTANT_MONTHLY_LIMIT_USD, voice: { enabled: false } },
    updatedBy: null,
  });
  await db.insert(schoolMemberTable).values({ schoolId, userId: input.ownerUserId });
  await db.insert(schoolUserRoleTable).values({ schoolId, userId: input.ownerUserId, role: 'principal', meta: null });
  return { schoolId };
}
