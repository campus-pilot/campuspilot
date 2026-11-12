import { db } from '@campuspilot/db';
import { schoolAssistantAccessRoleTable } from '@campuspilot/db/schema/assistant';
import { classTable } from '@campuspilot/db/schema/class';
import { examLifecycleTable, examPlanTable } from '@campuspilot/db/schema/exam';
import type { Role } from '@campuspilot/db/schema/jsonb/role';
import { schoolSessionTable } from '@campuspilot/db/schema/session';
import { eq } from 'drizzle-orm';

import {
  createHandlerContext,
  createSchoolStaffSession,
  createTestClass,
  createTestClient,
  createTestSchool,
  createTestSession,
  type TestClient,
  type UserSession,
} from './fixtures';
import type { Context } from '../src/context';

/** A member of the test school: who they are, their API client and the context of their session for HTTP handlers. */
export type QuestionPaperPerson = { session: UserSession; userId: string; client: TestClient; context: Context };

const ALL_ROLES: Role[] = ['principal', 'manager', 'teacher', 'accountant', 'exam_coordinator'];

/** Roles the school has switched on for the AI assistant (`school_assistant_access_role`), replacing the previous set. */
export async function switchAssistantRoles(schoolId: string, roles: Role[]) {
  await db.delete(schoolAssistantAccessRoleTable).where(eq(schoolAssistantAccessRoleTable.schoolId, schoolId));
  if (roles.length) await db.insert(schoolAssistantAccessRoleTable).values(roles.map((role) => ({ schoolId, role })));
}

/**
 * A school with everything the question paper feature needs, named so tests
 * read like the product:
 * - the `assistant` feature on, every role eligible, all but the accountant
 *   switched on;
 * - an active session with the exam `term-1` and two classes;
 * - plans for both classes: `science` (mode `theory`, 20 marks) and `math`
 *   (modes `theory` 16 marks and `practical` 4 marks);
 * - staff of each role, a teacher of `classId` and a teacher of `otherClassId`;
 * - optionally the `question-paper-classic` template selected.
 */
export async function createQuestionPaperWorld(options: { template?: boolean; school?: { id: string; isDemo: boolean } } = {}) {
  const school = await createTestSchool({
    ...options.school,
    name: 'Question Paper School',
    registrationNo: 'QP-2026',
    features: [{ feature: 'assistant', config: { monthlyLimitUsd: 100, eligibleRoles: ALL_ROLES } }],
  });
  const schoolId = school.id;
  await switchAssistantRoles(schoolId, ['principal', 'manager', 'teacher', 'exam_coordinator']);
  const session = await createTestSession({ schoolId, sessionStartYear: 2026, sessionEndYear: 2027, isActive: true });
  const sessionId = session.id;
  await db
    .update(schoolSessionTable)
    .set({
      sessionConfig: {
        examConfig: { 'term-1': { name: 'Term I Examination', order: 1 } },
        coScholasticAreas: {},
        gradingScale: {},
        attendanceTracking: { enabled: false },
      },
    })
    .where(eq(schoolSessionTable.id, sessionId));
  const classId = (await createTestClass({ schoolId, label: 'Class 8' })).schoolClass.id;
  const otherClassId = (await createTestClass({ schoolId, label: 'Class 9' })).schoolClass.id;
  for (const id of [classId, otherClassId]) {
    await db
      .update(classTable)
      .set({
        config: {
          subjects: {
            science: { name: 'Science', books: [], examModes: { theory: { name: 'Theory', percentage: 100 } } },
            math: {
              name: 'Mathematics',
              books: [],
              examModes: { theory: { name: 'Theory', percentage: 80 }, practical: { name: 'Practical', percentage: 20 } },
            },
          },
        },
      })
      .where(eq(classTable.id, id));
    await db.insert(examPlanTable).values([
      { schoolId, sessionId, classId: id, examSlug: 'term-1', subjectSlug: 'science', totalMarks: 20, modeConfig: { theory: { percentage: 100, maxMarks: 20 } }, status: 'approved' },
      {
        schoolId,
        sessionId,
        classId: id,
        examSlug: 'term-1',
        subjectSlug: 'math',
        totalMarks: 20,
        modeConfig: { theory: { percentage: 80, maxMarks: 16 }, practical: { percentage: 20, maxMarks: 4 } },
        status: 'approved',
      },
    ]);
  }

  const staff = async (roles: Array<{ role: Role; classIds?: string[] }>): Promise<QuestionPaperPerson> => {
    const { session: userSession, user } = await createSchoolStaffSession(
      schoolId,
      roles.map(({ role, classIds }) => ({ role, meta: classIds ? { classIds } : null })),
    );
    return { session: userSession as UserSession, userId: user.id, client: createTestClient(userSession), context: createHandlerContext(userSession) };
  };
  const people = {
    manager: await staff([{ role: 'manager' }]),
    principal: await staff([{ role: 'principal' }]),
    coordinator: await staff([{ role: 'exam_coordinator' }]),
    teacher: await staff([{ role: 'teacher', classIds: [classId] }]),
    otherTeacher: await staff([{ role: 'teacher', classIds: [otherClassId] }]),
    accountant: await staff([{ role: 'accountant' }]),
  };
  if (options.template !== false) {
    await people.manager.client.school.selectMarketplaceTemplate({
      schoolId,
      documentType: 'question_paper',
      slug: 'question-paper-classic',
      expectedRevisionId: null,
    });
  }
  return {
    schoolId,
    sessionId,
    classId,
    otherClassId,
    people,
    /** The paper key of a subject and mode of the first class (science/theory by default). */
    key: (overrides: Partial<{ classId: string; subjectSlug: string; modeSlug: string }> = {}) => ({
      schoolId,
      sessionId,
      examSlug: 'term-1',
      classId,
      subjectSlug: 'science',
      modeSlug: 'theory',
      ...overrides,
    }),
    /** Marks the exam as started (`active`) or finished (`completed`). */
    setLifecycle: async (status: 'ready' | 'active' | 'completed') => {
      await db
        .insert(examLifecycleTable)
        .values({ schoolId, sessionId, examSlug: 'term-1', status })
        .onConflictDoUpdate({
          target: [examLifecycleTable.sessionId, examLifecycleTable.examSlug],
          set: { status },
        });
    },
  };
}

export type QuestionPaperWorld = Awaited<ReturnType<typeof createQuestionPaperWorld>>;
