import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@campuspilot/db';
import { classTable } from '@campuspilot/db/schema/class';
import { schoolSessionTable } from '@campuspilot/db/schema/session';
import { examPlanTable, examTimetableTable } from '@campuspilot/db/schema/exam';
import { and, eq } from 'drizzle-orm';
import {
  createAdminSession,
  createRegularUserSession,
  createSchoolStaffSession,
  createTestClass,
  createTestClient,
  createTestSchool,
  createTestSession,
} from '../../../../test/fixtures';

describe('automatic exam plan generation', () => {
  let scope: { schoolId: string; sessionId: string; examSlug: string };
  let classId: string;
  let manager: ReturnType<typeof createTestClient>;
  const config = {
    subjects: {
      maths: {
        name: 'Mathematics',
        books: [],
        examModes: {
          written: { name: 'Written', percentage: 80 },
          practical: { name: 'Practical', percentage: 20 },
        },
      },
      english: {
        name: 'English',
        books: [],
        examModes: { written: { name: 'Written', percentage: 100 } },
      },
    },
  };
  beforeEach(async () => {
    const school = await createTestSchool();
    const session = await createTestSession({
      schoolId: school.id,
      sessionStartYear: 2026,
      sessionEndYear: 2027,
      isActive: true,
    });
    scope = {
      schoolId: school.id,
      sessionId: session.id,
      examSlug: 'first-term',
    };
    await db
      .update(schoolSessionTable)
      .set({
        sessionConfig: {
          examConfig: {
            'first-term': { name: 'First term examination', order: 1 },
          },
          coScholasticAreas: {},
          gradingScale: {},
          attendanceTracking: { enabled: false },
        },
      })
      .where(eq(schoolSessionTable.id, session.id));
    classId = (
      await createTestClass({ schoolId: school.id, label: 'Grade 10' })
    ).schoolClass.id;
    await db
      .update(classTable)
      .set({ config })
      .where(eq(classTable.id, classId));
    await createTestClass({ schoolId: school.id, label: 'No subjects yet' });
    manager = createTestClient(
      (await createSchoolStaffSession(school.id, [{ role: 'manager' }]))
        .session,
    );
  });
  const rows = () =>
    db
      .select()
      .from(examPlanTable)
      .where(
        and(
          eq(examPlanTable.schoolId, scope.schoolId),
          eq(examPlanTable.sessionId, scope.sessionId),
          eq(examPlanTable.examSlug, scope.examSlug),
        ),
      );
  it('previews all classes without writes and atomically creates all configured subjects without a timetable', async () => {
    const preview = await manager.school.getExamPlanPreview(scope);
    expect(preview.classes).toHaveLength(2);
    expect(preview.planCount).toBe(2);
    expect(preview.existingPlanCount).toBe(0);
    expect(preview.classes[0]!.subjects[0]!.modes[0]).toMatchObject({
      percentage: 80,
      maxMarks: 80,
    });
    expect(await rows()).toHaveLength(0);
    expect(
      await manager.school.generateExamPlan({
        ...scope,
        configurationVersion: preview.configurationVersion,
      }),
    ).toEqual({ createdCount: 2 });
    expect(await rows()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          classId,
          subjectSlug: 'maths',
          status: 'draft',
          totalMarks: 100,
          totalWorkingDays: null,
          modeConfig: {
            written: { percentage: 80, maxMarks: 80 },
            practical: { percentage: 20, maxMarks: 20 },
          },
        }),
        expect.objectContaining({ subjectSlug: 'english' }),
      ]),
    );
    expect(
      await db
        .select()
        .from(examTimetableTable)
        .where(eq(examTimetableTable.sessionId, scope.sessionId)),
    ).toHaveLength(0);
    await expect(
      manager.school.generateExamPlan({
        ...scope,
        configurationVersion: preview.configurationVersion,
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(await rows()).toHaveLength(2);
    expect(await manager.school.getExamOverview(scope)).toMatchObject({
      status: 'ready',
      planCount: 2,
      startedAt: null,
    });
    expect((await manager.school.listExams(scope)).items[0]).toMatchObject({
      status: 'ready',
      planCount: 2,
    });
  });
  it('blocks invalid modes for one subject without creating any rows', async () => {
    await db
      .update(classTable)
      .set({
        config: {
          subjects: {
            ...config.subjects,
            science: { name: 'Science', books: [], examModes: {} },
          },
        },
      })
      .where(eq(classTable.id, classId));
    const preview = await manager.school.getExamPlanPreview(scope);
    expect(
      preview.classes[0]!.subjects.find(
        (subject) => subject.subjectSlug === 'science',
      )!.issue,
    ).toBeTruthy();
    await expect(
      manager.school.generateExamPlan({
        ...scope,
        configurationVersion: preview.configurationVersion,
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(await rows()).toHaveLength(0);
  });
  it('rejects a stale review, empty classes, unknown exams and invalid inputs', async () => {
    const preview = await manager.school.getExamPlanPreview(scope);
    await db
      .update(classTable)
      .set({ label: 'Updated Grade 10' })
      .where(eq(classTable.id, classId));
    await expect(
      manager.school.generateExamPlan({
        ...scope,
        configurationVersion: preview.configurationVersion,
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(
      manager.school.generateExamPlan({
        ...scope,
        configurationVersion: 'bad',
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(
      manager.school.getExamPlanPreview({
        ...scope,
        examSlug: 'not-configured',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await db
      .update(classTable)
      .set({ config: { subjects: {} } })
      .where(eq(classTable.id, classId));
    const empty = await manager.school.getExamPlanPreview(scope);
    await expect(
      manager.school.generateExamPlan({
        ...scope,
        configurationVersion: empty.configurationVersion,
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(await rows()).toHaveLength(0);
  });
  it('serializes competing generation without duplicate rows', async () => {
    const preview = await manager.school.getExamPlanPreview(scope);
    const outcomes = await Promise.allSettled([
      manager.school.generateExamPlan({
        ...scope,
        configurationVersion: preview.configurationVersion,
      }),
      manager.school.generateExamPlan({
        ...scope,
        configurationVersion: preview.configurationVersion,
      }),
    ]);
    expect(
      outcomes.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      outcomes.filter((result) => result.status === 'rejected'),
    ).toHaveLength(1);
    expect(await rows()).toHaveLength(2);
  });
  it('preserves an existing partial active plan instead of regenerating or overwriting it', async () => {
    const existing = await manager.school.createExamPlan({
      ...scope,
      classId,
      subjectSlug: 'maths',
    });
    await manager.school.transitionExamPlan({
      schoolId: scope.schoolId,
      sessionId: scope.sessionId,
      classId,
      examPlanId: existing.id,
      status: 'approved',
    });
    const active = await manager.school.transitionExamPlan({
      schoolId: scope.schoolId,
      sessionId: scope.sessionId,
      classId,
      examPlanId: existing.id,
      status: 'active',
    });
    const preview = await manager.school.getExamPlanPreview(scope);
    expect(preview.existingPlanCount).toBe(1);
    await expect(
      manager.school.generateExamPlan({
        ...scope,
        configurationVersion: preview.configurationVersion,
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(await rows()).toEqual([active]);
  });
  it.each(['principal', 'exam_coordinator'] as const)(
    'allows %s to generate the school plan',
    async (role) => {
      const client = createTestClient(
        (await createSchoolStaffSession(scope.schoolId, [{ role }])).session,
      );
      const preview = await client.school.getExamPlanPreview(scope);
      expect(
        await client.school.generateExamPlan({
          ...scope,
          configurationVersion: preview.configurationVersion,
        }),
      ).toEqual({ createdCount: 2 });
      expect(await rows()).toHaveLength(2);
    },
  );
  it('grants reads to school staff/admin, limits creation to school administrators, and rejects tenant/anonymous access', async () => {
    const preview = await manager.school.getExamPlanPreview(scope);
    for (const role of ['teacher', 'accountant'] as const) {
      const client = createTestClient(
        (await createSchoolStaffSession(scope.schoolId, [{ role }])).session,
      );
      expect((await client.school.getExamPlanPreview(scope)).planCount).toBe(2);
      await expect(
        client.school.generateExamPlan({
          ...scope,
          configurationVersion: preview.configurationVersion,
        }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    }
    const admin = createTestClient(await createAdminSession());
    expect((await admin.school.getExamPlanPreview(scope)).planCount).toBe(2);
    await expect(
      admin.school.generateExamPlan({
        ...scope,
        configurationVersion: preview.configurationVersion,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    for (const client of [
      createTestClient(await createRegularUserSession()),
      createTestClient(
        (
          await createSchoolStaffSession((await createTestSchool()).id, [
            { role: 'manager' },
          ])
        ).session,
      ),
    ]) {
      await expect(
        client.school.getExamPlanPreview(scope),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(
        client.school.generateExamPlan({
          ...scope,
          configurationVersion: preview.configurationVersion,
        }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    }
    await expect(
      createTestClient(null).school.getExamPlanPreview(scope),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    await expect(
      createTestClient(null).school.generateExamPlan({
        ...scope,
        configurationVersion: preview.configurationVersion,
      }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    await db
      .update(schoolSessionTable)
      .set({ isActive: false })
      .where(eq(schoolSessionTable.id, scope.sessionId));
    await expect(
      manager.school.generateExamPlan({
        ...scope,
        configurationVersion: preview.configurationVersion,
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(await rows()).toHaveLength(0);
  });
});
