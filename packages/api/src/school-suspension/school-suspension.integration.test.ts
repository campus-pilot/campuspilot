import { db } from '@campuspilot/db';
import { cadetPushSubscriptionTable } from '@campuspilot/db/schema/notification';
import { schoolAssistantAccessRoleTable } from '@campuspilot/db/schema/assistant';
import { schoolTable } from '@campuspilot/db/schema/school';
import { and, eq, isNull } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { expectPermissionDenied } from '../../test/feature-flags';
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
  setTestSchoolFeature,
} from '../../test/fixtures';
import { billIssuedData, createCadetLogin, emitAndDispatch, fakePushSubscription } from '../../test/notifications';
import { assistantAccessError, resolveAssistantAccess } from '../assistant/access';
import { notificationRowId } from '../notifications/ids';
import { handleAdmissionPhotoRead, handleAdmissionPhotoUpload } from '../routers/school/admission/admission.http';
import { schoolRouter } from '../routers/school/school.router';
import { isSchoolSuspendedError, SCHOOL_SUSPENDED_MESSAGE, SCHOOL_SUSPENDED_REASON } from './school-suspension.contract';
import { isSchoolSuspended, schoolSuspendedError } from './school-suspension.service';

/**
 * School suspension (docs/school-suspension.md): a suspended school is
 * read-only. Its staff and students still read everything; every change is
 * refused with FORBIDDEN `data.reason = 'SCHOOL_SUSPENDED'`.
 */

/** Asserts the suspended-school refusal: FORBIDDEN carrying the stable reason, with the message every app shows. */
async function expectSchoolSuspended(promise: Promise<unknown>): Promise<void> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error, 'the call should have been refused').not.toBeNull();
  expect(error).toMatchObject({ code: 'FORBIDDEN', message: SCHOOL_SUSPENDED_MESSAGE, data: { reason: SCHOOL_SUSPENDED_REASON } });
  expect(isSchoolSuspendedError(error)).toBe(true);
}

const adminClient = async () => createTestClient(await createAdminSession());

const storedSchool = async (schoolId: string) => {
  const [school] = await db.select().from(schoolTable).where(eq(schoolTable.id, schoolId));
  return school!;
};

/** A school with a principal, suspended by an administrator. */
async function suspendedSchool(options: Parameters<typeof createTestSchool>[0] = {}) {
  const school = await createTestSchool(options);
  const principal = await createSchoolStaffSession(school.id, [{ role: 'principal', meta: null }]);
  const admin = await adminClient();
  await admin.systemAdmin.suspendSchool({ id: school.id, reason: 'Misuse of the platform' });
  return { school, principal, admin, client: createTestClient(principal.session) };
}

describe('systemAdmin.suspendSchool / systemAdmin.unsuspendSchool', () => {
  it('suspends a school with a reason, keeps the first moment when only the reason changes, and clears all of it when lifted', async () => {
    const school = await createTestSchool();
    const adminSession = await createAdminSession();
    const admin = createTestClient(adminSession);
    expect(await isSchoolSuspended(db, school.id)).toBe(false);

    const suspended = await admin.systemAdmin.suspendSchool({ id: school.id, reason: '  Sharing accounts  ' });
    expect(suspended).toMatchObject({ id: school.id, suspendedReason: 'Sharing accounts' });
    expect(suspended.suspendedAt).not.toBeNull();
    expect(await isSchoolSuspended(db, school.id)).toBe(true);
    const first = await storedSchool(school.id);
    expect(first).toMatchObject({ suspendedReason: 'Sharing accounts', suspendedBy: adminSession.user.id });

    // Suspending again replaces the reason and keeps when it was first suspended.
    const again = await admin.systemAdmin.suspendSchool({ id: school.id, reason: 'Unpaid invoices' });
    expect(again.suspendedReason).toBe('Unpaid invoices');
    expect(again.suspendedAt).toBe(suspended.suspendedAt);
    expect((await storedSchool(school.id)).suspendedAt).toEqual(first.suspendedAt);
    expect((await admin.systemAdmin.getSchool({ id: school.id })).suspendedReason).toBe('Unpaid invoices');

    // Lifting clears the three facts together; lifting again changes nothing.
    const lifted = await admin.systemAdmin.unsuspendSchool({ id: school.id });
    expect(lifted).toMatchObject({ id: school.id, suspendedAt: null, suspendedReason: null });
    expect(await storedSchool(school.id)).toMatchObject({ suspendedAt: null, suspendedReason: null, suspendedBy: null });
    expect(await isSchoolSuspended(db, school.id)).toBe(false);
    await expect(admin.systemAdmin.unsuspendSchool({ id: school.id })).resolves.toMatchObject({ suspendedAt: null });
  });

  it('needs a reason, and an existing school', async () => {
    const school = await createTestSchool();
    const admin = await adminClient();
    await expectRpcCode(admin.systemAdmin.suspendSchool({ id: school.id, reason: '' }), 'BAD_REQUEST');
    await expectRpcCode(admin.systemAdmin.suspendSchool({ id: school.id, reason: '   ' }), 'BAD_REQUEST');
    await expectRpcCode(admin.systemAdmin.suspendSchool({ id: school.id } as never), 'BAD_REQUEST');
    await expectRpcCode(admin.systemAdmin.suspendSchool({ id: school.id, reason: 'x'.repeat(1001) }), 'BAD_REQUEST');
    expect(await isSchoolSuspended(db, school.id)).toBe(false);
    await expectRpcCode(admin.systemAdmin.suspendSchool({ id: 'sch_missing', reason: 'Misuse' }), 'NOT_FOUND');
    await expectRpcCode(admin.systemAdmin.unsuspendSchool({ id: 'sch_missing' }), 'NOT_FOUND');
    expect(await isSchoolSuspended(db, 'sch_missing')).toBe(false);
  });

  it('is for platform administrators only: not the school\'s own principal, an ordinary user or an anonymous caller', async () => {
    const school = await createTestSchool();
    const principal = await createSchoolStaffSession(school.id, [{ role: 'principal', meta: null }]);
    for (const session of [principal.session, await createRegularUserSession()]) {
      const client = createTestClient(session);
      await expectRpcCode(client.systemAdmin.suspendSchool({ id: school.id, reason: 'Misuse' }), 'FORBIDDEN');
      await expectRpcCode(client.systemAdmin.unsuspendSchool({ id: school.id }), 'FORBIDDEN');
    }
    await expectRpcCode(createTestClient(null).systemAdmin.suspendSchool({ id: school.id, reason: 'Misuse' }), 'UNAUTHORIZED');
    expect(await isSchoolSuspended(db, school.id)).toBe(false);

    // Nor can the school's principal lift a suspension.
    await (await adminClient()).systemAdmin.suspendSchool({ id: school.id, reason: 'Misuse' });
    await expectRpcCode(createTestClient(principal.session).systemAdmin.unsuspendSchool({ id: school.id }), 'FORBIDDEN');
    expect(await isSchoolSuspended(db, school.id)).toBe(true);
  });
});

describe('a suspended school is read-only for its staff', () => {
  it('still answers reads, refuses every change with the suspended error and writes nothing, until the suspension is lifted', async () => {
    const { school, admin, client } = await suspendedSchool({ features: ['cadet'] });

    // Reads work exactly as before.
    await expect(client.school.getSchool({ schoolId: school.id })).resolves.toMatchObject({ id: school.id, name: school.name, isSuspended: true });
    await expect(client.school.getFeatureFlags({ schoolId: school.id })).resolves.toMatchObject({ schoolId: school.id });
    await expect(client.school.getCadetPortalSettings({ schoolId: school.id })).resolves.toEqual({ schoolId: school.id, showClassAverages: false });
    await expect(client.school.listClasses({ schoolId: school.id })).resolves.toBeDefined();

    // Changes are refused, whatever area they belong to.
    await expectSchoolSuspended(client.school.updateSchool({ schoolId: school.id, name: 'Renamed While Suspended' }));
    await expectSchoolSuspended(client.school.updateCadetPortalSettings({ schoolId: school.id, showClassAverages: true }));
    await expectSchoolSuspended(
      client.school.createClass({ schoolId: school.id, slug: 'class-1', label: 'Class 1', sections: [{ slug: 'a', label: 'A' }] } as never),
    );
    // The gate answers before the input is validated, so a malformed change is refused the same way.
    await expectSchoolSuspended(client.school.updateSchool({ schoolId: school.id } as never));
    expect(await storedSchool(school.id)).toMatchObject({ name: school.name, cadetShowClassAverages: false });
    expect(await client.school.listClasses({ schoolId: school.id })).toEqual([]);

    // Lifting the suspension restores every change at once.
    await admin.systemAdmin.unsuspendSchool({ id: school.id });
    await expect(client.school.updateSchool({ schoolId: school.id, name: 'Renamed After' })).resolves.toMatchObject({ name: 'Renamed After', isSuspended: false });
    await expect(client.school.updateCadetPortalSettings({ schoolId: school.id, showClassAverages: true })).resolves.toEqual({
      schoolId: school.id,
      showClassAverages: true,
    });
  });

  it('tells its members it is suspended in the list of their schools, and never the administrator\'s reason', async () => {
    const { school, principal, client } = await suspendedSchool();
    const other = await createTestSchool();
    await createTestSchoolMember({ schoolId: other.id, userId: principal.user.id, roles: [{ role: 'teacher', meta: { classIds: [] } }] });

    const mine = await client.school.listMySchools();
    expect(mine.map((item) => [item.id, item.isSuspended]).sort()).toEqual(
      [
        [school.id, true],
        [other.id, false],
      ].sort(),
    );
    expect(JSON.stringify(mine)).not.toContain('Misuse of the platform');
    expect(JSON.stringify(await client.school.getSchool({ schoolId: school.id }))).not.toContain('Misuse of the platform');
  });

  it('holds a write in another school of the same person only where that school is suspended', async () => {
    const { principal } = await suspendedSchool();
    const other = await createTestSchool();
    await createTestSchoolMember({ schoolId: other.id, userId: principal.user.id, roles: [{ role: 'principal', meta: null }] });
    await expect(
      createTestClient(principal.session).school.updateSchool({ schoolId: other.id, name: 'Other School Renamed' }),
    ).resolves.toMatchObject({ name: 'Other School Renamed', isSuspended: false });
  });

  it('answers someone who is not a member with the ordinary permission refusal, so the suspension tells outsiders nothing', async () => {
    const { school } = await suspendedSchool();
    const elsewhere = await createTestSchool();
    const outsider = createTestClient((await createSchoolStaffSession(elsewhere.id, [{ role: 'principal', meta: null }])).session);
    const regular = createTestClient(await createRegularUserSession());
    for (const client of [outsider, regular]) {
      await expectPermissionDenied(client.school.updateSchool({ schoolId: school.id, name: 'Probe' }));
      const error = await client.school.updateSchool({ schoolId: school.id, name: 'Probe' }).catch((caught: unknown) => caught);
      expect(isSchoolSuspendedError(error)).toBe(false);
    }
    await expectRpcCode(createTestClient(null).school.updateSchool({ schoolId: school.id, name: 'Probe' }), 'UNAUTHORIZED');
    expect((await storedSchool(school.id)).name).toBe(school.name);
  });

  it('holds the school\'s members and nobody else: a platform administrator outside the school is not held, one who is a member is', async () => {
    const { school } = await suspendedSchool();
    const adminSession = await createAdminSession();
    // Not a member: the platform's own grant on school actions decides, as for any school.
    await expect(
      createTestClient(adminSession).school.updateSchool({ schoolId: school.id, name: 'Corrected From Outside' }),
    ).resolves.toMatchObject({ name: 'Corrected From Outside', isSuspended: true });
    // A member (as the requesting administrator is of a demo school) is held like every member.
    await createTestSchoolMember({ schoolId: school.id, userId: adminSession.user.id, roles: [{ role: 'principal', meta: null }] });
    await expectSchoolSuspended(
      createTestClient(adminSession).school.updateSchool({ schoolId: school.id, name: 'Corrected As A Member' }),
    );

    // A teacher may not rename the school anyway; as a member they are told the school is suspended.
    const teacher = createTestClient((await createSchoolStaffSession(school.id, [{ role: 'teacher', meta: { classIds: [] } }])).session);
    await expectSchoolSuspended(teacher.school.updateSchool({ schoolId: school.id, name: 'Teacher Rename' }));
    expect((await storedSchool(school.id)).name).toBe('Corrected From Outside');
  });

  it('refuses uploads outside oRPC too, and still serves reads there', async () => {
    const school = await createTestSchool();
    const admission = await createTestAdmission({ schoolId: school.id });
    const manager = await createSchoolStaffSession(school.id, [{ role: 'manager', meta: null }]);
    const context = createHandlerContext(manager.session);
    const photoRequest = () => {
      const formData = new FormData();
      const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52]);
      formData.set('photo', new Blob([png], { type: 'image/png' }), 'student.png');
      return new Request('http://localhost/photo', { method: 'POST', body: formData });
    };
    const input = { schoolId: school.id, admissionId: admission.id };
    // Before the suspension the upload works, so there is a photo to read afterwards.
    expect((await handleAdmissionPhotoUpload(photoRequest(), context, input)).status).toBe(200);
    const { photoS3Key } = (await storedAdmissionPhoto(admission.id))!;

    await (await adminClient()).systemAdmin.suspendSchool({ id: school.id, reason: 'Misuse' });
    const refused = await handleAdmissionPhotoUpload(photoRequest(), context, input);
    expect(refused.status).toBe(403);
    expect(await refused.json()).toEqual({ code: 'FORBIDDEN', message: SCHOOL_SUSPENDED_MESSAGE });
    expect((await storedAdmissionPhoto(admission.id))!.photoS3Key).toBe(photoS3Key);
    // Reading the photo still redirects to it.
    expect((await handleAdmissionPhotoRead(context, input)).status).toBe(302);
    // Someone without the permission is told that, not that the school is suspended.
    const teacher = await createSchoolStaffSession(school.id, [{ role: 'teacher', meta: { classIds: [] } }]);
    const denied = await handleAdmissionPhotoUpload(photoRequest(), createHandlerContext(teacher.session), input);
    expect(denied.status).toBe(403);
    expect(((await denied.json()) as { message: string }).message).not.toBe(SCHOOL_SUSPENDED_MESSAGE);
  });
});

async function storedAdmissionPhoto(admissionId: string) {
  const { admissionTable } = await import('@campuspilot/db/schema/admission');
  const [admission] = await db.select({ photoS3Key: admissionTable.photoS3Key }).from(admissionTable).where(eq(admissionTable.id, admissionId));
  return admission;
}

describe('a suspended school is read-only in the Cadet Portal', () => {
  it('lets a student read, refuses turning notifications on and marking them read, and still lets them turn a device off', async () => {
    const school = await createTestSchool({ features: ['cadet'] });
    const admission = await createTestAdmission({ schoolId: school.id });
    const { client, userId } = await createCadetLogin(admission.id);
    const { eventId } = await emitAndDispatch({
      type: 'bill.issued',
      data: billIssuedData(admission.id, { billNumber: 'BILL/1' }),
      schoolId: school.id,
      recipients: { kind: 'admissions', admissionIds: [admission.id] },
    });
    const notificationId = notificationRowId(eventId, { kind: 'admission', id: admission.id });
    const device = fakePushSubscription();
    await client.subscribePush(device);
    await expect(client.getSchool()).resolves.toMatchObject({ id: school.id, isSuspended: false });

    const admin = await adminClient();
    await admin.systemAdmin.suspendSchool({ id: school.id, reason: 'Misuse' });

    // Reads: the school (which now says it is suspended), the student's record and their inbox.
    await expect(client.getSchool()).resolves.toMatchObject({ id: school.id, name: school.name, isSuspended: true });
    expect(JSON.stringify(await client.getSchool())).not.toContain('Misuse');
    await expect(client.getAdmission()).resolves.toMatchObject({ id: admission.id });
    await expect(client.getUnreadNotificationCount()).resolves.toEqual({ count: 1 });
    expect((await client.listNotifications({})).items.map((item) => item.id)).toEqual([notificationId]);
    await expect(client.getPushSubscription({ endpoint: device.endpoint })).resolves.toEqual({ active: true });

    // Changes are refused and nothing is written.
    await expectSchoolSuspended(client.subscribePush(fakePushSubscription()));
    await expectSchoolSuspended(client.markNotificationsRead({ ids: [notificationId] }));
    await expectSchoolSuspended(client.markAllNotificationsRead({}));
    await expect(client.getUnreadNotificationCount()).resolves.toEqual({ count: 1 });
    const active = await db
      .select({ endpoint: cadetPushSubscriptionTable.endpoint })
      .from(cadetPushSubscriptionTable)
      .where(and(eq(cadetPushSubscriptionTable.cadetUserId, userId), isNull(cadetPushSubscriptionTable.revokedAt)));
    expect(active.map((row) => row.endpoint)).toEqual([device.endpoint]);

    // Turning this device's notifications off only undoes something on the student's own device: it stays possible.
    await expect(client.unsubscribePush({ endpoint: device.endpoint })).resolves.toEqual({ changed: true });
    await expect(client.getPushSubscription({ endpoint: device.endpoint })).resolves.toEqual({ active: false });

    // Lifted: the student can change things again.
    await admin.systemAdmin.unsuspendSchool({ id: school.id });
    await expect(client.markNotificationsRead({ ids: [notificationId] })).resolves.toEqual({ changed: 1 });
    await expect(client.subscribePush(device)).resolves.toEqual({ active: true });
    await expect(client.getSchool()).resolves.toMatchObject({ isSuspended: false });
  });
});

describe('the assistant in a suspended school', () => {
  it('stays visible to the roles it is switched on for and starts no turn, with the suspended error', async () => {
    const school = await createTestSchool();
    await setTestSchoolFeature(school.id, 'assistant', true, { monthlyLimitUsd: null });
    const principal = await createSchoolStaffSession(school.id, [{ role: 'principal', meta: null }]);
    const teacher = await createSchoolStaffSession(school.id, [{ role: 'teacher', meta: { classIds: [] } }]);
    const admin = await adminClient();
    expect(await resolveAssistantAccess(db, { schoolId: school.id, userId: principal.user.id })).toMatchObject({ allowed: true, suspended: false, refusal: null });

    await admin.systemAdmin.suspendSchool({ id: school.id, reason: 'Misuse' });
    const decision = await resolveAssistantAccess(db, { schoolId: school.id, userId: principal.user.id });
    expect(decision).toMatchObject({
      featureEnabled: true,
      member: true,
      // Still non-empty: the user keeps seeing the assistant and their conversations.
      allowedRoles: ['principal'],
      suspended: true,
      limitReached: false,
      allowed: false,
      refusal: { code: 'school_suspended', message: SCHOOL_SUSPENDED_MESSAGE },
    });
    // The refusal is the platform's one suspended-school error.
    const error = assistantAccessError(decision.refusal!);
    expect(isSchoolSuspendedError(error)).toBe(true);
    expect(error).toMatchObject({ code: 'FORBIDDEN', data: { reason: SCHOOL_SUSPENDED_REASON } });

    // Someone the assistant is not switched on for learns nothing about the suspension.
    expect(await resolveAssistantAccess(db, { schoolId: school.id, userId: teacher.user.id })).toMatchObject({
      suspended: false,
      refusal: { code: 'role_not_enabled' },
    });

    // The school's settings are a change like any other: the role list cannot be edited while suspended.
    await expectSchoolSuspended(
      createTestClient(principal.session).school.updateAssistantRoles({ schoolId: school.id, roles: [{ role: 'teacher', enabled: true }] }),
    );
    expect(
      (await db.select().from(schoolAssistantAccessRoleTable).where(eq(schoolAssistantAccessRoleTable.schoolId, school.id))).map((row) => row.role),
    ).not.toContain('teacher');
    // The platform administrator can still prepare them.
    await expect(
      admin.systemAdmin.updateSchoolAssistantRoles({ id: school.id, roles: [{ role: 'teacher', enabled: true }] }),
    ).resolves.toMatchObject({ schoolId: school.id });

    await admin.systemAdmin.unsuspendSchool({ id: school.id });
    expect(await resolveAssistantAccess(db, { schoolId: school.id, userId: principal.user.id })).toMatchObject({ allowed: true, suspended: false });
  });
});

describe('the suspended-school error', () => {
  it('is FORBIDDEN with a stable reason, readable on both sides of the wire, and not confused with other errors', () => {
    const error = schoolSuspendedError();
    expect(error.code).toBe('FORBIDDEN');
    expect(error.status).toBe(403);
    expect(error.data).toEqual({ reason: SCHOOL_SUSPENDED_REASON });
    expect(error.message).toBe(SCHOOL_SUSPENDED_MESSAGE);
    expect(isSchoolSuspendedError(error)).toBe(true);
    expect(isSchoolSuspendedError(JSON.parse(JSON.stringify(error.toJSON())))).toBe(true);

    expect(isSchoolSuspendedError(null)).toBe(false);
    expect(isSchoolSuspendedError(new Error('nope'))).toBe(false);
    expect(isSchoolSuspendedError({ code: 'FORBIDDEN' })).toBe(false);
    expect(isSchoolSuspendedError({ code: 'FORBIDDEN', data: { reason: 'SCHOOL_FEATURE_DISABLED', feature: 'cadet' } })).toBe(false);
    expect(isSchoolSuspendedError({ code: 'NOT_FOUND', data: { reason: SCHOOL_SUSPENDED_REASON } })).toBe(false);
  });
});

/**
 * The suspension gate lives in `requireAuth` and finds the school by the
 * input's `schoolId`. A school-scoped change whose input names its school
 * any other way (or not at all) would silently escape a suspension, so every
 * procedure of the school router that is not an explicit read must accept a
 * `schoolId` string.
 */
describe('every change in the school router names its school as `schoolId`', () => {
  type JsonSchema = {
    properties?: Record<string, unknown>;
    allOf?: JsonSchema[];
    anyOf?: JsonSchema[];
    oneOf?: JsonSchema[];
  };

  /** Whether every value the schema accepts may carry a `schoolId` property. */
  function acceptsSchoolId(schema: JsonSchema): boolean {
    if (schema.properties && 'schoolId' in schema.properties) return true;
    if (schema.allOf?.some(acceptsSchoolId)) return true;
    const alternatives = schema.anyOf ?? schema.oneOf;
    return alternatives !== undefined && alternatives.length > 0 && alternatives.every(acceptsSchoolId);
  }

  type ProcedureLike = { '~orpc': { meta: { mcp?: { access?: string } }; inputSchema?: z.ZodType } };

  it('so the suspension gate can find it', () => {
    const procedures = Object.entries(schoolRouter as unknown as Record<string, ProcedureLike>);
    expect(procedures.length).toBeGreaterThan(100);
    const writes = procedures.filter(([, procedure]) => procedure['~orpc'].meta.mcp?.access !== 'read');
    expect(writes.length).toBeGreaterThan(30);
    const withoutSchoolId = writes
      .filter(([, procedure]) => {
        const input = procedure['~orpc'].inputSchema;
        if (!input) return true;
        return !acceptsSchoolId(z.toJSONSchema(input, { io: 'input', unrepresentable: 'any' }) as JsonSchema);
      })
      .map(([name]) => name)
      .sort();
    expect(withoutSchoolId).toEqual([]);
  });

  it('and every procedure states whether it is a read', () => {
    const undeclared = Object.entries(schoolRouter as unknown as Record<string, ProcedureLike>)
      .filter(([, procedure]) => procedure['~orpc'].meta.mcp?.access === undefined)
      .map(([name]) => name);
    // A procedure without metadata is treated as a change (refused in a suspended school), never as a read.
    expect(undeclared).toEqual([]);
  });
});
