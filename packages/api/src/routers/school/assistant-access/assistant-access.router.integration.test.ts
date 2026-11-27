import { db } from '@campuspilot/db';
import { assistantModelRequestTable, schoolAssistantAccessRoleTable } from '@campuspilot/db/schema/assistant';
import { schoolMemberTable } from '@campuspilot/db/schema/school-member';
import { getRedisClient } from '@campuspilot/redis/client';
import { and, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { resolveAssistantAccess } from '../../../assistant/access';
import { assistantAllowanceOf } from '../../../assistant/allowance';
import { schoolSpendWindow } from '../../../assistant/spend';

import { expectFeatureDisabled, expectPermissionDenied } from '../../../../test/feature-flags';
import {
  createAdminSession,
  createRegularUserSession,
  createSchoolStaffSession,
  createTestClient,
  createTestSchool,
  setTestSchoolFeature,
} from '../../../../test/fixtures';

/**
 * A school with the assistant switched on. Switching it on for a school
 * with no role switched on switches the default roles on (principal,
 * manager, exam coordinator, accountant).
 */
const schoolWithAssistant = () =>
  createTestSchool({ features: [{ feature: 'assistant', config: { monthlyLimitUsd: 20 } }] });

const DEFAULT_ROLES = ['accountant', 'exam_coordinator', 'manager', 'principal'];

const principalOf = async (schoolId: string) =>
  createTestClient((await createSchoolStaffSession(schoolId, [{ role: 'principal' }])).session);

const storedRoles = async (schoolId: string) =>
  (await db.select().from(schoolAssistantAccessRoleTable).where(eq(schoolAssistantAccessRoleTable.schoolId, schoolId)))
    .map((row) => row.role)
    .sort();

const switchedOn = (access: { roles: { role: string; enabled: boolean }[] }) =>
  access.roles.filter((role) => role.enabled).map((role) => role.role).sort();

describe('school.getAssistantAccess / school.updateAssistantRoles', () => {
  it('shows the default roles switched on with the assistant, and lets the principal switch any role on and off', async () => {
    const school = await schoolWithAssistant();
    const principal = await principalOf(school.id);

    await expect(principal.school.getAssistantAccess({ schoolId: school.id })).resolves.toEqual({
      schoolId: school.id,
      // Whether there is a limit, never its amount.
      limited: true,
      roles: [
        { role: 'principal', enabled: true },
        { role: 'manager', enabled: true },
        { role: 'teacher', enabled: false },
        { role: 'accountant', enabled: true },
        { role: 'exam_coordinator', enabled: true },
      ],
    });

    // Any role can be switched on: there is no separate list of eligible roles.
    const updated = await principal.school.updateAssistantRoles({
      schoolId: school.id,
      roles: [
        { role: 'teacher', enabled: true },
        { role: 'accountant', enabled: false },
      ],
    });
    expect(switchedOn(updated)).toEqual(['exam_coordinator', 'manager', 'principal', 'teacher']);
    expect(await storedRoles(school.id)).toEqual(['exam_coordinator', 'manager', 'principal', 'teacher']);

    // Roles not named keep their state.
    await principal.school.updateAssistantRoles({ schoolId: school.id, roles: [{ role: 'teacher', enabled: false }] });
    expect(await storedRoles(school.id)).toEqual(['exam_coordinator', 'manager', 'principal']);
  });

  it('lets the manager manage it too, down to an empty list', async () => {
    const school = await schoolWithAssistant();
    const manager = createTestClient((await createSchoolStaffSession(school.id, [{ role: 'manager' }])).session);
    await manager.school.updateAssistantRoles({ schoolId: school.id, roles: [{ role: 'teacher', enabled: true }] });
    expect(await storedRoles(school.id)).toEqual([...DEFAULT_ROLES, 'teacher'].sort());
    const none = await manager.school.updateAssistantRoles({
      schoolId: school.id,
      roles: (['principal', 'manager', 'teacher', 'accountant', 'exam_coordinator'] as const).map((role) => ({ role, enabled: false })),
    });
    expect(switchedOn(none)).toEqual([]);
    expect(await storedRoles(school.id)).toEqual([]);
  });

  it('is the same list the platform administrator edits: each sees what the other saved', async () => {
    const school = await schoolWithAssistant();
    const principal = await principalOf(school.id);
    const admin = createTestClient(await createAdminSession());

    // The administrator's read shows what enabling switched on.
    await expect(admin.systemAdmin.getSchoolAssistantRoles({ id: school.id })).resolves.toEqual({
      schoolId: school.id,
      roles: [
        { role: 'principal', enabled: true },
        { role: 'manager', enabled: true },
        { role: 'teacher', enabled: false },
        { role: 'accountant', enabled: true },
        { role: 'exam_coordinator', enabled: true },
      ],
    });

    // Administrator → school.
    const byAdmin = await admin.systemAdmin.updateSchoolAssistantRoles({
      id: school.id,
      roles: [
        { role: 'teacher', enabled: true },
        { role: 'manager', enabled: false },
      ],
    });
    expect(switchedOn(byAdmin)).toEqual(['accountant', 'exam_coordinator', 'principal', 'teacher']);
    expect(switchedOn(await principal.school.getAssistantAccess({ schoolId: school.id }))).toEqual(['accountant', 'exam_coordinator', 'principal', 'teacher']);

    // School → administrator.
    await principal.school.updateAssistantRoles({ schoolId: school.id, roles: [{ role: 'accountant', enabled: false }] });
    expect(switchedOn(await admin.systemAdmin.getSchoolAssistantRoles({ id: school.id }))).toEqual(['exam_coordinator', 'principal', 'teacher']);
    expect(await storedRoles(school.id)).toEqual(['exam_coordinator', 'principal', 'teacher']);
  });

  it('refuses roles a teacher holds, anonymous callers and other schools', async () => {
    const school = await schoolWithAssistant();
    const teacher = createTestClient(
      (await createSchoolStaffSession(school.id, [{ role: 'teacher', meta: { classIds: [] } }])).session,
    );
    await expectPermissionDenied(teacher.school.getAssistantAccess({ schoolId: school.id }));
    await expectPermissionDenied(teacher.school.updateAssistantRoles({ schoolId: school.id, roles: [{ role: 'teacher', enabled: true }] }));
    await expect(createTestClient(null).school.getAssistantAccess({ schoolId: school.id })).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    const other = await schoolWithAssistant();
    const otherPrincipal = await principalOf(other.id);
    await expectPermissionDenied(otherPrincipal.school.getAssistantAccess({ schoolId: school.id }));
    await expectPermissionDenied(otherPrincipal.school.updateAssistantRoles({ schoolId: school.id, roles: [{ role: 'teacher', enabled: true }] }));
    expect(await storedRoles(school.id)).toEqual(DEFAULT_ROLES);
  });

  it('answers the disabled-feature error while the school does not have the assistant, after the permission check', async () => {
    const school = await createTestSchool();
    const principal = await principalOf(school.id);
    await expectFeatureDisabled(principal.school.getAssistantAccess({ schoolId: school.id }), 'assistant');
    await expectFeatureDisabled(
      principal.school.updateAssistantRoles({ schoolId: school.id, roles: [{ role: 'teacher', enabled: true }] }),
      'assistant',
    );
    expect(await storedRoles(school.id)).toEqual([]);
  });

  it('validates the change list before anything else', async () => {
    const school = await schoolWithAssistant();
    const principal = await principalOf(school.id);
    await expect(principal.school.updateAssistantRoles({ schoolId: school.id, roles: [] })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(
      principal.school.updateAssistantRoles({
        schoolId: school.id,
        roles: [
          { role: 'teacher', enabled: true },
          { role: 'teacher', enabled: false },
        ],
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(
      principal.school.updateAssistantRoles({ schoolId: school.id, roles: [{ role: 'janitor' as 'teacher', enabled: true }] }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(await storedRoles(school.id)).toEqual(DEFAULT_ROLES);
  });
});

describe('systemAdmin.getSchoolAssistantRoles / systemAdmin.updateSchoolAssistantRoles', () => {
  it('lets an administrator prepare the roles before the assistant is switched on, and enabling then keeps them', async () => {
    const school = await createTestSchool();
    const admin = createTestClient(await createAdminSession());
    await admin.systemAdmin.updateSchoolAssistantRoles({ id: school.id, roles: [{ role: 'teacher', enabled: true }] });
    expect(await storedRoles(school.id)).toEqual(['teacher']);

    // The list is not empty, so switching the assistant on adds no default role to it.
    await setTestSchoolFeature(school.id, 'assistant', true, { monthlyLimitUsd: null });
    expect(await storedRoles(school.id)).toEqual(['teacher']);
  });

  it.each(['plus', 'pro', 'enterprise'] as const)(
    'switches the default roles on when an administrator enables the assistant for a %s school, recorded against them',
    async (tier) => {
      const school = await createTestSchool({ tier });
      const adminSession = await createAdminSession();
      const admin = createTestClient(adminSession);
      // The assistant is in no tier: off on every one of them until it is switched on for the school.
      expect((await admin.systemAdmin.getSchoolFeatureFlags({ id: school.id })).features.assistant).toMatchObject({ included: false, enabled: false, active: false });
      expect(await storedRoles(school.id)).toEqual([]);

      const enabled = await admin.systemAdmin.updateSchoolFeatureFlag({
        id: school.id,
        feature: 'assistant',
        enabled: true,
        config: { monthlyLimitUsd: 15, voice: { enabled: false } },
      });
      // Usable on every tier, also the one without student management.
      expect(enabled.features.assistant).toMatchObject({ included: false, adjustment: true, enabled: true, active: true });
      expect(await storedRoles(school.id)).toEqual(DEFAULT_ROLES);
      const rows = await db.select().from(schoolAssistantAccessRoleTable).where(eq(schoolAssistantAccessRoleTable.schoolId, school.id));
      expect(rows.every((row) => row.updatedBy === adminSession.user.id)).toBe(true);
      // What the administrator's page and the school's page then both show.
      expect(switchedOn(await admin.systemAdmin.getSchoolAssistantRoles({ id: school.id }))).toEqual(DEFAULT_ROLES);
      const principal = await principalOf(school.id);
      expect(switchedOn(await principal.school.getAssistantAccess({ schoolId: school.id }))).toEqual(DEFAULT_ROLES);

      // Saving the settings again, or switching it off and on, leaves a list the school has changed alone.
      await principal.school.updateAssistantRoles({ schoolId: school.id, roles: [{ role: 'accountant', enabled: false }] });
      await admin.systemAdmin.updateSchoolFeatureFlag({ id: school.id, feature: 'assistant', enabled: true, config: { monthlyLimitUsd: 30, voice: { enabled: false } } });
      await admin.systemAdmin.updateSchoolFeatureFlag({ id: school.id, feature: 'assistant', enabled: false, config: { monthlyLimitUsd: 30, voice: { enabled: false } } });
      await admin.systemAdmin.updateSchoolFeatureFlag({ id: school.id, feature: 'assistant', enabled: true, config: { monthlyLimitUsd: 30, voice: { enabled: false } } });
      expect(await storedRoles(school.id)).toEqual(['exam_coordinator', 'manager', 'principal']);
    },
  );

  it('is for platform administrators only, and answers NOT_FOUND for an unknown school', async () => {
    const school = await schoolWithAssistant();
    const principal = await principalOf(school.id);
    const regular = createTestClient(await createRegularUserSession());
    const admin = createTestClient(await createAdminSession());

    await expect(principal.systemAdmin.getSchoolAssistantRoles({ id: school.id })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      principal.systemAdmin.updateSchoolAssistantRoles({ id: school.id, roles: [{ role: 'teacher', enabled: true }] }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(regular.systemAdmin.getSchoolAssistantRoles({ id: school.id })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(createTestClient(null).systemAdmin.getSchoolAssistantRoles({ id: school.id })).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect(await storedRoles(school.id)).toEqual(DEFAULT_ROLES);

    await expect(admin.systemAdmin.getSchoolAssistantRoles({ id: 'school_missing' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      admin.systemAdmin.updateSchoolAssistantRoles({ id: 'school_missing', roles: [{ role: 'teacher', enabled: true }] }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(admin.systemAdmin.updateSchoolAssistantRoles({ id: school.id, roles: [] })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });
});

/**
 * Saves one model request as the voice relay would (it needs no run), at a
 * given instant (default now, inside the school's current window).
 */
async function spend(schoolId: string, userId: string, costUsd: string, at: Date = new Date()) {
  await db.insert(assistantModelRequestTable).values({
    source: 'voice',
    voiceSessionId: `avs_${randomUUID().replaceAll('-', '').slice(0, 21)}`,
    schoolId,
    userId,
    requestKey: `voice:allowance-test:${randomUUID()}`,
    provider: 'gemini',
    requestedModel: 'gemini-live',
    answeredModel: 'gemini-live',
    usageComplete: true,
    inputTokens: 10,
    outputTokens: 10,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
    inputUsdPerMtok: '1',
    outputUsdPerMtok: '1',
    cacheReadUsdPerMtok: '0',
    cacheWriteUsdPerMtok: '0',
    costUsd,
    createdAt: at,
  });
}

/** Forgets the limit check's cached total, as its 10 minutes running out would. */
async function expireSpendCache(schoolId: string) {
  const window = await schoolSpendWindow(db, schoolId);
  await getRedisClient().del(`assistant:spend:${schoolId}:${window.key}`);
}

describe('school.getAssistantAllowance', () => {
  it('shows the share of this window’s allowance used, overall and per person, and no amount of money', async () => {
    const school = await schoolWithAssistant();
    const principal = await createSchoolStaffSession(school.id, [{ role: 'principal' }]);
    const manager = await createSchoolStaffSession(school.id, [{ role: 'manager' }]);
    const deletedUserId = `usr_deleted_${randomUUID()}`;
    const window = await schoolSpendWindow(db, school.id);
    await spend(school.id, principal.user.id, '5');
    await spend(school.id, manager.user.id, '2.5');
    // A deleted account's use still counts, without a name.
    await spend(school.id, deletedUserId, '0.5');
    // The previous window and another school are not counted.
    await spend(school.id, principal.user.id, '10', new Date(window.start.getTime() - 60_000));
    const other = await schoolWithAssistant();
    await spend(other.id, principal.user.id, '10');

    const allowance = await createTestClient(principal.session).school.getAssistantAllowance({ schoolId: school.id });
    expect(allowance).toEqual({
      limited: true,
      // 8 of the school's 20.
      usedPercent: 40,
      windowStart: window.start,
      windowEnd: window.end,
      maxAgeSeconds: 600,
      users: [
        { userId: principal.user.id, name: principal.user.name, email: principal.user.email, phoneNumber: null, usedPercent: 25 },
        { userId: manager.user.id, name: manager.user.name, email: manager.user.email, phoneNumber: null, usedPercent: 12.5 },
        { userId: deletedUserId, name: null, email: null, phoneNumber: null, usedPercent: 2.5 },
      ],
    });
    expect(JSON.stringify(allowance)).not.toMatch(/usd|cost|limitUsd/i);
    // The manager reads it too.
    await expect(createTestClient(manager.session).school.getAssistantAllowance({ schoolId: school.id })).resolves.toMatchObject({ usedPercent: 40 });
  });

  it('reads the total the limit check reads: rounded down, 100% exactly when the assistant refuses', async () => {
    const school = await createTestSchool({ features: [{ feature: 'assistant', config: { monthlyLimitUsd: 3 } }] });
    const principal = await createSchoolStaffSession(school.id, [{ role: 'principal' }]);
    const client = createTestClient(principal.session);
    await spend(school.id, principal.user.id, '2.99999999');
    await expect(client.school.getAssistantAllowance({ schoolId: school.id })).resolves.toMatchObject({ usedPercent: 99.9 });
    expect(await resolveAssistantAccess(db, { schoolId: school.id, userId: principal.user.id })).toMatchObject({ allowed: true });

    // The total is the limit check's cached figure: a new request shows in it once the cache entry is gone.
    // The people's shares are read fresh, so they may be ahead of it meanwhile.
    await spend(school.id, principal.user.id, '0.00000001');
    await expect(client.school.getAssistantAllowance({ schoolId: school.id })).resolves.toMatchObject({
      usedPercent: 99.9,
      users: [expect.objectContaining({ usedPercent: 100 })],
    });
    await expireSpendCache(school.id);
    await expect(client.school.getAssistantAllowance({ schoolId: school.id })).resolves.toMatchObject({ usedPercent: 100 });
    expect(await resolveAssistantAccess(db, { schoolId: school.id, userId: principal.user.id })).toMatchObject({
      allowed: false,
      refusal: { code: 'limit_reached' },
    });
  });

  it('reads any spend as at least the smallest share, so a tiny one is never told as nothing', async () => {
    const school = await createTestSchool({ features: [{ feature: 'assistant', config: { monthlyLimitUsd: 50 } }] });
    const principal = await createSchoolStaffSession(school.id, [{ role: 'principal' }]);
    // 0.04 of 50 is 0.08%, which rounds down to 0.
    await spend(school.id, principal.user.id, '0.04');
    await expect(createTestClient(principal.session).school.getAssistantAllowance({ schoolId: school.id })).resolves.toMatchObject({
      usedPercent: 0.1,
      users: [expect.objectContaining({ userId: principal.user.id, usedPercent: 0.1 })],
    });
    // Nothing spent is still nothing.
    const quiet = await createTestSchool({ features: [{ feature: 'assistant', config: { monthlyLimitUsd: 50 } }] });
    const quietPrincipal = await createSchoolStaffSession(quiet.id, [{ role: 'principal' }]);
    await expect(createTestClient(quietPrincipal.session).school.getAssistantAllowance({ schoolId: quiet.id })).resolves.toMatchObject({
      usedPercent: 0,
      users: [],
    });
  });

  it('names someone who left the school, with their share, but not how they sign in', async () => {
    const school = await schoolWithAssistant();
    const principal = await createSchoolStaffSession(school.id, [{ role: 'principal' }]);
    const former = await createSchoolStaffSession(school.id, [{ role: 'manager' }]);
    await spend(school.id, principal.user.id, '2');
    await spend(school.id, former.user.id, '1');
    await db
      .delete(schoolMemberTable)
      .where(and(eq(schoolMemberTable.schoolId, school.id), eq(schoolMemberTable.userId, former.user.id)));

    const { users } = await createTestClient(principal.session).school.getAssistantAllowance({ schoolId: school.id });
    expect(users).toEqual([
      { userId: principal.user.id, name: principal.user.name, email: principal.user.email, phoneNumber: null, usedPercent: 10 },
      { userId: former.user.id, name: former.user.name, email: null, phoneNumber: null, usedPercent: 5 },
    ]);
  });

  it('has no percentage and no people for a school without a limit', async () => {
    const school = await createTestSchool({ features: [{ feature: 'assistant', config: { monthlyLimitUsd: null } }] });
    const principal = await createSchoolStaffSession(school.id, [{ role: 'principal' }]);
    const client = createTestClient(principal.session);
    await spend(school.id, principal.user.id, '4');
    const window = await schoolSpendWindow(db, school.id);
    await expect(client.school.getAssistantAllowance({ schoolId: school.id })).resolves.toEqual({
      limited: false,
      usedPercent: null,
      windowStart: window.start,
      windowEnd: window.end,
      maxAgeSeconds: 600,
      users: [],
    });
    await expect(client.school.getAssistantAccess({ schoolId: school.id })).resolves.toMatchObject({ limited: false });
  });

  it('is for the principal and manager only, behind the feature after the permission check', async () => {
    const school = await schoolWithAssistant();
    // The accountant may use the assistant (a default role) but not read the school's usage.
    const accountant = createTestClient((await createSchoolStaffSession(school.id, [{ role: 'accountant' }])).session);
    const teacher = createTestClient(
      (await createSchoolStaffSession(school.id, [{ role: 'teacher', meta: { classIds: [] } }])).session,
    );
    await expectPermissionDenied(accountant.school.getAssistantAllowance({ schoolId: school.id }));
    await expectPermissionDenied(teacher.school.getAssistantAllowance({ schoolId: school.id }));
    await expect(createTestClient(null).school.getAssistantAllowance({ schoolId: school.id })).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    const other = await schoolWithAssistant();
    await expectPermissionDenied((await principalOf(other.id)).school.getAssistantAllowance({ schoolId: school.id }));

    const withoutAssistant = await createTestSchool();
    await expectFeatureDisabled((await principalOf(withoutAssistant.id)).school.getAssistantAllowance({ schoolId: withoutAssistant.id }), 'assistant');
  });
});

describe('the allowance of a read-only school (assistantAllowanceOf)', () => {
  /** A principal of a school with a limit of 10 who spent 4 of it, then the school became read-only. */
  async function readOnlySchool(makeReadOnly: (schoolId: string) => Promise<void>, tier: 'plus' | null = 'plus') {
    const school = await createTestSchool({ tier, features: [{ feature: 'assistant', config: { monthlyLimitUsd: 10 } }] });
    const principal = await createSchoolStaffSession(school.id, [{ role: 'principal' }]);
    await spend(school.id, principal.user.id, '4');
    await makeReadOnly(school.id);
    return { schoolId: school.id, userId: principal.user.id };
  }

  it('reads the spend itself for a suspended school, whose decision stopped before the limit check', async () => {
    const admin = createTestClient(await createAdminSession());
    const target = await readOnlySchool(async (id) => void (await admin.systemAdmin.suspendSchool({ id, reason: 'Misuse' })));
    const decision = await resolveAssistantAccess(db, target);
    expect(decision).toMatchObject({ allowedRoles: ['principal'], refusal: { code: 'school_suspended' }, windowSpend: null });
    const window = await schoolSpendWindow(db, target.schoolId);
    await expect(assistantAllowanceOf(db, target.schoolId, decision)).resolves.toEqual({ usedPercent: 40, resetsAt: window.end });
  });

  it('reads the spend itself for a school without a plan', async () => {
    const target = await readOnlySchool(async () => undefined, null);
    const decision = await resolveAssistantAccess(db, target);
    expect(decision).toMatchObject({ allowedRoles: ['principal'], refusal: { code: 'no_plan' }, windowSpend: null });
    const window = await schoolSpendWindow(db, target.schoolId);
    await expect(assistantAllowanceOf(db, target.schoolId, decision)).resolves.toEqual({ usedPercent: 40, resetsAt: window.end });
  });
});
