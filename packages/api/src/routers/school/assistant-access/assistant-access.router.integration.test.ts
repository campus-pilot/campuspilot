import { db } from '@campuspilot/db';
import { schoolAssistantAccessRoleTable } from '@campuspilot/db/schema/assistant';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { expectFeatureDisabled, expectPermissionDenied } from '../../../../test/feature-flags';
import { createSchoolStaffSession, createTestClient, createTestSchool, setTestSchoolFeature } from '../../../../test/fixtures';

const schoolWithAssistant = (eligibleRoles: Array<'principal' | 'manager' | 'teacher' | 'accountant' | 'exam_coordinator'>) =>
  createTestSchool({ features: [{ feature: 'assistant', config: { monthlyLimitUsd: 20, eligibleRoles } }] });

const principalOf = async (schoolId: string) =>
  createTestClient((await createSchoolStaffSession(schoolId, [{ role: 'principal' }])).session);

const storedRoles = async (schoolId: string) =>
  (await db.select().from(schoolAssistantAccessRoleTable).where(eq(schoolAssistantAccessRoleTable.schoolId, schoolId)))
    .map((row) => row.role)
    .sort();

describe('school.getAssistantAccess / school.updateAssistantRoles', () => {
  it('lets the principal switch eligible roles on and off, and reports both facts per role', async () => {
    const school = await schoolWithAssistant(['principal', 'teacher']);
    const principal = await principalOf(school.id);

    await expect(principal.school.getAssistantAccess({ schoolId: school.id })).resolves.toEqual({
      schoolId: school.id,
      monthlyLimitUsd: 20,
      roles: [
        { role: 'principal', eligible: true, enabled: false },
        { role: 'manager', eligible: false, enabled: false },
        { role: 'teacher', eligible: true, enabled: false },
        { role: 'accountant', eligible: false, enabled: false },
        { role: 'exam_coordinator', eligible: false, enabled: false },
      ],
    });

    const updated = await principal.school.updateAssistantRoles({
      schoolId: school.id,
      roles: [
        { role: 'teacher', enabled: true },
        { role: 'principal', enabled: true },
      ],
    });
    expect(updated.roles.filter((role) => role.enabled).map((role) => role.role)).toEqual(['principal', 'teacher']);
    expect(await storedRoles(school.id)).toEqual(['principal', 'teacher']);

    await principal.school.updateAssistantRoles({ schoolId: school.id, roles: [{ role: 'teacher', enabled: false }] });
    expect(await storedRoles(school.id)).toEqual(['principal']);
  });

  it('lets the manager manage it too', async () => {
    const school = await schoolWithAssistant(['teacher']);
    const manager = createTestClient((await createSchoolStaffSession(school.id, [{ role: 'manager' }])).session);
    await manager.school.updateAssistantRoles({ schoolId: school.id, roles: [{ role: 'teacher', enabled: true }] });
    expect(await storedRoles(school.id)).toEqual(['teacher']);
  });

  it('refuses to switch on a role the platform did not make eligible, and keeps a stored one that stopped being eligible', async () => {
    const school = await schoolWithAssistant(['teacher']);
    const principal = await principalOf(school.id);
    await expect(
      principal.school.updateAssistantRoles({ schoolId: school.id, roles: [{ role: 'accountant', enabled: true }] }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(await storedRoles(school.id)).toEqual([]);

    await principal.school.updateAssistantRoles({ schoolId: school.id, roles: [{ role: 'teacher', enabled: true }] });
    await setTestSchoolFeature(school.id, 'assistant', true, { monthlyLimitUsd: null, eligibleRoles: ['principal'] });
    const access = await principal.school.getAssistantAccess({ schoolId: school.id });
    expect(access.roles.find((role) => role.role === 'teacher')).toEqual({ role: 'teacher', eligible: false, enabled: true });
    // It can still be switched off.
    await principal.school.updateAssistantRoles({ schoolId: school.id, roles: [{ role: 'teacher', enabled: false }] });
    expect(await storedRoles(school.id)).toEqual([]);
  });

  it('refuses roles a teacher holds, anonymous callers and other schools', async () => {
    const school = await schoolWithAssistant(['teacher']);
    const teacher = createTestClient(
      (await createSchoolStaffSession(school.id, [{ role: 'teacher', meta: { classIds: [] } }])).session,
    );
    await expectPermissionDenied(teacher.school.getAssistantAccess({ schoolId: school.id }));
    await expectPermissionDenied(teacher.school.updateAssistantRoles({ schoolId: school.id, roles: [{ role: 'teacher', enabled: true }] }));
    await expect(createTestClient(null).school.getAssistantAccess({ schoolId: school.id })).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    const other = await schoolWithAssistant(['teacher']);
    const otherPrincipal = await principalOf(other.id);
    await expectPermissionDenied(otherPrincipal.school.getAssistantAccess({ schoolId: school.id }));
    expect(await storedRoles(school.id)).toEqual([]);
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
    const school = await schoolWithAssistant(['teacher']);
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
  });
});
