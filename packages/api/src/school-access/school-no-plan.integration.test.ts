import { db } from '@campuspilot/db';
import { schoolTable } from '@campuspilot/db/schema/school';
import { schoolTrialTable } from '@campuspilot/db/schema/school-trial';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { expectFeatureDisabled, expectPermissionDenied } from '../../test/feature-flags';
import { expectRpcCode } from '../../test/finance/assertions';
import {
  createAdminSession,
  createHandlerContext,
  createRegularUserSession,
  createSchoolStaffSession,
  createTestAdmission,
  createTestClient,
  createTestSchool,
  createTestSchoolMember,
  createTestSchoolTrial,
  setTestSchoolFeature,
} from '../../test/fixtures';
import { createCadetLogin, fakePushSubscription } from '../../test/notifications';
import { assistantAccessError, resolveAssistantAccess } from '../assistant/access';
import { handleAdmissionPhotoUpload } from '../routers/school/admission/admission.http';
import {
  isSchoolNoPlanError,
  isSchoolSuspendedError,
  SCHOOL_NO_PLAN_MESSAGE,
  SCHOOL_NO_PLAN_REASON,
  SCHOOL_SUSPENDED_REASON,
  schoolWriteRefusalOf,
} from './school-access.contract';
import { readSchoolWriteFacts, resolveSchoolWriteRefusal, schoolNoPlanError } from './school-access.service';

/**
 * A school without an active plan (no subscribed tier and no active trial,
 * docs/school-trials.md) is read-only exactly like a suspended one: reads
 * work, every change is refused with FORBIDDEN `data.reason =
 * 'SCHOOL_NO_PLAN'`, and nothing is deleted. Expiry is set up with
 * timestamps in the past, never by waiting.
 */

const DAY = 24 * 60 * 60 * 1000;
const daysFromNow = (days: number) => new Date(Date.now() + days * DAY);

async function expectNoPlan(promise: Promise<unknown>): Promise<void> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error, 'the call should have been refused').not.toBeNull();
  expect(error).toMatchObject({ code: 'FORBIDDEN', message: SCHOOL_NO_PLAN_MESSAGE, data: { reason: SCHOOL_NO_PLAN_REASON } });
  expect(isSchoolNoPlanError(error)).toBe(true);
  expect(isSchoolSuspendedError(error)).toBe(false);
}

const storedName = async (schoolId: string) =>
  (await db.select({ name: schoolTable.name }).from(schoolTable).where(eq(schoolTable.id, schoolId)))[0]!.name;

/** Ends every trial of the school now by moving its end into the past, as time passing would. */
const runOutTrials = (schoolId: string) =>
  db.update(schoolTrialTable).set({ endsAt: new Date(Date.now() - 1000) }).where(eq(schoolTrialTable.schoolId, schoolId));

describe('the write decision', () => {
  it('refuses a suspended school or one without a plan, and the suspension wins when both apply', () => {
    expect(resolveSchoolWriteRefusal({ suspended: false, hasActivePlan: true })).toBeNull();
    expect(resolveSchoolWriteRefusal({ suspended: true, hasActivePlan: true })).toBe(SCHOOL_SUSPENDED_REASON);
    expect(resolveSchoolWriteRefusal({ suspended: false, hasActivePlan: false })).toBe(SCHOOL_NO_PLAN_REASON);
    expect(resolveSchoolWriteRefusal({ suspended: true, hasActivePlan: false })).toBe(SCHOOL_SUSPENDED_REASON);
  });

  it('reads both facts, the plan from a subscription or an active trial', async () => {
    const subscribed = await createTestSchool({ tier: 'plus' });
    const onTrial = await createTestSchool({ tier: null });
    await createTestSchoolTrial({ schoolId: onTrial.id, tier: 'plus' });
    const ranOut = await createTestSchool({ tier: null });
    await createTestSchoolTrial({ schoolId: ranOut.id, tier: 'pro', startsAt: daysFromNow(-31), endsAt: daysFromNow(-1) });
    expect(await readSchoolWriteFacts(db, subscribed.id)).toEqual({ suspended: false, hasActivePlan: true });
    expect(await readSchoolWriteFacts(db, onTrial.id)).toEqual({ suspended: false, hasActivePlan: true });
    expect(await readSchoolWriteFacts(db, ranOut.id)).toEqual({ suspended: false, hasActivePlan: false });
    expect(await readSchoolWriteFacts(db, 'sch_missing')).toBeNull();
  });
});

describe('a school without an active plan is read-only for its staff', () => {
  it('still answers reads, refuses every change with the no-plan error and writes nothing, until it gets a plan', async () => {
    const school = await createTestSchool({ tier: null });
    const principal = await createSchoolStaffSession(school.id, [{ role: 'principal', meta: null }]);
    const client = createTestClient(principal.session);

    await expect(client.school.getSchool({ schoolId: school.id })).resolves.toMatchObject({ id: school.id, isSuspended: false });
    await expect(client.school.getFeatureFlags({ schoolId: school.id })).resolves.toMatchObject({ tier: null });
    await expect(client.school.listClasses({ schoolId: school.id })).resolves.toEqual([]);

    await expectNoPlan(client.school.updateSchool({ schoolId: school.id, name: 'Renamed Without A Plan' }));
    await expectNoPlan(
      client.school.createClass({ schoolId: school.id, slug: 'class-1', label: 'Class 1', sections: [{ slug: 'a', label: 'A' }] }),
    );
    expect(await storedName(school.id)).toBe(school.name);
    expect(await client.school.listClasses({ schoolId: school.id })).toEqual([]);

    // A trial gives it a plan: changes work again at once.
    await createTestSchoolTrial({ schoolId: school.id, tier: 'plus' });
    await expect(client.school.updateSchool({ schoolId: school.id, name: 'Renamed On A Trial' })).resolves.toMatchObject({ name: 'Renamed On A Trial' });

    // When the trial runs out the school is read-only again; a subscription restores it.
    await runOutTrials(school.id);
    await expectNoPlan(client.school.updateSchool({ schoolId: school.id, name: 'Renamed After The Trial' }));
    await db.update(schoolTable).set({ tier: 'plus' }).where(eq(schoolTable.id, school.id));
    await expect(client.school.updateSchool({ schoolId: school.id, name: 'Renamed Subscribed' })).resolves.toMatchObject({ name: 'Renamed Subscribed' });
  });

  it('refuses the next change once a trial ends mid-work, keeps reads, and takes the trial\'s features away at once', async () => {
    const school = await createTestSchool({ tier: null });
    await createTestSchoolTrial({ schoolId: school.id, tier: 'pro' });
    const manager = await createSchoolStaffSession(school.id, [{ role: 'manager', meta: null }]);
    const client = createTestClient(manager.session);
    await expect(client.school.listAdmissions({ schoolId: school.id })).resolves.toBeDefined();
    await expect(client.school.updateSchool({ schoolId: school.id, name: 'During The Trial' })).resolves.toBeDefined();

    await runOutTrials(school.id);
    await expectNoPlan(client.school.updateSchool({ schoolId: school.id, name: 'After The Trial' }));
    await expect(client.school.getSchool({ schoolId: school.id })).resolves.toMatchObject({ name: 'During The Trial' });
    // Student management came with the Pro trial and closes with it.
    await expectFeatureDisabled(client.school.listAdmissions({ schoolId: school.id }), 'studentManagement');
  });

  it('answers someone who is not a member with the ordinary permission refusal, and does not hold a platform administrator outside it', async () => {
    const school = await createTestSchool({ tier: null });
    const elsewhere = await createTestSchool();
    const outsider = createTestClient((await createSchoolStaffSession(elsewhere.id, [{ role: 'principal', meta: null }])).session);
    for (const client of [outsider, createTestClient(await createRegularUserSession())]) {
      const error = await client.school.updateSchool({ schoolId: school.id, name: 'Probe' }).catch((caught: unknown) => caught);
      expect(schoolWriteRefusalOf(error)).toBeNull();
      await expectPermissionDenied(client.school.updateSchool({ schoolId: school.id, name: 'Probe' }));
    }
    await expectRpcCode(createTestClient(null).school.updateSchool({ schoolId: school.id, name: 'Probe' }), 'UNAUTHORIZED');

    const adminSession = await createAdminSession();
    await expect(createTestClient(adminSession).school.updateSchool({ schoolId: school.id, name: 'Corrected From Outside' })).resolves.toMatchObject({
      name: 'Corrected From Outside',
    });
    await createTestSchoolMember({ schoolId: school.id, userId: adminSession.user.id, roles: [{ role: 'principal', meta: null }] });
    await expectNoPlan(createTestClient(adminSession).school.updateSchool({ schoolId: school.id, name: 'Corrected As A Member' }));
  });

  it('tells a suspended school without a plan that it is suspended', async () => {
    const school = await createTestSchool({ tier: null });
    const principal = await createSchoolStaffSession(school.id, [{ role: 'principal', meta: null }]);
    await createTestClient(await createAdminSession()).systemAdmin.suspendSchool({ id: school.id, reason: 'Misuse' });
    const error = await createTestClient(principal.session).school.updateSchool({ schoolId: school.id, name: 'X' }).catch((caught: unknown) => caught);
    expect(schoolWriteRefusalOf(error)).toBe(SCHOOL_SUSPENDED_REASON);
  });

  it('refuses uploads outside oRPC too', async () => {
    // The baseline test school has student management as an adjustment, which stays when its tier goes.
    const school = await createTestSchool();
    await db.update(schoolTable).set({ tier: null }).where(eq(schoolTable.id, school.id));
    const admission = await createTestAdmission({ schoolId: school.id });
    const manager = await createSchoolStaffSession(school.id, [{ role: 'manager', meta: null }]);
    const formData = new FormData();
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52]);
    formData.set('photo', new Blob([png], { type: 'image/png' }), 'student.png');
    const refused = await handleAdmissionPhotoUpload(
      new Request('http://localhost/photo', { method: 'POST', body: formData }),
      createHandlerContext(manager.session),
      { schoolId: school.id, admissionId: admission.id },
    );
    expect(refused.status).toBe(403);
    expect(await refused.json()).toEqual({ code: 'FORBIDDEN', message: SCHOOL_NO_PLAN_MESSAGE });
  });
});

describe('a school without an active plan in the Cadet Portal', () => {
  it('lets a student read and refuses changes when the portal is kept on by adjustments', async () => {
    const school = await createTestSchool({ features: ['cadet'] });
    await db.update(schoolTable).set({ tier: null }).where(eq(schoolTable.id, school.id));
    const admission = await createTestAdmission({ schoolId: school.id });
    const { client } = await createCadetLogin(admission.id);
    await expect(client.getSchool()).resolves.toMatchObject({ id: school.id, isSuspended: false });
    await expect(client.getAdmission()).resolves.toMatchObject({ id: admission.id });
    await expectNoPlan(client.subscribePush(fakePushSubscription()));
    await expectNoPlan(client.markAllNotificationsRead({}));
  });

  it('closes the portal when the Enterprise trial that gave it ends', async () => {
    const school = await createTestSchool({ tier: null });
    await createTestSchoolTrial({ schoolId: school.id, tier: 'enterprise' });
    const admission = await createTestAdmission({ schoolId: school.id });
    const { client } = await createCadetLogin(admission.id);
    await expect(client.getSchool()).resolves.toMatchObject({ id: school.id });
    await runOutTrials(school.id);
    await expectFeatureDisabled(client.getSchool(), 'cadet');
  });
});

describe('the assistant in a school without an active plan', () => {
  it('stays visible to the roles it is switched on for and starts no turn, with the no-plan error', async () => {
    const school = await createTestSchool({ tier: null });
    await createTestSchoolTrial({ schoolId: school.id, tier: 'plus' });
    await setTestSchoolFeature(school.id, 'assistant', true, { monthlyLimitUsd: null });
    const principal = await createSchoolStaffSession(school.id, [{ role: 'principal', meta: null }]);
    expect(await resolveAssistantAccess(db, { schoolId: school.id, userId: principal.user.id })).toMatchObject({ allowed: true, noPlan: false });

    await runOutTrials(school.id);
    const decision = await resolveAssistantAccess(db, { schoolId: school.id, userId: principal.user.id });
    expect(decision).toMatchObject({
      featureEnabled: true,
      member: true,
      allowedRoles: ['principal'],
      suspended: false,
      noPlan: true,
      allowed: false,
      refusal: { code: 'no_plan', message: SCHOOL_NO_PLAN_MESSAGE },
    });
    const error = assistantAccessError(decision.refusal!);
    expect(isSchoolNoPlanError(error)).toBe(true);

    // Suspended as well: the suspension is what the user is told.
    await createTestClient(await createAdminSession()).systemAdmin.suspendSchool({ id: school.id, reason: 'Misuse' });
    expect(await resolveAssistantAccess(db, { schoolId: school.id, userId: principal.user.id })).toMatchObject({
      suspended: true,
      noPlan: true,
      refusal: { code: 'school_suspended' },
    });
  });
});

describe('what the school\'s own apps are told about its plan', () => {
  it('says whether the school has a plan, and when a trial that gives the plan ends', async () => {
    const subscribed = await createTestSchool({ tier: 'pro' });
    const onTrial = await createTestSchool({ tier: 'plus' });
    const below = await createTestSchool({ tier: 'enterprise' });
    const none = await createTestSchool({ tier: null });
    const trial = await createTestSchoolTrial({ schoolId: onTrial.id, tier: 'enterprise', endsAt: daysFromNow(5) });
    await createTestSchoolTrial({ schoolId: below.id, tier: 'pro' });
    const principal = await createSchoolStaffSession(subscribed.id, [{ role: 'principal', meta: null }]);
    for (const school of [onTrial, below, none]) {
      await createTestSchoolMember({ schoolId: school.id, userId: principal.user.id, roles: [{ role: 'principal', meta: null }] });
    }
    const client = createTestClient(principal.session);

    const mine = new Map((await client.school.listMySchools()).map((school) => [school.id, school]));
    expect(mine.get(subscribed.id)).toMatchObject({ hasActivePlan: true, trialEndsAt: null });
    expect(mine.get(onTrial.id)).toMatchObject({ hasActivePlan: true, trialEndsAt: trial.endsAt.toISOString() });
    // A trial below the subscription gives nothing, so nothing is said about its end.
    expect(mine.get(below.id)).toMatchObject({ hasActivePlan: true, trialEndsAt: null });
    expect(mine.get(none.id)).toMatchObject({ hasActivePlan: false, trialEndsAt: null });
    expect(await client.school.getSchool({ schoolId: onTrial.id })).toMatchObject({ hasActivePlan: true, trialEndsAt: trial.endsAt.toISOString() });
    // Read-only, but readable: the facts are there for a school without a plan too.
    expect(await client.school.getSchool({ schoolId: none.id })).toMatchObject({ hasActivePlan: false, trialEndsAt: null });
    await expect(client.school.updateSchool({ schoolId: onTrial.id, name: 'Renamed On A Trial' })).resolves.toMatchObject({
      name: 'Renamed On A Trial',
      hasActivePlan: true,
      trialEndsAt: trial.endsAt.toISOString(),
    });
  });

  it('tells the Cadet Portal the same', async () => {
    const school = await createTestSchool({ tier: null });
    const trial = await createTestSchoolTrial({ schoolId: school.id, tier: 'enterprise' });
    const admission = await createTestAdmission({ schoolId: school.id });
    const { client } = await createCadetLogin(admission.id);
    await expect(client.getSchool()).resolves.toMatchObject({ isSuspended: false, hasActivePlan: true, trialEndsAt: trial.endsAt.toISOString() });
  });
});

describe('the no-plan error', () => {
  it('is FORBIDDEN with a stable reason, readable on both sides of the wire, and not confused with other errors', () => {
    const error = schoolNoPlanError();
    expect(error.code).toBe('FORBIDDEN');
    expect(error.data).toEqual({ reason: SCHOOL_NO_PLAN_REASON });
    expect(error.message).toBe(SCHOOL_NO_PLAN_MESSAGE);
    expect(isSchoolNoPlanError(JSON.parse(JSON.stringify(error.toJSON())))).toBe(true);
    expect(schoolWriteRefusalOf(error)).toBe(SCHOOL_NO_PLAN_REASON);
    expect(isSchoolNoPlanError({ code: 'FORBIDDEN', data: { reason: SCHOOL_SUSPENDED_REASON } })).toBe(false);
    expect(isSchoolNoPlanError({ code: 'FORBIDDEN', data: { reason: 'SCHOOL_FEATURE_DISABLED', feature: 'cadet' } })).toBe(false);
    expect(isSchoolNoPlanError({ code: 'NOT_FOUND', data: { reason: SCHOOL_NO_PLAN_REASON } })).toBe(false);
    expect(schoolWriteRefusalOf(null)).toBeNull();
  });
});
