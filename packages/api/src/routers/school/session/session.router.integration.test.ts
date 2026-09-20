import { beforeAll, describe, expect, it } from 'vitest';

import {
  createAdminSession,
  createRegularUserSession,
  createSchoolStaffSession,
  createTestClient,
  createTestSchool,
  createTestSession,
  type UserSession,
} from '../../../../test/fixtures';

describe('school.session Router Integration', () => {
  let school: Awaited<ReturnType<typeof createTestSchool>>;
  let adminSession: UserSession;
  let principalSession: UserSession;
  let managerSession: UserSession;
  let teacherSession: UserSession;
  let regularSession: UserSession;

  beforeAll(async () => {
    school = await createTestSchool();
    adminSession = await createAdminSession();

    const principalStaff = await createSchoolStaffSession(school.id, [
      { role: 'principal', meta: null },
    ]);
    principalSession = principalStaff.session;

    const managerStaff = await createSchoolStaffSession(school.id, [
      { role: 'manager', meta: null },
    ]);
    managerSession = managerStaff.session;

    const teacherStaff = await createSchoolStaffSession(school.id, [
      { role: 'teacher', meta: { classIds: ['c1'] } },
    ]);
    teacherSession = teacherStaff.session;

    regularSession = await createRegularUserSession();
  });

  describe('createSession', () => {
    it('allows school principal to create an academic session', async () => {
      const client = createTestClient(principalSession);

      const session = await client.school.createSession({
        schoolId: school.id,
        sessionStartYear: 2026,
        sessionEndYear: 2027,
      });

      expect(session).toBeDefined();
      expect(session.id).toBeDefined();
      expect(session.schoolId).toBe(school.id);
      expect(session.sessionStartYear).toBe(2026);
      expect(session.sessionEndYear).toBe(2027);
      expect(session.isActive).toBe(false);
    });

    it('allows school manager to create an academic session', async () => {
      const client = createTestClient(managerSession);

      const session = await client.school.createSession({
        schoolId: school.id,
        sessionStartYear: 2027,
        sessionEndYear: 2028,
      });

      expect(session.sessionStartYear).toBe(2027);
      expect(session.sessionEndYear).toBe(2028);
    });

    it('rejects invalid year boundary where end year <= start year', async () => {
      const client = createTestClient(principalSession);

      await expect(
        client.school.createSession({
          schoolId: school.id,
          sessionStartYear: 2026,
          sessionEndYear: 2025,
        }),
      ).rejects.toThrow();

      await expect(
        client.school.createSession({
          schoolId: school.id,
          sessionStartYear: 2026,
          sessionEndYear: 2026,
        }),
      ).rejects.toThrow();
    });

    it('denies school teacher from creating sessions with FORBIDDEN', async () => {
      const client = createTestClient(teacherSession);

      await expect(
        client.school.createSession({
          schoolId: school.id,
          sessionStartYear: 2028,
          sessionEndYear: 2029,
        }),
      ).rejects.toThrowError(
        expect.objectContaining({ code: 'FORBIDDEN' }),
      );
    });
  });

  describe('getSession', () => {
    it('allows principal to retrieve a school session by ID', async () => {
      const created = await createTestSession({
        schoolId: school.id,
        sessionStartYear: 2030,
        sessionEndYear: 2031,
      });
      const client = createTestClient(principalSession);

      const session = await client.school.getSession({
        schoolId: school.id,
        sessionId: created.id,
      });

      expect(session).toBeDefined();
      expect(session.id).toBe(created.id);
      expect(session.sessionStartYear).toBe(2030);
      expect(session.sessionEndYear).toBe(2031);
    });

    it('returns NOT_FOUND for non-existent session ID', async () => {
      const client = createTestClient(principalSession);

      await expect(
        client.school.getSession({
          schoolId: school.id,
          sessionId: 'non-existent-session-id',
        }),
      ).rejects.toThrowError(
        expect.objectContaining({ code: 'NOT_FOUND' }),
      );
    });
  });

  describe('listSessions', () => {
    it('allows principal to list sessions with active-status filtering and sorting', async () => {
      const testSchool = await createTestSchool();
      const staff = await createSchoolStaffSession(testSchool.id, [
        { role: 'principal', meta: null },
      ]);
      const client = createTestClient(staff.session);

      await createTestSession({
        schoolId: testSchool.id,
        sessionStartYear: 2024,
        sessionEndYear: 2025,
        isActive: false,
      });
      await createTestSession({
        schoolId: testSchool.id,
        sessionStartYear: 2025,
        sessionEndYear: 2026,
        isActive: true,
      });

      // Filter active
      const activeList = await client.school.listSessions({
        schoolId: testSchool.id,
        filters: { isActive: true },
      });

      expect(activeList.items).toHaveLength(1);
      expect(activeList.items[0]!.sessionStartYear).toBe(2025);
      expect(activeList.items[0]!.isActive).toBe(true);

      // List all
      const allList = await client.school.listSessions({
        schoolId: testSchool.id,
        orderBy: { field: 'sessionStartYear', direction: 'asc' },
      });

      expect(allList.items).toHaveLength(2);
      expect(allList.items[0]!.sessionStartYear).toBe(2024);
      expect(allList.items[1]!.sessionStartYear).toBe(2025);

      // Filter by startYears
      const startYearFiltered = await client.school.listSessions({
        schoolId: testSchool.id,
        filters: { startYears: [2024] },
      });
      expect(startYearFiltered.items).toHaveLength(1);
      expect(startYearFiltered.items[0]!.sessionStartYear).toBe(2024);

      // Filter by endYears
      const endYearFiltered = await client.school.listSessions({
        schoolId: testSchool.id,
        filters: { endYears: [2026] },
      });
      expect(endYearFiltered.items).toHaveLength(1);
      expect(endYearFiltered.items[0]!.sessionEndYear).toBe(2026);
    });

    it('allows principal to retrieve distinct session filter options', async () => {
      const testSchool = await createTestSchool();
      const staff = await createSchoolStaffSession(testSchool.id, [
        { role: 'principal', meta: null },
      ]);
      const client = createTestClient(staff.session);

      await createTestSession({
        schoolId: testSchool.id,
        sessionStartYear: 2023,
        sessionEndYear: 2024,
      });
      await createTestSession({
        schoolId: testSchool.id,
        sessionStartYear: 2024,
        sessionEndYear: 2025,
      });

      const filterOptions = await client.school.listSessionFilterOptions({
        schoolId: testSchool.id,
      });

      expect(filterOptions.startYears).toEqual([2024, 2023]);
      expect(filterOptions.endYears).toEqual([2025, 2024]);
    });

    it('denies regular users from listing sessions', async () => {
      const client = createTestClient(regularSession);

      await expect(
        client.school.listSessions({ schoolId: school.id }),
      ).rejects.toThrowError(
        expect.objectContaining({ code: 'FORBIDDEN' }),
      );
    });
  });


  describe('updateSession', () => {
    it('allows principal to update session start and end years', async () => {
      const created = await createTestSession({
        schoolId: school.id,
        sessionStartYear: 2032,
        sessionEndYear: 2033,
      });
      const client = createTestClient(principalSession);

      const updated = await client.school.updateSession({
        schoolId: school.id,
        sessionId: created.id,
        sessionStartYear: 2031,
        sessionEndYear: 2034,
      });

      expect(updated.sessionStartYear).toBe(2031);
      expect(updated.sessionEndYear).toBe(2034);
    });

    it('validates partial year update against stored boundary', async () => {
      const created = await createTestSession({
        schoolId: school.id,
        sessionStartYear: 2035,
        sessionEndYear: 2036,
      });
      const client = createTestClient(principalSession);

      // Updating end year to earlier than start year (2035) should fail
      await expect(
        client.school.updateSession({
          schoolId: school.id,
          sessionId: created.id,
          sessionEndYear: 2034,
        }),
      ).rejects.toThrowError(
        expect.objectContaining({ code: 'BAD_REQUEST' }),
      );
    });

    it('returns NOT_FOUND when updating non-existent session', async () => {
      const client = createTestClient(principalSession);

      await expect(
        client.school.updateSession({
          schoolId: school.id,
          sessionId: 'non-existent-session-id',
          sessionStartYear: 2040,
        }),
      ).rejects.toThrowError(
        expect.objectContaining({ code: 'NOT_FOUND' }),
      );
    });
  });

  describe('activateSession', () => {
    it('allows a school principal to activate a session', async () => {
      const created = await createTestSession({
        schoolId: school.id,
        sessionStartYear: 2040,
        sessionEndYear: 2041,
        isActive: false,
      });
      const client = createTestClient(principalSession);

      const activated = await client.school.activateSession({
        schoolId: school.id,
        sessionId: created.id,
      });

      expect(activated.isActive).toBe(true);
    });

    it('allows platform admin to activate a session and atomically deactivate previous active session', async () => {
      const testSchool = await createTestSchool();
      const s1 = await createTestSession({
        schoolId: testSchool.id,
        sessionStartYear: 2041,
        sessionEndYear: 2042,
        isActive: true,
      });
      const s2 = await createTestSession({
        schoolId: testSchool.id,
        sessionStartYear: 2042,
        sessionEndYear: 2043,
        isActive: false,
      });

      const client = createTestClient(adminSession);

      const activated = await client.school.activateSession({
        schoolId: testSchool.id,
        sessionId: s2.id,
      });

      expect(activated.id).toBe(s2.id);
      expect(activated.isActive).toBe(true);

      // Verify previous session was deactivated
      const prev = await client.school.getSession({
        schoolId: testSchool.id,
        sessionId: s1.id,
      });
      expect(prev.isActive).toBe(false);
    });
  });

  describe('deleteSession', () => {
    it('allows principal to delete a school session', async () => {
      const created = await createTestSession({
        schoolId: school.id,
        sessionStartYear: 2045,
        sessionEndYear: 2046,
      });
      const client = createTestClient(principalSession);

      const deleted = await client.school.deleteSession({
        schoolId: school.id,
        sessionId: created.id,
      });

      expect(deleted.id).toBe(created.id);

      await expect(
        client.school.getSession({
          schoolId: school.id,
          sessionId: created.id,
        }),
      ).rejects.toThrowError(
        expect.objectContaining({ code: 'NOT_FOUND' }),
      );
    });

    it('returns NOT_FOUND when deleting non-existent session', async () => {
      const client = createTestClient(principalSession);

      await expect(
        client.school.deleteSession({
          schoolId: school.id,
          sessionId: 'non-existent-id',
        }),
      ).rejects.toThrowError(
        expect.objectContaining({ code: 'NOT_FOUND' }),
      );
    });
  });
});
