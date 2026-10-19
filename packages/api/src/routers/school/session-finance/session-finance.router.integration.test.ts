import { db } from '@campuspilot/db';
import { admissionTable } from '@campuspilot/db/schema/admission';
import { classTable } from '@campuspilot/db/schema/class';
import type {
  FinanceSchemaConfig,
  PersistedFinanceSchemaConfig,
} from '@campuspilot/db/schema/jsonb/finance-config';
import { schoolSessionTable } from '@campuspilot/db/schema/session';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  createAdminSession,
  createSchoolStaffSession,
  createTestClient,
  createTestAdmission,
  createTestSchool,
  createTestSession,
  type UserSession,
} from '../../../../test/fixtures';

const financeConfig: FinanceSchemaConfig = {
  recurring: 'monthly' as const,
  currency: 'INR',
  timeZone: 'Asia/Kolkata',
  cycleStartMonth: 4,
  elements: {
    tuition: {
      name: 'Tuition',
      scopes: ['class'],
      requiredAtLevel: 'class',
      defaultAmountMinor: 100_000,
    },
    activity: {
      name: 'Activity',
      scopes: ['school'],
      requiredAtLevel: 'school',
      defaultAmountMinor: 20_000,
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
      isActive: true,
    });
    await db.insert(classTable).values({
      schoolId: school.id,
      slug: 'grade-8',
      label: 'Grade 8',
      displayOrder: 1,
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

  it('rejects finance updates to an inactive session', async () => {
    const inactiveSession = await createTestSession({
      schoolId: school.id,
      sessionStartYear: 2052,
      sessionEndYear: 2053,
      isActive: false,
    });

    await expect(
      createTestClient(principalSession).school.updateSessionFinance({
        schoolId: school.id,
        sessionId: inactiveSession.id,
        financeConfig,
      }),
    ).rejects.toThrowError(
      expect.objectContaining({
        code: 'CONFLICT',
        message: 'Only the active academic session can be updated.',
      }),
    );
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

  it('preserves and exposes incomplete migrated configuration until an explicit write completes it', async () => {
    const incompleteSchool = await createTestSchool();
    const incompleteSession = await createTestSession({
      schoolId: incompleteSchool.id,
      sessionStartYear: 2060,
      sessionEndYear: 2061,
      isActive: true,
    });
    await db.insert(classTable).values({
      schoolId: incompleteSchool.id,
      slug: 'grade-5',
      label: 'Grade 5',
      displayOrder: 1,
    });
    const incompleteConfig: PersistedFinanceSchemaConfig = {
      recurring: 'monthly',
      currency: 'INR',
      elements: {
        tuition: {
          name: 'Tuition',
          scopes: ['school', 'class'],
          requiredAtLevel: 'school',
          defaultAmountMinor: 125_000,
        },
      },
    };
    await db
      .update(schoolSessionTable)
      .set({ financeConfig: incompleteConfig })
      .where(eq(schoolSessionTable.id, incompleteSession.id));
    const incompletePrincipal = (
      await createSchoolStaffSession(incompleteSchool.id, [
        { role: 'principal', meta: null },
      ])
    ).session;
    const client = createTestClient(incompletePrincipal);

    const read = await client.school.getSessionFinance({
      schoolId: incompleteSchool.id,
      sessionId: incompleteSession.id,
    });
    expect(read.financeConfig).toEqual(incompleteConfig);
    expect(read.configurationReadiness).toEqual({
      status: 'incomplete',
      readyForBilling: false,
      missingFields: ['timeZone', 'cycleStartMonth'],
    });

    const preserved = await client.school.updateSessionFinance({
      schoolId: incompleteSchool.id,
      sessionId: incompleteSession.id,
      classOverrides: { 'grade-5': { tuition: 130_000 } },
    });
    expect(preserved.financeConfig).toEqual(incompleteConfig);
    expect(preserved.configurationReadiness.readyForBilling).toBe(false);

    const completed = await client.school.updateSessionFinance({
      schoolId: incompleteSchool.id,
      sessionId: incompleteSession.id,
      financeConfig: {
        ...incompleteConfig,
        currency: 'INR',
        timeZone: 'Asia/Kolkata',
        cycleStartMonth: 4,
      },
    });
    expect(completed.financeConfig?.elements).toEqual(
      incompleteConfig.elements,
    );
    expect(completed.configurationReadiness).toEqual({
      status: 'ready',
      readyForBilling: true,
      missingFields: [],
    });
  });

  it('blocks currency changes once configured values exist', async () => {
    await expect(
      createTestClient(principalSession).school.updateSessionFinance({
        schoolId: school.id,
        sessionId: session.id,
        financeConfig: { ...financeConfig, currency: 'USD' },
      }),
    ).rejects.toThrowError(expect.objectContaining({ code: 'CONFLICT' }));
  });

  it('rejects amounts without currency and treats completing currency as a reviewed conversion when amounts already exist', async () => {
    const legacySchool = await createTestSchool();
    const legacySession = await createTestSession({ schoolId: legacySchool.id, sessionStartYear: 2065, sessionEndYear: 2066, isActive: true });
    await db.insert(classTable).values({ schoolId: legacySchool.id, slug: 'grade-1', label: 'Grade 1', displayOrder: 1 });
    const legacyConfig: PersistedFinanceSchemaConfig = {
      recurring: 'monthly',
      elements: { fee: { name: 'Fee', scopes: ['school', 'class', 'student'], requiredAtLevel: 'school', defaultAmountMinor: 100 } },
    };
    await db.update(schoolSessionTable).set({ financeConfig: legacyConfig }).where(eq(schoolSessionTable.id, legacySession.id));
    const admission = await createTestAdmission({ schoolId: legacySchool.id });
    const staff = (await createSchoolStaffSession(legacySchool.id, [{ role: 'principal', meta: null }])).session;
    const client = createTestClient(staff);
    await expect(client.school.updateSessionFinance({ schoolId: legacySchool.id, sessionId: legacySession.id, classOverrides: { 'grade-1': { fee: 100 } } })).rejects.toThrowError(expect.objectContaining({ code: 'BAD_REQUEST' }));
    await expect(client.school.updateAdmissionFinanceValues({ schoolId: legacySchool.id, admissionId: admission.id, sessionId: legacySession.id, values: { fee: 100 } })).rejects.toThrowError(expect.objectContaining({ code: 'BAD_REQUEST' }));
    await expect(client.school.updateSessionFinance({
      schoolId: legacySchool.id,
      sessionId: legacySession.id,
      financeConfig: { ...legacyConfig, currency: 'INR', timeZone: 'Asia/Kolkata', cycleStartMonth: 4 },
    })).rejects.toThrowError(expect.objectContaining({ code: 'CONFLICT' }));
  });

  it('validates element removal, rename, and admission-scope changes against admission overrides', async () => {
    const scopedSchool = await createTestSchool();
    const scopedSession = await createTestSession({
      schoolId: scopedSchool.id,
      sessionStartYear: 2070,
      sessionEndYear: 2071,
      isActive: true,
    });
    const admission = await createTestAdmission({ schoolId: scopedSchool.id });
    const config: FinanceSchemaConfig = {
      recurring: 'monthly',
      currency: 'INR',
      timeZone: 'Asia/Kolkata',
      cycleStartMonth: 4,
      elements: {
        transport: { name: 'Transport', scopes: ['student'] },
      },
    };
    await db.update(schoolSessionTable).set({ financeConfig: config }).where(eq(schoolSessionTable.id, scopedSession.id));
    await db.update(admissionTable).set({
      financeValue: { [scopedSession.id]: { transport: 50_000 } },
    }).where(eq(admissionTable.id, admission.id));
    const staff = (await createSchoolStaffSession(scopedSchool.id, [{ role: 'principal', meta: null }])).session;
    const client = createTestClient(staff);

    const invalidElements: FinanceSchemaConfig['elements'][] = [
      {},
      { bus: { name: 'Transport', scopes: ['student'] } },
      { transport: { name: 'Transport', scopes: ['school'] } },
    ];
    for (const elements of invalidElements) {
      await expect(
        client.school.updateSessionFinance({
          schoolId: scopedSchool.id,
          sessionId: scopedSession.id,
          financeConfig: { ...config, elements },
        }),
      ).rejects.toThrowError(expect.objectContaining({ code: 'CONFLICT' }));
    }
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
