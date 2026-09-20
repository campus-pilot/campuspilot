import { db } from '@campuspilot/db';
import { classTable } from '@campuspilot/db/schema/class';
import type { FinanceSchemaConfig } from '@campuspilot/db/schema/jsonb/finance-config';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  createAdminSession,
  createSchoolStaffSession,
  createTestClient,
  createTestSchool,
  createTestSession,
  type UserSession,
} from '../../../../test/fixtures';

const financeConfig: FinanceSchemaConfig = {
  recurring: 'monthly' as const,
  currency: 'INR',
  elements: {
    tuition: {
      name: 'Tuition',
      scopes: ['class'],
      requiredAtLevel: 'class',
      defaultValue: 1000,
    },
    activity: {
      name: 'Activity',
      scopes: ['school'],
      requiredAtLevel: 'school',
      defaultValue: 200,
    },
  },
};

describe('school.sessionFinance Router Integration', () => {
  let school: Awaited<ReturnType<typeof createTestSchool>>;
  let session: Awaited<ReturnType<typeof createTestSession>>;
  let principalSession: UserSession;
  let managerSession: UserSession;
  let accountantSession: UserSession;
  let teacherSession: UserSession;
  let adminSession: UserSession;

  beforeAll(async () => {
    school = await createTestSchool();
    session = await createTestSession({
      schoolId: school.id,
      sessionStartYear: 2050,
      sessionEndYear: 2051,
    });
    await db.insert(classTable).values({
      schoolId: school.id,
      slug: 'grade-8',
      label: 'Grade 8',
    });

    principalSession = (
      await createSchoolStaffSession(school.id, [
        { role: 'principal', meta: null },
      ])
    ).session;
    managerSession = (
      await createSchoolStaffSession(school.id, [
        { role: 'manager', meta: null },
      ])
    ).session;
    accountantSession = (
      await createSchoolStaffSession(school.id, [
        { role: 'accountant', meta: null },
      ])
    ).session;
    teacherSession = (
      await createSchoolStaffSession(school.id, [
        { role: 'teacher', meta: { classIds: [] } },
      ])
    ).session;
    adminSession = await createAdminSession();
  });

  it('allows principal to store class-slug keyed finance overrides', async () => {
    const client = createTestClient(principalSession);
    const updated = await client.school.updateSessionFinance({
      schoolId: school.id,
      sessionId: session.id,
      financeConfig,
      classOverrides: { 'grade-8': { tuition: 1250 } },
    });

    expect(updated.financeConfig).toEqual(financeConfig);
    expect(updated.classOverrides).toEqual({
      'grade-8': { tuition: 1250 },
    });
    expect(updated.classes).toEqual([{ slug: 'grade-8', label: 'Grade 8' }]);
  });

  it('allows manager, accountant, and platform admin to read finance', async () => {
    for (const authorizedSession of [
      managerSession,
      accountantSession,
      adminSession,
    ]) {
      const result = await createTestClient(
        authorizedSession,
      ).school.getSessionFinance({
        schoolId: school.id,
        sessionId: session.id,
      });
      expect(result.classOverrides['grade-8']?.tuition).toBe(1250);
    }
  });

  it('allows accountant to update class overrides', async () => {
    const updated = await createTestClient(
      accountantSession,
    ).school.updateSessionFinance({
      schoolId: school.id,
      sessionId: session.id,
      classOverrides: { 'grade-8': { tuition: 1300 } },
    });

    expect(updated.classOverrides['grade-8']?.tuition).toBe(1300);
  });

  it('denies finance routes to school roles outside the finance allowlist', async () => {
    const client = createTestClient(teacherSession);

    await expect(
      client.school.getSessionFinance({
        schoolId: school.id,
        sessionId: session.id,
      }),
    ).rejects.toThrowError(expect.objectContaining({ code: 'FORBIDDEN' }));
    await expect(
      client.school.updateSessionFinance({
        schoolId: school.id,
        sessionId: session.id,
        classOverrides: {},
      }),
    ).rejects.toThrowError(expect.objectContaining({ code: 'FORBIDDEN' }));
  });

  it('keeps finance fields out of general session DTOs available to teachers', async () => {
    const client = createTestClient(teacherSession);
    const fetched = await client.school.getSession({
      schoolId: school.id,
      sessionId: session.id,
    });
    const listed = await client.school.listSessions({ schoolId: school.id });

    expect(fetched).not.toHaveProperty('financeConfig');
    expect(fetched).not.toHaveProperty('financeClassOverrides');
    expect(listed.items[0]).not.toHaveProperty('financeConfig');
    expect(listed.items[0]).not.toHaveProperty('financeClassOverrides');
  });

  it('rejects class slugs outside the school', async () => {
    const client = createTestClient(principalSession);

    await expect(
      client.school.updateSessionFinance({
        schoolId: school.id,
        sessionId: session.id,
        classOverrides: { unknown: { tuition: 1400 } },
      }),
    ).rejects.toThrowError(expect.objectContaining({ code: 'BAD_REQUEST' }));
  });

  it('rejects overrides for fee elements without class scope', async () => {
    const client = createTestClient(principalSession);

    await expect(
      client.school.updateSessionFinance({
        schoolId: school.id,
        sessionId: session.id,
        classOverrides: { 'grade-8': { activity: 300 } },
      }),
    ).rejects.toThrowError(expect.objectContaining({ code: 'BAD_REQUEST' }));
  });

  it('moves slug-keyed overrides when a class slug is renamed', async () => {
    const client = createTestClient(principalSession);
    const [schoolClass] = await db
      .select({ id: classTable.id })
      .from(classTable)
      .where(eq(classTable.schoolId, school.id));

    await client.school.updateClass({
      schoolId: school.id,
      classId: schoolClass!.id,
      slug: 'grade-eight',
    });
    const finance = await client.school.getSessionFinance({
      schoolId: school.id,
      sessionId: session.id,
    });

    expect(finance.classOverrides).toEqual({
      'grade-eight': { tuition: 1300 },
    });
  });

  it('removes slug-keyed overrides when a class is deleted', async () => {
    const client = createTestClient(principalSession);
    const [schoolClass] = await db
      .select({ id: classTable.id })
      .from(classTable)
      .where(eq(classTable.schoolId, school.id));

    await client.school.deleteClass({
      schoolId: school.id,
      classId: schoolClass!.id,
    });
    const finance = await client.school.getSessionFinance({
      schoolId: school.id,
      sessionId: session.id,
    });

    expect(finance.classOverrides).toEqual({});
    expect(finance.classes).toEqual([]);
  });
});
