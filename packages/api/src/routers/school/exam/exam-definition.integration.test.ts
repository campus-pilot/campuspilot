import { describe, expect, it } from 'vitest';
import { db } from '@campuspilot/db';
import { schoolSessionTable } from '@campuspilot/db/schema/session';
import {
  examAssessmentSettingsTable,
  examLifecycleTable,
  examStudentAssessmentTable,
  examStudentRemarkTable,
  examTimetableTable,
} from '@campuspilot/db/schema/exam';
import { examQuestionPaperTable } from '@campuspilot/db/schema/exam-question-paper';
import { examResultPublicationTable } from '@campuspilot/db/schema/exam-result-publication';
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
  SESSION_STALE_MESSAGE,
  SESSION_STALE_REASON,
  isSessionStaleError,
  sessionVersionToken,
} from '../session/session.contract';
import {
  createAdminSession,
  createTestAdmission,
  createTestClass,
  createTestStudent,
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
    // Removing a space makes another name.
    await manager.school.createExam({ ...scope, examSlug: 'ut_two', name: 'UnitTest 1' });
  });

  it('refuses a name that differs only by spacing, invisible characters or compatibility forms', async () => {
    const { scope, manager } = await schoolWithActiveSession({
      unit_test_1: { name: 'Unit Test 1', order: 1 },
    });
    const before = await storedExamConfig(scope.sessionId);
    for (const name of [
      'Unit  Test 1',
      'Unit\tTest\u00a01',
      'Unit\u200b Test 1',
      'Un\u2060it Te\u200dst 1',
      '\uff35nit \uff34est \uff11',
    ]) {
      const error = await rejection(
        manager.school.createExam({ ...scope, examSlug: 'ut_one', name }),
      );
      expect(isExamNameTakenError(error)).toBe(true);
    }
    expect(await storedExamConfig(scope.sessionId)).toEqual(before);
  });

  it('refuses a slug outside the session settings format, an empty name and an inactive session', async () => {
    const { scope, manager } = await schoolWithActiveSession();
    for (const examSlug of ['Unit-Test', 'unit test', '', 'a'.repeat(101)])
      await expect(
        manager.school.createExam({ ...scope, examSlug, name: 'Unit Test' }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    // A reserved slug would become a ghost exam: Zod's record parsing drops `__proto__`.
    for (const examSlug of ['__proto__', 'constructor', 'prototype'])
      await expect(
        manager.school.createExam({ ...scope, examSlug, name: 'Reserved' }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    // Empty, invisible-only and over-long names.
    for (const name of ['   ', '\u200b', ' \u200b\u200d\ufeff ', 'a'.repeat(201)])
      await expect(
        manager.school.createExam({ ...scope, examSlug: 'unit_test', name }),
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

  it('refuses a new name that differs from another exam’s only by spacing or invisible characters, and an invisible-only name', async () => {
    const { scope, manager } = await schoolWithActiveSession({
      unit_test_1: { name: 'Unit Test 1', order: 1 },
      annual: { name: 'Annual', order: 2 },
    });
    const before = await storedExamConfig(scope.sessionId);
    for (const name of ['Unit   Test 1', 'Unit\u200b Test 1'])
      expect(
        isExamNameTakenError(
          await rejection(manager.school.updateExam({ ...scope, examSlug: 'annual', name })),
        ),
      ).toBe(true);
    await expect(
      manager.school.updateExam({ ...scope, examSlug: 'annual', name: '\u200b\u200b' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
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

/** The session's configuration with `examConfig` replacing its exams, as the settings screen submits it. */
function withExams(
  session: { sessionConfig: { examConfig?: unknown } | null },
  examConfig: Record<string, { name: string; order: number }>,
) {
  return { ...sessionConfigSchema.parse(session.sessionConfig ?? {}), examConfig };
}

describe('school.updateSession stale saves (expectedUpdatedAt)', () => {
  it('refuses a configuration edited from a read made before an exam was created elsewhere, and keeps that exam', async () => {
    const stored = { first_term: { name: 'First Term', order: 1 } };
    const { scope, manager } = await schoolWithActiveSession(stored);
    const loaded = await manager.school.getSession(scope);
    // Meanwhile the Examinations list (or an MCP client) creates an exam.
    await manager.school.createExam({ ...scope, examSlug: 'unit_test_1', name: 'Unit Test 1' });
    const afterCreate = await storedExamConfig(scope.sessionId);

    // The settings screen saves its copy, which does not have the new exam.
    const error = await rejection(
      manager.school.updateSession({
        ...scope,
        sessionConfig: withExams(loaded, { first_term: { name: 'First Term Exam', order: 1 } }),
        expectedUpdatedAt: sessionVersionToken(loaded.updatedAt),
      }),
    );
    expect(error).toMatchObject({
      code: 'CONFLICT',
      message: SESSION_STALE_MESSAGE,
      data: { reason: SESSION_STALE_REASON },
    });
    expect(isSessionStaleError(error)).toBe(true);
    expect(isExamNameTakenError(error)).toBe(false);
    expect(await storedExamConfig(scope.sessionId)).toEqual(afterCreate);
    expect(afterCreate).toHaveProperty('unit_test_1');

    // Saving again from the latest read applies, and moves the token on.
    const latest = await manager.school.getSession(scope);
    const saved = await manager.school.updateSession({
      ...scope,
      sessionConfig: withExams(latest, {
        ...afterCreate,
        first_term: { name: 'First Term Exam', order: 1 },
      }),
      expectedUpdatedAt: sessionVersionToken(latest.updatedAt),
    });
    expect(saved.sessionConfig?.examConfig).toEqual({
      ...afterCreate,
      first_term: { name: 'First Term Exam', order: 1 },
    });
    // The read the save was based on is now outdated too.
    expect(
      isSessionStaleError(
        await rejection(
          manager.school.updateSession({
            ...scope,
            sessionEndYear: 2028,
            expectedUpdatedAt: sessionVersionToken(latest.updatedAt),
          }),
        ),
      ),
    ).toBe(true);
    await manager.school.updateSession({
      ...scope,
      sessionEndYear: 2028,
      expectedUpdatedAt: sessionVersionToken(saved.updatedAt),
    });
  });

  it('is refused as stale after a rename or deletion elsewhere too, before any other rule is checked', async () => {
    const stored = {
      first_term: { name: 'First Term', order: 1 },
      annual: { name: 'Annual', order: 2 },
    };
    const { scope, manager } = await schoolWithActiveSession(stored);
    const loaded = await manager.school.getSession(scope);
    await manager.school.updateExam({ ...scope, examSlug: 'annual', name: 'Annual Exam' });
    // The stale copy also introduces a name clash; the stale refusal wins, so
    // the clash a client is told about is always one of its own edit.
    const error = await rejection(
      manager.school.updateSession({
        ...scope,
        sessionConfig: withExams(loaded, { ...stored, term_one: { name: 'First Term', order: 3 } }),
        expectedUpdatedAt: sessionVersionToken(loaded.updatedAt),
      }),
    );
    expect(isSessionStaleError(error)).toBe(true);

    const reread = await manager.school.getSession(scope);
    await manager.school.deleteExam({ ...scope, examSlug: 'annual' });
    expect(
      isSessionStaleError(
        await rejection(
          manager.school.updateSession({
            ...scope,
            sessionConfig: reread.sessionConfig,
            expectedUpdatedAt: sessionVersionToken(reread.updatedAt),
          }),
        ),
      ),
    ).toBe(true);
    expect(await storedExamConfig(scope.sessionId)).toEqual({
      first_term: { name: 'First Term', order: 1 },
    });
  });

  it('applies to whatever is stored when the token is left out, as callers without an edited copy send it', async () => {
    const { scope, manager } = await schoolWithActiveSession({
      first_term: { name: 'First Term', order: 1 },
    });
    const loaded = await manager.school.getSession(scope);
    await manager.school.createExam({ ...scope, examSlug: 'unit_test_1', name: 'Unit Test 1' });
    const saved = await manager.school.updateSession({
      ...scope,
      sessionConfig: withExams(loaded, { first_term: { name: 'First Term', order: 1 } }),
    });
    // Without the token the submitted map replaces the stored one (an exam
    // without recorded data may be removed this way, as before).
    expect(saved.sessionConfig?.examConfig).toEqual({
      first_term: { name: 'First Term', order: 1 },
    });
  });

  it('treats a null token as a read of a session whose updatedAt was never set', async () => {
    const { scope, manager } = await schoolWithActiveSession();
    await db
      .update(schoolSessionTable)
      .set({ updatedAt: null })
      .where(eq(schoolSessionTable.id, scope.sessionId));
    const saved = await manager.school.updateSession({
      ...scope,
      sessionEndYear: 2028,
      expectedUpdatedAt: null,
    });
    expect(saved.updatedAt).not.toBeNull();
    expect(
      isSessionStaleError(
        await rejection(
          manager.school.updateSession({ ...scope, sessionEndYear: 2029, expectedUpdatedAt: null }),
        ),
      ),
    ).toBe(true);
  });
});

describe('exam removal (updateSession and deleteExam)', () => {
  type Scope = { schoolId: string; sessionId: string };

  /** Saves the latest configuration without `examSlug`, as the settings screen does after a removal. */
  async function removeExam(client: Client, scope: Scope, examSlug: string) {
    const session = await client.school.getSession(scope);
    const { [examSlug]: _removed, ...kept } = sessionConfigSchema.parse(
      session.sessionConfig ?? {},
    ).examConfig;
    return client.school.updateSession({
      ...scope,
      sessionConfig: withExams(session, kept),
      expectedUpdatedAt: sessionVersionToken(session.updatedAt),
    });
  }

  async function testStudent(scope: Scope) {
    const admission = await createTestAdmission({ schoolId: scope.schoolId });
    const student = await createTestStudent({
      schoolId: scope.schoolId,
      admissionId: admission.id,
      sessionId: scope.sessionId,
    });
    return { admission, student };
  }

  /** Each kind of recorded data that keeps an exam from being removed, written for `examSlug`. */
  const recordedData: Array<[string, (scope: Scope, examSlug: string) => Promise<unknown>]> = [
    [
      'a timetable',
      (scope, examSlug) =>
        db.insert(examTimetableTable).values({ ...scope, examSlug, config: { columns: [], rows: [] } }),
    ],
    [
      'a working-day limit',
      (scope, examSlug) =>
        db.insert(examAssessmentSettingsTable).values({ ...scope, examSlug, totalWorkingDays: 20 }),
    ],
    [
      'a student assessment',
      async (scope, examSlug) => {
        const { student } = await testStudent(scope);
        await db
          .insert(examStudentAssessmentTable)
          .values({ ...scope, examSlug, studentId: student.id, daysAttended: 18 });
      },
    ],
    [
      'a student remark',
      async (scope, examSlug) => {
        const { student } = await testStudent(scope);
        await db
          .insert(examStudentRemarkTable)
          .values({ ...scope, examSlug, studentId: student.id, text: 'Steady progress.' });
      },
    ],
    [
      'a started lifecycle',
      (scope, examSlug) =>
        db
          .insert(examLifecycleTable)
          .values({ ...scope, examSlug, status: 'active', startedAt: new Date() }),
    ],
    [
      'a results notification record',
      async (scope, examSlug) => {
        const { admission } = await testStudent(scope);
        await db.insert(examResultPublicationTable).values({
          ...scope,
          examSlug,
          examName: 'Unit Test 1',
          admissionIds: [admission.id],
          snapshot: { recipientCount: 1, channels: {} },
        });
      },
    ],
    [
      'a question paper',
      async (scope, examSlug) => {
        const { schoolClass } = await createTestClass({ schoolId: scope.schoolId });
        await db.insert(examQuestionPaperTable).values({
          ...scope,
          examSlug,
          classId: schoolClass.id,
          subjectSlug: 'maths',
          modeSlug: 'written',
        });
      },
    ],
  ];

  for (const [label, write] of recordedData)
    it(`refuses removing an exam with ${label}, naming it, and leaves the session unchanged`, async () => {
      const stored = {
        first_term: { name: 'First Term', order: 1 },
        unit_test_1: { name: 'Unit Test 1', order: 2 },
      };
      const { scope, manager } = await schoolWithActiveSession(stored);
      await write(scope, 'unit_test_1');
      const error = await rejection(removeExam(manager, scope, 'unit_test_1'));
      expect(error).toMatchObject({ code: 'CONFLICT' });
      expect(String((error as Error).message)).toContain('“Unit Test 1” (unit_test_1)');
      expect(isSessionStaleError(error)).toBe(false);
      expect(await storedExamConfig(scope.sessionId)).toEqual(stored);
      // The exam without data can still be removed.
      await removeExam(manager, scope, 'first_term');
      expect(await storedExamConfig(scope.sessionId)).toEqual({
        unit_test_1: { name: 'Unit Test 1', order: 2 },
      });
    });

  for (const [label, write] of recordedData)
    it(`refuses deleting an exam with ${label} through deleteExam, naming it`, async () => {
      const stored = {
        first_term: { name: 'First Term', order: 1 },
        unit_test_1: { name: 'Unit Test 1', order: 2 },
      };
      const { scope, manager } = await schoolWithActiveSession(stored);
      await write(scope, 'unit_test_1');
      const error = await rejection(
        manager.school.deleteExam({ ...scope, examSlug: 'unit_test_1' }),
      );
      expect(error).toMatchObject({ code: 'CONFLICT' });
      expect(String((error as Error).message)).toContain(
        '“Unit Test 1” (unit_test_1) has plans, a timetable, results, question papers or other recorded data, so it cannot be deleted',
      );
      expect(await storedExamConfig(scope.sessionId)).toEqual(stored);
      // The exam without data is deleted.
      await manager.school.deleteExam({ ...scope, examSlug: 'first_term' });
      expect(await storedExamConfig(scope.sessionId)).toEqual({
        unit_test_1: { name: 'Unit Test 1', order: 2 },
      });
    });

  it('deletes an exam through deleteExam whose rows only record nothing', async () => {
    const { scope, manager } = await schoolWithActiveSession({
      unit_test_1: { name: 'Unit Test 1', order: 1 },
    });
    await db.insert(examLifecycleTable).values({ ...scope, examSlug: 'unit_test_1' });
    await db
      .insert(examAssessmentSettingsTable)
      .values({ ...scope, examSlug: 'unit_test_1', totalWorkingDays: null });
    expect(await manager.school.deleteExam({ ...scope, examSlug: 'unit_test_1' })).toEqual({
      slug: 'unit_test_1',
      name: 'Unit Test 1',
      order: 1,
    });
    expect(await storedExamConfig(scope.sessionId)).toEqual({});
  });

  it('refuses changing the slug of an exam with recorded data, which removes the old slug', async () => {
    const stored = { unit_test_1: { name: 'Unit Test 1', order: 1 } };
    const { scope, manager } = await schoolWithActiveSession(stored);
    await db
      .insert(examAssessmentSettingsTable)
      .values({ ...scope, examSlug: 'unit_test_1', totalWorkingDays: 20 });
    const session = await manager.school.getSession(scope);
    const error = await rejection(
      manager.school.updateSession({
        ...scope,
        sessionConfig: withExams(session, { unit_test_one: { name: 'Unit Test 1', order: 1 } }),
        expectedUpdatedAt: sessionVersionToken(session.updatedAt),
      }),
    );
    expect(error).toMatchObject({ code: 'CONFLICT' });
    expect(String((error as Error).message)).toContain('slug cannot be changed');
    expect(await storedExamConfig(scope.sessionId)).toEqual(stored);
  });

  it('allows removing an exam whose rows only record nothing: a bare ready lifecycle and a cleared working-day limit', async () => {
    const { scope, manager } = await schoolWithActiveSession({
      unit_test_1: { name: 'Unit Test 1', order: 1 },
    });
    // What deleting every plan and clearing the working-day limit leave behind.
    await db.insert(examLifecycleTable).values({ ...scope, examSlug: 'unit_test_1' });
    await db
      .insert(examAssessmentSettingsTable)
      .values({ ...scope, examSlug: 'unit_test_1', totalWorkingDays: null });
    await removeExam(manager, scope, 'unit_test_1');
    expect(await storedExamConfig(scope.sessionId)).toEqual({});
  });

  it('does not let data under a slug the configuration no longer defines block saving other settings', async () => {
    const stored = { first_term: { name: 'First Term', order: 1 } };
    const { scope, manager } = await schoolWithActiveSession(stored);
    // Left by an exam deleted earlier.
    const { student } = await testStudent(scope);
    await db
      .insert(examStudentRemarkTable)
      .values({ ...scope, examSlug: 'old_exam', studentId: student.id, text: 'Kept.' });
    const session = await manager.school.getSession(scope);
    await manager.school.updateSession({
      ...scope,
      sessionConfig: withExams(session, {
        ...stored,
        annual: { name: 'Annual', order: 2 },
      }),
      expectedUpdatedAt: sessionVersionToken(session.updatedAt),
    });
    expect(Object.keys(await storedExamConfig(scope.sessionId)).sort()).toEqual([
      'annual',
      'first_term',
    ]);
  });
});

describe('school.createSession / school.updateSession invisible-only exam names', () => {
  it('refuses a new exam whose name is only invisible characters, without changing the session', async () => {
    const stored = { first_term: { name: 'First Term', order: 1 } };
    const { scope, manager } = await schoolWithActiveSession(stored);
    for (const name of ['\u200b', ' \u200b\u200d ', '\ufeff\u2060']) {
      const session = await manager.school.getSession(scope);
      await expect(
        manager.school.updateSession({
          ...scope,
          sessionConfig: withExams(session, { ...stored, unit_test_1: { name, order: 2 } }),
          expectedUpdatedAt: sessionVersionToken(session.updatedAt),
        }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    }
    expect(await storedExamConfig(scope.sessionId)).toEqual(stored);
  });

  it('refuses renaming an exam to only invisible characters', async () => {
    const stored = { first_term: { name: 'First Term', order: 1 } };
    const { scope, manager } = await schoolWithActiveSession(stored);
    const session = await manager.school.getSession(scope);
    await expect(
      manager.school.updateSession({
        ...scope,
        sessionConfig: withExams(session, { first_term: { name: '\u200b\u200b', order: 1 } }),
        expectedUpdatedAt: sessionVersionToken(session.updatedAt),
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(await storedExamConfig(scope.sessionId)).toEqual(stored);
  });

  it('keeps saving an exam stored with such a name before the rule, while it keeps its slug and name', async () => {
    const stored = {
      ghost: { name: '\u200b', order: 1 },
      first_term: { name: 'First Term', order: 2 },
    };
    const { scope, manager } = await schoolWithActiveSession(stored);
    const session = await manager.school.getSession(scope);
    const next = { ...stored, annual: { name: 'Annual', order: 3 } };
    await manager.school.updateSession({
      ...scope,
      sessionConfig: withExams(session, next),
      expectedUpdatedAt: sessionVersionToken(session.updatedAt),
    });
    expect(await storedExamConfig(scope.sessionId)).toEqual(next);
    // Moving it to another slug makes it a new exam, which is judged.
    const latest = await manager.school.getSession(scope);
    await expect(
      manager.school.updateSession({
        ...scope,
        sessionConfig: withExams(latest, {
          first_term: next.first_term,
          annual: next.annual,
          ghost_2: { name: '\u200b', order: 1 },
        }),
        expectedUpdatedAt: sessionVersionToken(latest.updatedAt),
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('refuses creating a session with such an exam', async () => {
    const { scope, manager } = await schoolWithActiveSession();
    await expect(
      manager.school.createSession({
        schoolId: scope.schoolId,
        sessionStartYear: 2030,
        sessionEndYear: 2031,
        sessionConfig: sessionConfigSchema.parse({
          examConfig: { unit_test_1: { name: '\u200d', order: 1 } },
        }),
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    const created = await manager.school.createSession({
      schoolId: scope.schoolId,
      sessionStartYear: 2030,
      sessionEndYear: 2031,
      sessionConfig: sessionConfigSchema.parse({
        examConfig: { unit_test_1: { name: 'Unit Test 1', order: 1 } },
      }),
    });
    expect(created.sessionConfig?.examConfig).toEqual({
      unit_test_1: { name: 'Unit Test 1', order: 1 },
    });
  });
});
