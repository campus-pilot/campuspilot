import { db } from '@campuspilot/db';
import { schoolAssistantAccessRoleTable } from '@campuspilot/db/schema/assistant';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

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
      monthlyLimitUsd: 20,
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
