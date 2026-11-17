import { db } from '@campuspilot/db';
import { readSchoolFeatureConfig } from '@campuspilot/db/feature-flags/store';
import { user } from '@campuspilot/db/schema/auth';
import { schoolTable } from '@campuspilot/db/schema/school';
import { schoolCreationTable } from '@campuspilot/db/schema/school-creation';
import { schoolBillingPeriodTable } from '@campuspilot/db/schema/school-billing';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { expectRpcCode } from '../../test/finance/assertions';
import {
  createAdminSession,
  createRegularUserSession,
  createSchoolStaffSession,
  createTestClient,
  createTestSchool,
  createTestSchoolMember,
  createTestUser,
  createUserSession,
} from '../../test/fixtures';
import { isSchoolNoPlanError } from '../school-access/school-access.contract';
import {
  SELF_SERVICE_ASSISTANT_MONTHLY_LIMIT_USD,
  schoolCreationRefusalOf,
} from './school-creation.contract';
import { addBillingPeriods } from '../billing/billing.contract';

/** Self-service school creation (docs/school-creation.md). */

const newSchool = (name = 'Sunrise Public School') => ({ name, location: 'Pune' });

/** A fresh signed-in person with a verified email and no school. */
async function newcomer() {
  const session = await createRegularUserSession();
  return { session, userId: session.user.id, client: createTestClient(session) };
}

const adminClient = async () => createTestClient(await createAdminSession());

async function refusalOf(promise: Promise<unknown>) {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  return schoolCreationRefusalOf(error);
}

describe('school.createSchool', () => {
  it('makes the person owner and principal of a school on a one-month Plus trial with the assistant on', async () => {
    const { client, userId } = await newcomer();
    expect(await client.schoolCreation.getStatus()).toMatchObject({ limit: 1, used: 0, refusal: null, latestRequest: null });

    const { schoolId } = await client.schoolCreation.createSchool({ ...newSchool(), registrationNo: 'REG-1' });

    const [school] = await db.select().from(schoolTable).where(eq(schoolTable.id, schoolId));
    expect(school).toMatchObject({ name: 'Sunrise Public School', location: 'Pune', registrationNo: 'REG-1', tier: null, ownerUserId: userId });
    const [trial] = await db.select().from(schoolBillingPeriodTable).where(eq(schoolBillingPeriodTable.schoolId, schoolId));
    expect(trial).toMatchObject({ kind: 'trial', tier: 'plus', endedAt: null, createdBy: userId });
    // One 28-day billing period, give or take the gap between the server's clock and the database's.
    expect(Math.abs(trial!.endsAt.getTime() - addBillingPeriods(trial!.startsAt, 1).getTime())).toBeLessThan(60_000);
    expect(await readSchoolFeatureConfig(db, schoolId, 'assistant')).toMatchObject({
      status: 'valid',
      config: { monthlyLimitUsd: SELF_SERVICE_ASSISTANT_MONTHLY_LIMIT_USD },
    });

    const [listed] = await client.school.listMySchools();
    expect(listed).toMatchObject({ id: schoolId, hasActivePlan: true, hasSubscription: false, planSource: 'trial' });
    expect(new Date(listed!.planEndsAt!).getTime()).toBe(trial!.endsAt.getTime());
    const members = await client.school.listMembers({ schoolId });
    expect(members.items).toMatchObject([{ userId, isOwner: true, roles: [{ role: 'principal' }] }]);
    // The trial gives a plan, so the owner can change things.
    await client.school.updateSchool({ schoolId, name: 'Sunrise School' });

    expect(await client.schoolCreation.getStatus()).toMatchObject({ limit: 1, used: 1, refusal: 'limit_reached' });
    expect(await refusalOf(client.schoolCreation.createSchool(newSchool('Second')))).toBe('limit_reached');
  });

  it('makes the school read-only once its trial has run out', async () => {
    const { client } = await newcomer();
    const { schoolId } = await client.schoolCreation.createSchool(newSchool());
    const DAY = 24 * 60 * 60 * 1000;
    await db
      .update(schoolBillingPeriodTable)
      .set({ startsAt: new Date(Date.now() - 40 * DAY), endsAt: new Date(Date.now() - 10 * DAY) })
      .where(eq(schoolBillingPeriodTable.schoolId, schoolId));
    const error = await client.school.updateSchool({ schoolId, name: 'After' }).catch((caught: unknown) => caught);
    expect(isSchoolNoPlanError(error)).toBe(true);
  });

  it('does not give the allowance back when the school is deleted', async () => {
    const { client, userId } = await newcomer();
    const { schoolId } = await client.schoolCreation.createSchool(newSchool());
    await (await adminClient()).systemAdmin.deleteSchool({ id: schoolId });

    expect(await db.select().from(schoolCreationTable).where(eq(schoolCreationTable.userId, userId))).toMatchObject([
      { schoolId: null },
    ]);
    expect(await client.schoolCreation.getStatus()).toMatchObject({ used: 1, refusal: 'limit_reached' });
    expect(await refusalOf(client.schoolCreation.createSchool(newSchool('Again')))).toBe('limit_reached');
  });

  it('creates at most the allowance when requests arrive at the same time', async () => {
    const { client, userId } = await newcomer();
    const results = await Promise.allSettled([1, 2, 3, 4].map((n) => client.schoolCreation.createSchool(newSchool(`Parallel ${n}`))));
    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(await db.select().from(schoolCreationTable).where(eq(schoolCreationTable.userId, userId))).toHaveLength(1);
  });

  it('refuses staff of another school, whatever their role', async () => {
    const school = await createTestSchool();
    for (const role of ['principal', 'manager', 'teacher', 'accountant', 'exam_coordinator'] as const) {
      const { session } = await createSchoolStaffSession(school.id, [{ role, meta: role === 'teacher' ? { classIds: [] } : null }]);
      const client = createTestClient(session);
      expect(await refusalOf(client.schoolCreation.createSchool(newSchool()))).toBe('member_of_other_school');
      expect(await refusalOf(client.schoolCreation.requestMore({ requestedLimit: 2, reason: 'We run a second campus nearby.' }))).toBe(
        'member_of_other_school',
      );
    }
  });

  it('refuses an owner who is also staff of a school they do not own', async () => {
    const { client, userId } = await newcomer();
    await client.schoolCreation.createSchool(newSchool());
    await db.update(user).set({ schoolCreationLimit: 2 }).where(eq(user.id, userId));
    const other = await createTestSchool();
    await createTestSchoolMember({ schoolId: other.id, userId, roles: [{ role: 'manager' }] });
    expect(await refusalOf(client.schoolCreation.createSchool(newSchool('Second')))).toBe('member_of_other_school');
  });

  it('refuses accounts without a verified, real email and demo accounts', async () => {
    const unverified = await newcomer();
    await db.update(user).set({ emailVerified: false }).where(eq(user.id, unverified.userId));
    expect(await refusalOf(unverified.client.schoolCreation.createSchool(newSchool()))).toBe('unverified_email');

    const demoSchool = await createTestSchool();
    const demo = await newcomer();
    await db.update(user).set({ demoSchoolId: demoSchool.id }).where(eq(user.id, demo.userId));
    expect(await refusalOf(demo.client.schoolCreation.createSchool(newSchool()))).toBe('demo_account');
  });

  it('is refused to anonymous callers', async () => {
    await expectRpcCode(createTestClient(null).schoolCreation.createSchool(newSchool()), 'UNAUTHORIZED');
  });
});

describe('the owner stays', () => {
  it('cannot be removed or lose the principal role, by another principal or by themselves', async () => {
    const owner = await newcomer();
    const { schoolId } = await owner.client.schoolCreation.createSchool(newSchool());
    const deputy = await createTestUser();
    await createTestSchoolMember({ schoolId, userId: deputy.id, roles: [{ role: 'principal' }] });
    const deputyClient = createTestClient(createUserSession(deputy));

    for (const client of [deputyClient, owner.client]) {
      await expectRpcCode(client.school.removeMember({ schoolId, userId: owner.userId }), 'FORBIDDEN');
      await expectRpcCode(
        client.school.updateMemberRoles({ schoolId, userId: owner.userId, roles: [{ role: 'manager', meta: null }] }),
        'FORBIDDEN',
      );
    }
    // Adding roles beside the principal role is fine.
    const updated = await owner.client.school.updateMemberRoles({
      schoolId,
      userId: owner.userId,
      roles: [
        { role: 'principal', meta: null },
        { role: 'accountant', meta: null },
      ],
    });
    expect(updated).toMatchObject({ isOwner: true });
    // Anyone else can still be removed.
    await owner.client.school.removeMember({ schoolId, userId: deputy.id });
  });

  it('moves only when an administrator names a principal as the new owner', async () => {
    const owner = await newcomer();
    const { schoolId } = await owner.client.schoolCreation.createSchool(newSchool());
    const teacher = await createTestUser();
    await createTestSchoolMember({ schoolId, userId: teacher.id, roles: [{ role: 'teacher', meta: { classIds: [] } }] });
    const admin = await adminClient();

    await expectRpcCode(admin.systemAdmin.updateSchoolOwner({ id: schoolId, ownerUserId: teacher.id }), 'BAD_REQUEST');
    await expectRpcCode(owner.client.systemAdmin.updateSchoolOwner({ id: schoolId, ownerUserId: teacher.id }), 'FORBIDDEN');

    await owner.client.school.updateMemberRoles({ schoolId, userId: teacher.id, roles: [{ role: 'principal', meta: null }] });
    expect(await admin.systemAdmin.updateSchoolOwner({ id: schoolId, ownerUserId: teacher.id })).toMatchObject({ ownerUserId: teacher.id });
    // The former owner can now be removed, and leaving does not give the allowance back.
    await createTestClient(createUserSession(teacher)).school.removeMember({ schoolId, userId: owner.userId });
    expect(await owner.client.schoolCreation.getStatus()).toMatchObject({ used: 1, refusal: 'limit_reached' });
  });
});

describe('asking for more schools', () => {
  it('reaches administrators, and approving lets the person create up to the granted total', async () => {
    const person = await newcomer();
    await person.client.schoolCreation.createSchool(newSchool());

    await expectRpcCode(person.client.schoolCreation.requestMore({ requestedLimit: 1, reason: 'x'.repeat(30) }), 'BAD_REQUEST');
    await person.client.schoolCreation.requestMore({ requestedLimit: 3, reason: 'We run two more branches in the city.' });
    await expectRpcCode(
      person.client.schoolCreation.requestMore({ requestedLimit: 4, reason: 'We run three more branches in the city.' }),
      'CONFLICT',
    );
    expect(await person.client.schoolCreation.getStatus()).toMatchObject({
      refusal: 'limit_reached',
      latestRequest: { requestedLimit: 3, status: 'pending', grantedLimit: null },
    });

    await expectRpcCode(person.client.systemAdmin.listSchoolCreationRequests({ status: 'pending' }), 'FORBIDDEN');
    const admin = await adminClient();
    const pending = await admin.systemAdmin.listSchoolCreationRequests({ status: 'pending' });
    const request = pending.items.find(({ userId }) => userId === person.userId);
    expect(request).toMatchObject({ requestedLimit: 3, currentLimit: 1, createdSchools: [{ name: 'Sunrise Public School' }] });
    expect((await admin.systemAdmin.countPendingSchoolCreationRequests()).pending).toBeGreaterThanOrEqual(1);

    await expectRpcCode(
      admin.systemAdmin.decideSchoolCreationRequest({ id: request!.id, decision: 'approve', grantedLimit: 1 }),
      'BAD_REQUEST',
    );
    await admin.systemAdmin.decideSchoolCreationRequest({ id: request!.id, decision: 'approve', grantedLimit: 2, note: 'Two for now.' });
    await expectRpcCode(admin.systemAdmin.decideSchoolCreationRequest({ id: request!.id, decision: 'reject' }), 'CONFLICT');

    expect(await person.client.schoolCreation.getStatus()).toMatchObject({
      limit: 2,
      used: 1,
      refusal: null,
      latestRequest: { status: 'approved', grantedLimit: 2, decisionNote: 'Two for now.' },
    });
    await person.client.schoolCreation.createSchool(newSchool('Second campus'));
    expect(await refusalOf(person.client.schoolCreation.createSchool(newSchool('Third campus')))).toBe('limit_reached');
  });

  it('only ever raises the allowance when approving', async () => {
    const person = await newcomer();
    await person.client.schoolCreation.createSchool(newSchool());
    await db.update(user).set({ schoolCreationLimit: 10 }).where(eq(user.id, person.userId));
    await person.client.schoolCreation.requestMore({ requestedLimit: 20, reason: 'We are opening ten more branches.' });
    const admin = await adminClient();
    const { items } = await admin.systemAdmin.listSchoolCreationRequests({ status: 'pending' });
    const request = items.find(({ userId }) => userId === person.userId)!;

    await expectRpcCode(admin.systemAdmin.decideSchoolCreationRequest({ id: request.id, decision: 'approve', grantedLimit: 3 }), 'BAD_REQUEST');
    await expectRpcCode(admin.systemAdmin.decideSchoolCreationRequest({ id: request.id, decision: 'approve', grantedLimit: 10 }), 'BAD_REQUEST');
    expect(await person.client.schoolCreation.getStatus()).toMatchObject({ limit: 10, latestRequest: { status: 'pending' } });
    await admin.systemAdmin.decideSchoolCreationRequest({ id: request.id, decision: 'approve', grantedLimit: 15 });
    expect(await person.client.schoolCreation.getStatus()).toMatchObject({ limit: 15, latestRequest: { status: 'approved', grantedLimit: 15 } });
  });

  it('leaves the allowance unchanged when rejected, and allows a new request afterwards', async () => {
    const person = await newcomer();
    await person.client.schoolCreation.createSchool(newSchool());
    await person.client.schoolCreation.requestMore({ requestedLimit: 2, reason: 'Opening a second school next year.' });
    const admin = await adminClient();
    const { items } = await admin.systemAdmin.listSchoolCreationRequests({ status: 'pending' });
    const request = items.find(({ userId }) => userId === person.userId)!;
    await admin.systemAdmin.decideSchoolCreationRequest({ id: request.id, decision: 'reject', note: 'Write to us when it opens.' });
    expect(await person.client.schoolCreation.getStatus()).toMatchObject({
      limit: 1,
      refusal: 'limit_reached',
      latestRequest: { status: 'rejected', decisionNote: 'Write to us when it opens.' },
    });
    await person.client.schoolCreation.requestMore({ requestedLimit: 2, reason: 'The second school has now opened.' });
  });
});
