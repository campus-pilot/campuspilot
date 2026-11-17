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
  EXAM_NAME_TAKEN_MESSAGE,
  EXAM_NAME_TAKEN_REASON,
  EXAM_SLUG_TAKEN_MESSAGE,
  EXAM_SLUG_TAKEN_REASON,
  isExamNameTakenError,
  isExamSlugTakenError,
} from './exam-definition.contract';
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
    // The refusal carries its explicit reason, which the dialog reads to put it beside the slug field.
    for (const name of ['Unit Test 1', 'Another name']) {
      const error = await manager.school
        .createExam({ ...scope, examSlug: 'unit_test_1', name })
        .then(() => undefined, (caught: unknown) => caught);
      expect(error).toMatchObject({
        code: 'CONFLICT',
        message: EXAM_SLUG_TAKEN_MESSAGE,
        data: { reason: EXAM_SLUG_TAKEN_REASON },
      });
      expect(isExamSlugTakenError(error)).toBe(true);
    }
    expect(await storedExamConfig(scope.sessionId)).toEqual(before);
  });

  it('refuses a name another exam of the session has under a different slug, trimmed and ignoring case', async () => {
    const { scope, manager } = await schoolWithActiveSession({
      unit_test_1: { name: 'Unit Test 1', order: 1 },
    });
    const before = await storedExamConfig(scope.sessionId);
    for (const name of [' unit test 1 ', 'UNIT TEST 1', 'Unit Test 1']) {
      const error = await rejection(
        manager.school.createExam({ ...scope, examSlug: 'ut_one', name }),
      );
      expect(error).toMatchObject({
        code: 'CONFLICT',
        message: EXAM_NAME_TAKEN_MESSAGE,
        data: { reason: EXAM_NAME_TAKEN_REASON },
      });
      expect(isExamNameTakenError(error)).toBe(true);
      expect(isExamSlugTakenError(error)).toBe(false);
    }
    expect(await storedExamConfig(scope.sessionId)).toEqual(before);
    // Inner whitespace is part of the name, so this is another name.
    await manager.school.createExam({ ...scope, examSlug: 'ut_two', name: 'Unit  Test 1' });
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

describe('school.updateExam names', () => {
  it('refuses renaming an exam onto another exam’s name without changing the session', async () => {
    const { scope, manager } = await schoolWithActiveSession({
      unit_test_1: { name: 'Unit Test 1', order: 1 },
      annual: { name: 'Annual', order: 2 },
    });
    const before = await storedExamConfig(scope.sessionId);
    const error = await rejection(
      manager.school.updateExam({ ...scope, examSlug: 'annual', name: ' unit TEST 1 ' }),
    );
    expect(error).toMatchObject({
      code: 'CONFLICT',
      message: EXAM_NAME_TAKEN_MESSAGE,
      data: { reason: EXAM_NAME_TAKEN_REASON },
    });
    expect(isExamNameTakenError(error)).toBe(true);
    expect(await storedExamConfig(scope.sessionId)).toEqual(before);
  });

  it('allows keeping an exam’s own name or changing only its case, even beside a stored duplicate', async () => {
    const { scope, manager } = await schoolWithActiveSession({
      unit_test_1: { name: 'Unit Test 1', order: 1 },
      // Stored before names had to be unique.
      unit_test_1_copy: { name: 'unit test 1', order: 2 },
    });
    expect(
      await manager.school.updateExam({ ...scope, examSlug: 'unit_test_1', name: 'UNIT Test 1' }),
    ).toEqual({ slug: 'unit_test_1', name: 'UNIT Test 1', order: 1 });
    expect(
      await manager.school.updateExam({
        ...scope,
        examSlug: 'unit_test_1_copy',
        name: 'unit test 1',
        order: 3,
      }),
    ).toEqual({ slug: 'unit_test_1_copy', name: 'unit test 1', order: 3 });
    expect(await storedExamConfig(scope.sessionId)).toEqual({
      unit_test_1: { name: 'UNIT Test 1', order: 1 },
      unit_test_1_copy: { name: 'unit test 1', order: 3 },
    });
  });
});

describe('school.updateSession exam names', () => {
  /** Saves the session's stored configuration with `examConfig` replacing its exams. */
  async function saveExams(
    client: Client,
    scope: { schoolId: string; sessionId: string },
    examConfig: Record<string, { name: string; order: number }>,
  ) {
    const session = await client.school.getSession(scope);
    return client.school.updateSession({
      ...scope,
      sessionConfig: { ...session.sessionConfig!, examConfig },
    });
  }

  it('refuses a new exam whose name another exam has', async () => {
    const stored = { first_term: { name: 'First Term', order: 1 } };
    const { scope, manager } = await schoolWithActiveSession(stored);
    const error = await rejection(
      saveExams(manager, scope, {
        ...stored,
        term_one: { name: ' first term', order: 2 },
      }),
    );
    expect(error).toMatchObject({
      code: 'CONFLICT',
      message: EXAM_NAME_TAKEN_MESSAGE,
      data: { reason: EXAM_NAME_TAKEN_REASON },
    });
    expect(isExamNameTakenError(error)).toBe(true);
    expect(await storedExamConfig(scope.sessionId)).toEqual(stored);
  });

  it('refuses renaming an exam onto another exam’s name', async () => {
    const stored = {
      first_term: { name: 'First Term', order: 1 },
      annual: { name: 'Annual', order: 2 },
    };
    const { scope, manager } = await schoolWithActiveSession(stored);
    const error = await rejection(
      saveExams(manager, scope, {
        ...stored,
        annual: { name: 'FIRST TERM', order: 2 },
      }),
    );
    expect(isExamNameTakenError(error)).toBe(true);
    expect(await storedExamConfig(scope.sessionId)).toEqual(stored);
  });

  it('keeps saving a configuration whose duplicate names were already stored', async () => {
    const stored = {
      unit_test_1: { name: 'Unit Test 1', order: 1 },
      unit_test_1_copy: { name: ' unit test 1', order: 2 },
    };
    const { scope, manager } = await schoolWithActiveSession(stored);
    const session = await manager.school.getSession(scope);
    // An unrelated field changes; the stored duplicates are resubmitted as they
    // are, as the settings screen sends the whole configuration.
    const saved = await manager.school.updateSession({
      ...scope,
      sessionEndYear: 2028,
      sessionConfig: session.sessionConfig,
    });
    expect(saved.sessionEndYear).toBe(2028);
    expect(await storedExamConfig(scope.sessionId)).toEqual(stored);
    // Reordering them, changing only their case and adding an unrelated exam also saves.
    const next = {
      unit_test_1: { name: 'UNIT TEST 1', order: 2 },
      unit_test_1_copy: { name: ' unit test 1', order: 1 },
      annual: { name: 'Annual', order: 3 },
    };
    await saveExams(manager, scope, next);
    expect(await storedExamConfig(scope.sessionId)).toEqual(next);
    // A third exam joining the stored duplicates is introduced, and refused.
    const error = await rejection(
      saveExams(manager, scope, { ...next, unit_test_1_again: { name: 'Unit Test 1', order: 4 } }),
    );
    expect(isExamNameTakenError(error)).toBe(true);
    expect(await storedExamConfig(scope.sessionId)).toEqual(next);
  });
});
