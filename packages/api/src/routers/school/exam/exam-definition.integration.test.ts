import { describe, expect, it } from 'vitest';
import { db } from '@campuspilot/db';
import { schoolSessionTable } from '@campuspilot/db/schema/session';
import { sessionConfigSchema } from '@campuspilot/db/schema/jsonb/session-config';
import { eq } from 'drizzle-orm';
import {
  isSchoolNoPlanError,
  isSchoolSuspendedError,
} from '../../../school-access/school-access.contract';
import {
  createAdminSession,
  createSchoolStaffSession,
  createTestClient,
  createTestSchool,
  createTestSession,
} from '../../../../test/fixtures';

/**
 * `school.createExam`, the procedure behind the Examinations list's Create
 * examination dialog: it adds one exam to the session configuration under
 * the session lock, lists it last unless an order is given, and keeps the
 * session settings slug rule, exam governance and the read-only school gate.
 */

type Client = ReturnType<typeof createTestClient>;

async function storedExamConfig(sessionId: string) {
  const [session] = await db
    .select({ sessionConfig: schoolSessionTable.sessionConfig })
    .from(schoolSessionTable)
    .where(eq(schoolSessionTable.id, sessionId));
  return session?.sessionConfig?.examConfig ?? {};
}

type Role = Parameters<typeof createSchoolStaffSession>[1][number]['role'];

/**
 * A school of its own with one active session holding `examConfig`, and its
 * manager. A school has at most one active session, so every case gets a
 * school.
 */
async function schoolWithActiveSession(
  examConfig: Record<string, { name: string; order: number }> = {},
  school: Parameters<typeof createTestSchool>[0] = {},
) {
  const schoolId = (await createTestSchool(school)).id;
  const session = await createTestSession({
    schoolId,
    sessionStartYear: 2026,
    sessionEndYear: 2027,
    isActive: true,
  });
  await db
    .update(schoolSessionTable)
    .set({ sessionConfig: sessionConfigSchema.parse({ examConfig }) })
    .where(eq(schoolSessionTable.id, session.id));
  return {
    scope: { schoolId, sessionId: session.id },
    manager: await staffClient(schoolId, 'manager'),
  };
}

async function staffClient(schoolId: string, role: Role): Promise<Client> {
  return createTestClient(
    (
      await createSchoolStaffSession(schoolId, [
        { role, meta: role === 'teacher' ? { classIds: [] } : null },
      ])
    ).session,
  );
}

async function rejection(promise: Promise<unknown>) {
  return promise.then(
    () => {
      throw new Error('the call should have been refused');
    },
    (error: unknown) => error,
  );
}

describe('school.createExam', () => {

  it('adds the exam to the session configuration after the last one and lists it at once', async () => {
    const { scope, manager } = await schoolWithActiveSession({
      first_term: { name: 'First Term', order: 1 },
      // A gap left by deleting an exam through the API: the new exam goes after the highest order.
      annual: { name: 'Annual', order: 3 },
    });
    const created = await manager.school.createExam({
      ...scope,
      examSlug: 'unit_test_1',
      name: '  Unit Test 1 ',
    });
    expect(created).toEqual({ slug: 'unit_test_1', name: 'Unit Test 1', order: 4 });
    expect(await storedExamConfig(scope.sessionId)).toEqual({
      first_term: { name: 'First Term', order: 1 },
      annual: { name: 'Annual', order: 3 },
      unit_test_1: { name: 'Unit Test 1', order: 4 },
    });
    const listed = await manager.school.listExams({
      ...scope,
      orderBy: { field: 'order', direction: 'asc' },
    });
    expect(listed.items.map((exam) => exam.slug)).toEqual([
      'first_term',
      'annual',
      'unit_test_1',
    ]);
    const session = await manager.school.getSession(scope);
    expect(session.sessionConfig?.examConfig?.unit_test_1).toEqual({
      name: 'Unit Test 1',
      order: 4,
    });
  });

  it('gives the first exam of an empty session order 1 and keeps an explicit order', async () => {
    const { scope, manager } = await schoolWithActiveSession();
    expect(
      (await manager.school.createExam({ ...scope, examSlug: 'final', name: 'Final' })).order,
    ).toBe(1);
    expect(
      (
        await manager.school.createExam({
          ...scope,
          examSlug: 'midterm',
          name: 'Midterm',
          order: 7,
        })
      ).order,
    ).toBe(7);
  });

  it('serialises concurrent creations so none is lost and each is listed after the other', async () => {
    const { scope, manager } = await schoolWithActiveSession({
      first_term: { name: 'First Term', order: 1 },
    });
    const created = await Promise.all(
      ['a', 'b', 'c', 'd'].map((suffix) =>
        manager.school.createExam({
          ...scope,
          examSlug: `unit_${suffix}`,
          name: `Unit ${suffix}`,
        }),
      ),
    );
    expect(created.map((exam) => exam.order).sort()).toEqual([2, 3, 4, 5]);
    expect(Object.keys(await storedExamConfig(scope.sessionId)).sort()).toEqual([
      'first_term',
      'unit_a',
      'unit_b',
      'unit_c',
      'unit_d',
    ]);
  });

  it('refuses a duplicate name (its slug is taken) and a duplicate slug without changing the session', async () => {
    const { scope, manager } = await schoolWithActiveSession({
      unit_test_1: { name: 'Unit Test 1', order: 1 },
    });
    const before = await storedExamConfig(scope.sessionId);
    // The dialog derives the slug from the name, so a repeated name arrives with the taken slug.
    await expect(
      manager.school.createExam({ ...scope, examSlug: 'unit_test_1', name: 'Unit Test 1' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(
      manager.school.createExam({ ...scope, examSlug: 'unit_test_1', name: 'Another name' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(await storedExamConfig(scope.sessionId)).toEqual(before);
  });

  it('refuses a slug outside the session settings format, an empty name and an inactive session', async () => {
    const { scope, manager } = await schoolWithActiveSession();
    for (const examSlug of ['Unit-Test', 'unit test', '', 'a'.repeat(101)])
      await expect(
        manager.school.createExam({ ...scope, examSlug, name: 'Unit Test' }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(
      manager.school.createExam({ ...scope, examSlug: 'unit_test', name: '   ' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(await storedExamConfig(scope.sessionId)).toEqual({});

    const inactive = await createTestSession({
      schoolId: scope.schoolId,
      sessionStartYear: 2020,
      sessionEndYear: 2021,
      isActive: false,
    });
    await expect(
      manager.school.createExam({
        schoolId: scope.schoolId,
        sessionId: inactive.id,
        examSlug: 'unit_test',
        name: 'Unit Test',
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('is allowed to school exam governance and refused to everyone else', async () => {
    const { scope } = await schoolWithActiveSession();
    for (const role of ['principal', 'exam_coordinator'] as const) {
      const client = await staffClient(scope.schoolId, role);
      await client.school.createExam({ ...scope, examSlug: role, name: role });
    }
    const refused: Client[] = [
      await staffClient(scope.schoolId, 'teacher'),
      await staffClient(scope.schoolId, 'accountant'),
      createTestClient(await createAdminSession()),
      await staffClient((await createTestSchool()).id, 'manager'),
    ];
    for (const client of refused)
      await expect(
        client.school.createExam({ ...scope, examSlug: 'refused', name: 'Refused' }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      createTestClient(null).school.createExam({
        ...scope,
        examSlug: 'refused',
        name: 'Refused',
      }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect(Object.keys(await storedExamConfig(scope.sessionId)).sort()).toEqual([
      'exam_coordinator',
      'principal',
    ]);
  });

  it('is refused in a suspended school and in a school without a plan', async () => {
    const suspended = await schoolWithActiveSession();
    await createTestClient(await createAdminSession()).systemAdmin.suspendSchool({
      id: suspended.scope.schoolId,
      reason: 'Misuse of the platform',
    });
    const suspendedError = await rejection(
      suspended.manager.school.createExam({
        ...suspended.scope,
        examSlug: 'unit_test',
        name: 'Unit Test',
      }),
    );
    expect(suspendedError).toMatchObject({ code: 'FORBIDDEN' });
    expect(isSchoolSuspendedError(suspendedError)).toBe(true);
    expect(await storedExamConfig(suspended.scope.sessionId)).toEqual({});

    const noPlan = await schoolWithActiveSession({}, { tier: null });
    const noPlanError = await rejection(
      noPlan.manager.school.createExam({
        ...noPlan.scope,
        examSlug: 'unit_test',
        name: 'Unit Test',
      }),
    );
    expect(noPlanError).toMatchObject({ code: 'FORBIDDEN' });
    expect(isSchoolNoPlanError(noPlanError)).toBe(true);
    expect(await storedExamConfig(noPlan.scope.sessionId)).toEqual({});
  });
});
