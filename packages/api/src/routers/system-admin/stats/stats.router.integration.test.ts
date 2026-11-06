import { beforeAll, describe, expect, it } from 'vitest';

import {
  createAdminSession,
  createRegularUserSession,
  createSchoolStaffSession,
  createTestAdmission,
  createTestClass,
  createTestClient,
  createTestSchool,
  createTestSession,
  createTestStudent,
  type UserSession,
} from '../../../../test/fixtures';

describe('systemAdmin.stats Router Integration', () => {
  let adminSession: UserSession;
  let regularSession: UserSession;

  beforeAll(async () => {
    adminSession = await createAdminSession();
    regularSession = await createRegularUserSession();
  });

  describe('getPlatformStats', () => {
    it('counts schools by their independent onboarding and demo facts', async () => {
      const client = createTestClient(adminSession);
      const before = await client.systemAdmin.getPlatformStats();

      await createTestSchool({ hasCompletedOnboarding: true });
      await createTestSchool({ isDemo: true });
      const after = await client.systemAdmin.getPlatformStats();

      expect(after.schools.total - before.schools.total).toBe(2);
      expect(after.schools.onboarded - before.schools.onboarded).toBe(1);
      expect(after.schools.demo - before.schools.demo).toBe(1);
      expect(after.oauthClients.disabled).toBeLessThanOrEqual(after.oauthClients.total);
    });

    it('denies regular users with FORBIDDEN', async () => {
      await expect(
        createTestClient(regularSession).systemAdmin.getPlatformStats(),
      ).rejects.toThrowError(expect.objectContaining({ code: 'FORBIDDEN' }));
    });
  });

  describe('getSchoolStats', () => {
    it('returns aggregate admission and active-session enrolment counts', async () => {
      const school = await createTestSchool();
      const { schoolClass, sections } = await createTestClass({
        schoolId: school.id,
        label: 'Grade 1',
      });
      const { schoolClass: emptyClass } = await createTestClass({
        schoolId: school.id,
        label: 'Grade 2',
      });
      await createTestSession({
        schoolId: school.id,
        sessionStartYear: 2024,
        sessionEndYear: 2025,
      });
      const active = await createTestSession({
        schoolId: school.id,
        sessionStartYear: 2025,
        sessionEndYear: 2026,
        isActive: true,
      });
      const registered = await createTestAdmission({ schoolId: school.id });
      const unassigned = await createTestAdmission({ schoolId: school.id });
      const unregistered = await createTestAdmission({
        schoolId: school.id,
        registered: false,
      });
      await createTestStudent({
        schoolId: school.id,
        admissionId: registered.id,
        sessionId: active.id,
        classId: schoolClass.id,
        sectionId: sections[0]!.id,
      });
      await createTestStudent({
        schoolId: school.id,
        admissionId: unassigned.id,
        sessionId: active.id,
      });
      await createTestStudent({
        schoolId: school.id,
        admissionId: unregistered.id,
        sessionId: active.id,
        classId: emptyClass.id,
      });

      const stats = await createTestClient(adminSession).systemAdmin.getSchoolStats({
        schoolId: school.id,
      });

      expect(stats.admissions).toEqual({ total: 3, registered: 2, unregistered: 1 });
      expect(stats.classes).toBe(2);
      expect(stats.sections).toBe(2);
      expect(stats.sessions).toBe(2);
      expect(stats.activeSession).toMatchObject({
        id: active.id,
        enrolledStudents: 2,
        studentsWithoutClass: 1,
        studentsByClass: [
          { classId: schoolClass.id, label: 'Grade 1', students: 1 },
          { classId: emptyClass.id, label: 'Grade 2', students: 0 },
        ],
      });
    });

    it('returns a null active session when none is active', async () => {
      const school = await createTestSchool();
      const stats = await createTestClient(adminSession).systemAdmin.getSchoolStats({
        schoolId: school.id,
      });
      expect(stats.activeSession).toBeNull();
    });

    it('returns NOT_FOUND for an unknown school', async () => {
      await expect(
        createTestClient(adminSession).systemAdmin.getSchoolStats({ schoolId: 'missing' }),
      ).rejects.toThrowError(expect.objectContaining({ code: 'NOT_FOUND' }));
    });

    it('denies school principals with FORBIDDEN', async () => {
      const school = await createTestSchool();
      const { session } = await createSchoolStaffSession(school.id, [{ role: 'principal' }]);
      await expect(
        createTestClient(session).systemAdmin.getSchoolStats({ schoolId: school.id }),
      ).rejects.toThrowError(expect.objectContaining({ code: 'FORBIDDEN' }));
    });
  });
});
