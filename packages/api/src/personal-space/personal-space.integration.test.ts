import { db } from '@campuspilot/db';
import { readSchoolFeatureConfig } from '@campuspilot/db/feature-flags/store';
import { user } from '@campuspilot/db/schema/auth';
import { schoolTable } from '@campuspilot/db/schema/school';
import { schoolCreationTable } from '@campuspilot/db/schema/school-creation';
import { schoolMemberTable } from '@campuspilot/db/schema/school-member';
import { schoolBillingPeriodTable } from '@campuspilot/db/schema/school-billing';
import { schoolUserRoleTable } from '@campuspilot/db/schema/school-user-role';
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { createRegularUserSession, createTestClient, createTestSchool, createTestSchoolMember } from '../../test/fixtures';
import { googleNewcomer, personalSpaceOwner } from '../../test/personal-space';
import { addBillingPeriods } from '../billing/billing.contract';
import { SELF_SERVICE_ASSISTANT_MONTHLY_LIMIT_USD } from '../school-creation/school-creation.contract';
import { personalSpaceName, personalSpaceRefusalOf, UNNAMED_PERSONAL_SPACE_NAME } from './personal-space.contract';
import { createPersonalSpaceAfterGoogleSignUp } from './personal-space.service';

/** Personal spaces (docs/personal-space.md). */

const refusalOf = (promise: Promise<unknown>) =>
  promise.then(
    () => null,
    (error: unknown) => personalSpaceRefusalOf(error),
  );

describe('personalSpace.create', () => {
  it('makes a personal school owned by the person, on the self-service trial with the assistant on', async () => {
    const { client, userId } = await googleNewcomer('Asha Verma');
    expect(await client.personalSpace.getStatus()).toEqual({ schoolId: null, refusal: null });

    const before = new Date();
    const { schoolId } = await client.personalSpace.create();

    const [school] = await db.select().from(schoolTable).where(eq(schoolTable.id, schoolId));
    expect(school).toMatchObject({ kind: 'personal', name: "Asha Verma's personal school", location: '', tier: null, ownerUserId: userId, isDemo: false });
    const [trial] = await db.select().from(schoolBillingPeriodTable).where(eq(schoolBillingPeriodTable.schoolId, schoolId));
    expect(trial).toMatchObject({ kind: 'trial', tier: 'plus', createdBy: userId });
    expect(trial!.endsAt.getTime()).toBeGreaterThanOrEqual(addBillingPeriods(before, 1).getTime() - 60_000);
    expect(await readSchoolFeatureConfig(db, schoolId, 'assistant')).toMatchObject({
      status: 'valid',
      config: { monthlyLimitUsd: SELF_SERVICE_ASSISTANT_MONTHLY_LIMIT_USD },
    });
    expect(await db.select().from(schoolMemberTable).where(eq(schoolMemberTable.schoolId, schoolId))).toHaveLength(1);
    expect(await db.select({ role: schoolUserRoleTable.role }).from(schoolUserRoleTable).where(eq(schoolUserRoleTable.schoolId, schoolId))).toEqual([{ role: 'principal' }]);
    expect(await client.personalSpace.getStatus()).toEqual({ schoolId, refusal: 'already_has_one' });
    const [listed] = await client.school.listMySchools();
    expect(listed).toMatchObject({ id: schoolId, kind: 'personal', hasActivePlan: true, planSource: 'trial' });
  });

  it('does not use the school creation allowance: the person can still create a school', async () => {
    const { client, userId } = await personalSpaceOwner();
    expect(await db.select().from(schoolCreationTable).where(eq(schoolCreationTable.userId, userId))).toEqual([]);
    expect(await client.schoolCreation.getStatus()).toMatchObject({ used: 0, refusal: null });
    await client.schoolCreation.createSchool({ name: 'Sunrise Public School', location: 'Pune' });
    expect((await client.school.listMySchools()).map((school) => school.kind).sort()).toEqual(['personal', 'school']);
  });

  it('allows one personal space per person, also for creations sent at once', async () => {
    const { client } = await personalSpaceOwner();
    expect(await refusalOf(client.personalSpace.create())).toBe('already_has_one');
    const racing = await googleNewcomer();
    const outcomes = await Promise.allSettled([racing.client.personalSpace.create(), racing.client.personalSpace.create()]);
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
  });

  it('refuses someone without a linked Google account, even with a verified email', async () => {
    const session = await createRegularUserSession();
    const client = createTestClient(session);
    expect(await client.personalSpace.getStatus()).toEqual({ schoolId: null, refusal: 'no_google_account' });
    expect(await refusalOf(client.personalSpace.create())).toBe('no_google_account');
  });

  it('refuses a member of any school', async () => {
    const { client, userId } = await googleNewcomer();
    const school = await createTestSchool();
    await createTestSchoolMember({ schoolId: school.id, userId, roles: [{ role: 'teacher', meta: { classIds: [] } }] });
    expect(await refusalOf(client.personalSpace.create())).toBe('member_of_school');
  });

  it('refuses a demo login', async () => {
    const { client, userId } = await googleNewcomer();
    const school = await createTestSchool({ isDemo: true });
    await db.update(user).set({ demoSchoolId: school.id }).where(eq(user.id, userId));
    expect(await refusalOf(client.personalSpace.create())).toBe('demo_account');
  });

  it('names a space after its person, or plainly without a name', () => {
    expect(personalSpaceName('  Ravi   Kumar ')).toBe("Ravi Kumar's personal school");
    expect(personalSpaceName('')).toBe(UNNAMED_PERSONAL_SPACE_NAME);
    expect(personalSpaceName(null)).toBe('My personal school');
  });
});

describe('after a Google sign-up', () => {
  it('creates the personal space of a new account', async () => {
    const { userId } = await googleNewcomer();
    await createPersonalSpaceAfterGoogleSignUp(db, userId);
    const spaces = await db.select().from(schoolTable).where(and(eq(schoolTable.ownerUserId, userId), eq(schoolTable.kind, 'personal')));
    expect(spaces).toHaveLength(1);
  });

  it('creates nothing, and does not fail, for an account that already belongs to a school', async () => {
    const { userId } = await googleNewcomer();
    const school = await createTestSchool();
    await createTestSchoolMember({ schoolId: school.id, userId, roles: [{ role: 'principal', meta: null }] });
    await expect(createPersonalSpaceAfterGoogleSignUp(db, userId)).resolves.toBeUndefined();
    expect(await db.select().from(schoolTable).where(and(eq(schoolTable.ownerUserId, userId), eq(schoolTable.kind, 'personal')))).toEqual([]);
  });
});
