import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@campuspilot/db';
import { studentTable } from '@campuspilot/db/schema/student';
import { classTable } from '@campuspilot/db/schema/class';
import { schoolSessionTable } from '@campuspilot/db/schema/session';
import {
  examPlanTable,
  examLifecycleTable,
  examResultTable,
  examStudentAssessmentTable,
} from '@campuspilot/db/schema/exam';
import { and, eq } from 'drizzle-orm';
import {
  createAdminSession,
  createSchoolStaffSession,
  createTestAdmission,
  createTestClass,
  createTestClient,
  createTestSchool,
  createTestSession,
  createTestStudent,
} from '../../../../test/fixtures';

describe('student-first examination lifecycle', () => {
  let scope: {
    schoolId: string;
    sessionId: string;
    examSlug: string;
    classId: string;
    studentId: string;
  };
  let manager: ReturnType<typeof createTestClient>;
  let teacher: ReturnType<typeof createTestClient>;
  let assigned: ReturnType<typeof createTestClient>;
  let sectionId: string;
  const makeClient = async (
    schoolId: string,
    roles: Parameters<typeof createSchoolStaffSession>[1],
  ) =>
    createTestClient((await createSchoolStaffSession(schoolId, roles)).session);
  beforeEach(async () => {
    const school = await createTestSchool();
    const session = await createTestSession({
      schoolId: school.id,
      sessionStartYear: 2026,
      sessionEndYear: 2027,
      isActive: true,
    });
    const { schoolClass, sections } = await createTestClass({
      schoolId: school.id,
    });
    sectionId = sections[0]!.id;
    await db
      .update(classTable)
      .set({
        config: {
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
        },
      })
      .where(eq(classTable.id, schoolClass.id));
    await db
      .update(schoolSessionTable)
      .set({
        sessionConfig: {
          examConfig: { term: { name: 'Term', order: 1 } },
          coScholasticAreas: { art: { name: 'Art' } },
          gradingScale: {},
          attendanceTracking: { enabled: true },
        },
      })
      .where(eq(schoolSessionTable.id, session.id));
    const student = await createTestStudent({
      schoolId: school.id,
      sessionId: session.id,
      classId: schoolClass.id,
      sectionId,
      admissionId: (
        await createTestAdmission({ schoolId: school.id, name: 'A Student' })
      ).id,
    });
    scope = {
      schoolId: school.id,
      sessionId: session.id,
      examSlug: 'term',
      classId: schoolClass.id,
      studentId: student.id,
    };
    manager = await makeClient(school.id, [{ role: 'manager' }]);
    teacher = await makeClient(school.id, [
      { role: 'teacher', meta: { classIds: [] } },
    ]);
    assigned = await makeClient(school.id, [
      { role: 'teacher', meta: { classIds: [schoolClass.id] } },
    ]);
    const preview = await manager.school.getExamPlanPreview(scope);
    expect(preview.classes[0]!.studentCount).toBe(1);
    await manager.school.generateExamPlan({
      ...scope,
      configurationVersion: preview.configurationVersion,
    });
    expect(await manager.school.getExamOverview(scope)).toMatchObject({
      planCount: 2,
      status: 'ready',
      startedAt: null,
      completedAt: null,
    });
    await manager.school.transitionExam({ ...scope, status: 'active' });
  });
  async function payload() {
    const data = await manager.school.getStudentExam(scope);
    return {
      ...scope,
      subjects: data.subjects.map(({ plan }) => ({
        examPlanId: plan.id,
        marks: Object.fromEntries(
          Object.keys(plan.modeConfig).map((slug) => [slug, 10]),
        ),
      })),
      daysAttended: null as number | null,
      coScholastics: { art: 'A' },
      approved: false,
    };
  }
  const rows = () =>
    db
      .select()
      .from(examResultTable)
      .where(eq(examResultTable.studentId, scope.studentId));
  it('opens only after a manual start and atomically saves one student across subjects with shared activities and attendance', async () => {
    const data = await manager.school.getStudentExam(scope);
    expect(data.subjects.every(({ plan }) => plan.status === 'active')).toBe(
      true,
    );
    const classes = await teacher.school.listExamClasses({
      ...scope,
      limit: 20,
    });
    expect(classes.items[0]).toMatchObject({
      studentCount: 1,
      subjectCount: 2,
      modeCount: 3,
    });
    expect(
      classes.items[0]!.sections.some((section) => section.id === sectionId),
    ).toBe(true);
    expect(
      (
        await teacher.school.listExamClasses({
          ...scope,
          filters: { classId: 'missing' },
        })
      ).pagination.totalItems,
    ).toBe(0);
    await manager.school.updateExamAssessmentSettings({
      ...scope,
      totalWorkingDays: 100,
    });
    expect(await teacher.school.getExamAssessmentSettings(scope)).toEqual({
      totalWorkingDays: 100,
    });
    const saved = await teacher.school.saveStudentExam({
      ...(await payload()),
      daysAttended: 80,
    });
    expect(saved.assessment).toMatchObject({
      daysAttended: 80,
      coScholastics: { art: 'A' },
      approved: false,
    });
    expect(await rows()).toHaveLength(2);
    expect(
      (await rows()).every(
        (row) => row.daysAttended === null && row.coScholastics === null,
      ),
    ).toBe(true);
    const roster = await teacher.school.listExamStudents({
      ...scope,
      filters: { sectionId },
      searchQuery: 'A Student',
    });
    expect(roster.items[0]).toMatchObject({
      sectionId,
      savedSubjects: 2,
      approvedSubjects: 0,
    });
    expect(roster.pagination).toMatchObject({
      totalItems: 1,
      pageSize: 20,
      currentPage: 1,
    });
    expect(
      (
        await teacher.school.listExamStudents({
          ...scope,
          searchQuery: 'absent',
        })
      ).items,
    ).toEqual([]);
  });
  it.each(['principal', 'manager', 'exam_coordinator'] as const)(
    'requires an explicit %s start after generation and persists lifecycle timestamps',
    async (role) => {
      const client = await makeClient(scope.schoolId, [{ role }]);
      const [session] = await db
        .select()
        .from(schoolSessionTable)
        .where(eq(schoolSessionTable.id, scope.sessionId));
      await db
        .update(schoolSessionTable)
        .set({
          sessionConfig: {
            ...session!.sessionConfig!,
            examConfig: {
              ...session!.sessionConfig!.examConfig,
              next: { name: 'Next exam', order: 2 },
            },
          },
        })
        .where(eq(schoolSessionTable.id, scope.sessionId));
      const next = { ...scope, examSlug: 'next' };
      const preview = await client.school.getExamPlanPreview(next);
      await client.school.generateExamPlan({
        ...next,
        configurationVersion: preview.configurationVersion,
      });
      const data = await client.school.getStudentExam(next);
      const input = {
        ...next,
        subjects: data.subjects.map(({ plan }) => ({
          examPlanId: plan.id,
          marks: Object.fromEntries(
            Object.keys(plan.modeConfig).map((slug) => [slug, 10]),
          ),
        })),
        approved: false,
      };
      expect(data.subjects.every(({ plan }) => plan.status === 'draft')).toBe(
        true,
      );
      await expect(teacher.school.saveStudentExam(input)).rejects.toMatchObject(
        {
          code: 'BAD_REQUEST',
          message: expect.stringContaining('Start the examination'),
        },
      );
      await expect(
        teacher.school.upsertExamResult({
          ...next,
          examPlanId: data.subjects[0]!.plan.id,
          marks: input.subjects[0]!.marks,
        }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      await expect(
        teacher.school.transitionExam({ ...next, status: 'active' }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(
        createTestClient(await createAdminSession()).school.transitionExam({
          ...next,
          status: 'active',
        }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(
        client.school.transitionExam({ ...next, status: 'completed' }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      await client.school.transitionExam({ ...next, status: 'active' });
      expect(await teacher.school.getExamOverview(next)).toMatchObject({
        status: 'active',
        startedAt: expect.any(Date),
        completedAt: null,
      });
      await expect(
        client.school.transitionExam({ ...next, status: 'active' }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      const started = await client.school.getExamOverview(next);
      await teacher.school.saveStudentExam(input);
      await client.school.saveStudentExam({ ...input, approved: true });
      await client.school.transitionExam({ ...next, status: 'completed' });
      expect(await client.school.getExamOverview(next)).toMatchObject({
        status: 'completed',
        startedAt: expect.any(Date),
        completedAt: expect.any(Date),
      });
      expect(
        (await client.school.listExams(scope)).items.find(
          (exam) => exam.slug === 'next',
        ),
      ).toMatchObject({ status: 'completed', planCount: 2 });
      await client.school.transitionExam({ ...next, status: 'active' });
      expect((await client.school.getExamOverview(next)).startedAt).toEqual(
        started.startedAt,
      );
    },
  );
  it.each(['active', 'completed'] as const)(
    'preserves an unknown legacy start time when reopening a %s examination',
    async (status) => {
      await db
        .update(examLifecycleTable)
        .set({ status, startedAt: null })
        .where(
          and(
            eq(examLifecycleTable.sessionId, scope.sessionId),
            eq(examLifecycleTable.examSlug, scope.examSlug),
          ),
        );
      await db
        .update(examPlanTable)
        .set({ status: status === 'active' ? 'draft' : 'completed' })
        .where(eq(examPlanTable.sessionId, scope.sessionId));
      await manager.school.transitionExam({ ...scope, status: 'active' });
      expect(await manager.school.getExamOverview(scope)).toMatchObject({
        status: 'active',
        startedAt: null,
        completedAt: null,
      });
    },
  );
  it('rolls back the whole student save when a later subject is already approved', async () => {
    const input = await payload();
    await teacher.school.saveStudentExam(input);
    await db
      .update(examResultTable)
      .set({ approved: true })
      .where(eq(examResultTable.examPlanId, input.subjects.at(-1)!.examPlanId));
    const before = await rows();
    const assessment = (await manager.school.getStudentExam(scope)).assessment;
    await expect(
      teacher.school.saveStudentExam({
        ...input,
        subjects: input.subjects.map((subject) => ({
          ...subject,
          marks: Object.fromEntries(
            Object.keys(subject.marks).map((slug) => [slug, 15]),
          ),
        })),
        coScholastics: { art: 'Changed' },
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await rows()).toEqual(before);
    expect((await manager.school.getStudentExam(scope)).assessment).toEqual(
      assessment,
    );
  });
  it('keeps paginated class summaries scoped to the selected class', async () => {
    const other = await createTestClass({ schoolId: scope.schoolId });
    const [plan] = await db
      .select()
      .from(examPlanTable)
      .where(eq(examPlanTable.sessionId, scope.sessionId));
    await db
      .insert(examPlanTable)
      .values({
        ...plan!,
        id: undefined,
        classId: other.schoolClass.id,
        subjectSlug: 'other',
        modeConfig: { oral: { percentage: 100, maxMarks: 100 } },
      });
    const page = await teacher.school.listExamClasses({
      ...scope,
      limit: 1,
      filters: { classId: other.schoolClass.id },
    });
    expect(page.pagination.totalItems).toBe(1);
    expect(page.items).toEqual([
      expect.objectContaining({
        classId: other.schoolClass.id,
        subjectCount: 1,
        modeCount: 1,
        studentCount: 0,
      }),
    ]);
    expect(page.items[0]!.sections.map((section) => section.id)).toEqual(
      other.sections.map((section) => section.id),
    );
    const empty = await teacher.school.listExamClasses({
      ...scope,
      page: 3,
      limit: 1,
    });
    expect(empty.items).toEqual([]);
    expect(empty.pagination.totalItems).toBe(2);
  });
  it('lists independent lifecycle and plan facts across exam pages and empty pages', async () => {
    await manager.school.createExam({
      ...scope,
      examSlug: 'unplanned',
      name: 'Unplanned',
      order: 2,
    });
    const page = await teacher.school.listExams({
      ...scope,
      limit: 1,
      page: 2,
    });
    expect(page.items).toEqual([
      expect.objectContaining({
        slug: 'unplanned',
        planCount: 0,
        status: null,
        startedAt: null,
        completedAt: null,
      }),
    ]);
    expect(page.pagination.totalItems).toBe(2);
    expect(
      (await teacher.school.listExams({ ...scope, limit: 1, page: 3 })).items,
    ).toEqual([]);
    expect(
      (await teacher.school.listExams({ ...scope, limit: 1, page: 1 }))
        .items[0],
    ).toMatchObject({ slug: 'term', planCount: 2, status: 'active' });
  });
  it('counts only results belonging to the student’s current exam class', async () => {
    await teacher.school.saveStudentExam(await payload());
    const other = await createTestClass({ schoolId: scope.schoolId });
    const [plan] = await db
      .select()
      .from(examPlanTable)
      .where(eq(examPlanTable.sessionId, scope.sessionId));
    await db
      .insert(examPlanTable)
      .values({ ...plan!, id: undefined, classId: other.schoolClass.id });
    await db
      .update(studentTable)
      .set({ classId: other.schoolClass.id, sectionId: other.sections[0]!.id })
      .where(eq(studentTable.id, scope.studentId));
    const roster = await teacher.school.listExamStudents({
      ...scope,
      classId: other.schoolClass.id,
    });
    expect(roster.items[0]).toMatchObject({
      studentId: scope.studentId,
      savedSubjects: 0,
      approvedSubjects: 0,
      subjectCount: 1,
    });
  });
  it('distinguishes timetable subject/mode pairs containing separators while rejecting actual duplicates', async () => {
    await db
      .update(classTable)
      .set({
        config: {
          subjects: {
            'a:b': {
              name: 'First',
              books: [],
              examModes: { c: { name: 'C', percentage: 100 } },
            },
            a: {
              name: 'Second',
              books: [],
              examModes: { 'b:c': { name: 'BC', percentage: 100 } },
            },
          },
        },
      })
      .where(eq(classTable.id, scope.classId));
    const pairs = [
      { subjectSlug: 'a:b', modeSlug: 'c' },
      { subjectSlug: 'a', modeSlug: 'b:c' },
    ];
    const config = {
      columns: [scope.classId],
      rows: [
        {
          id: 'slot',
          date: '2026-10-16',
          startTime: '09:00',
          endTime: '10:00',
          cells: { [scope.classId]: pairs },
        },
      ],
    };
    expect(
      (await manager.school.saveExamTimetable({ ...scope, config })).config,
    ).toEqual(config);
    await expect(
      manager.school.saveExamTimetable({
        ...scope,
        config: {
          ...config,
          rows: [
            {
              ...config.rows[0]!,
              cells: { [scope.classId]: [pairs[0]!, pairs[0]!] },
            },
          ],
        },
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect((await manager.school.getExamTimetable(scope))!.config).toEqual(
      config,
    );
  });
  it('checks explicit approval and elevated revision; failures leave all subjects untouched', async () => {
    const input = await payload();
    await expect(
      teacher.school.saveStudentExam({ ...input, approved: true }),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: expect.stringContaining('assigned class teacher'),
    });
    expect(await rows()).toHaveLength(0);
    await teacher.school.saveStudentExam(input);
    const approved = await assigned.school.saveStudentExam({
      ...input,
      approved: true,
    });
    expect(approved.assessment!.approved).toBe(true);
    expect((await rows()).every((row) => row.approved)).toBe(true);
    await expect(assigned.school.saveStudentExam(input)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(teacher.school.saveStudentExam(input)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await manager.school.saveStudentExam(input);
    expect((await rows()).every((row) => !row.approved)).toBe(true);
  });
  it('validates every subject and shared assessment before committing and rejects missing/extra subjects', async () => {
    const input = await payload();
    for (const invalid of [
      { ...input, subjects: input.subjects.slice(1) },
      {
        ...input,
        subjects: [
          ...input.subjects,
          { examPlanId: 'alien', marks: { written: 1 } },
        ],
      },
      {
        ...input,
        subjects: input.subjects.map((row, index) =>
          index === 1 ? { ...row, marks: { written: 999 } } : row,
        ),
      },
      { ...input, subjects: [input.subjects[0]!, input.subjects[0]!] },
      { ...input, coScholastics: { unknown: 'A' } },
      { ...input, daysAttended: 1 },
      { ...input, daysAttended: -1 },
    ])
      await expect(
        teacher.school.saveStudentExam(invalid),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(await rows()).toHaveLength(0);
    expect(
      await db
        .select()
        .from(examStudentAssessmentTable)
        .where(eq(examStudentAssessmentTable.studentId, scope.studentId)),
    ).toHaveLength(0);
    await manager.school.updateExamAssessmentSettings({
      ...scope,
      totalWorkingDays: 20,
    });
    await expect(
      teacher.school.saveStudentExam({ ...input, daysAttended: 21 }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await teacher.school.saveStudentExam({ ...input, daysAttended: 20 });
    await expect(
      manager.school.updateExamAssessmentSettings({
        ...scope,
        totalWorkingDays: 19,
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(
      manager.school.updateExamAssessmentSettings({
        ...scope,
        totalWorkingDays: null,
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });
  it('completes all classes together, protects completed writes, and reopens without losing approval', async () => {
    const input = await payload();
    await expect(
      manager.school.transitionExam({ ...scope, status: 'completed' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await teacher.school.saveStudentExam(input);
    await expect(
      manager.school.transitionExam({ ...scope, status: 'completed' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await assigned.school.saveStudentExam({ ...input, approved: true });
    expect(
      await manager.school.transitionExam({ ...scope, status: 'completed' }),
    ).toEqual({ updatedCount: 2 });
    await expect(manager.school.saveStudentExam(input)).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    await expect(
      manager.school.updateExamAssessmentSettings({
        ...scope,
        totalWorkingDays: 20,
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(
      (await teacher.school.getStudentExam(scope)).subjects.every(
        ({ plan }) => plan.status === 'completed',
      ),
    ).toBe(true);
    await manager.school.transitionExam({ ...scope, status: 'active' });
    expect((await rows()).every((row) => row.approved)).toBe(true);
  });
  it('opens legacy drafts/approved plans in one action and preserves legacy subject metadata explicitly', async () => {
    const input = await payload();
    await db
      .update(examPlanTable)
      .set({ status: 'draft' })
      .where(eq(examPlanTable.id, input.subjects[0]!.examPlanId));
    await expect(teacher.school.saveStudentExam(input)).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    await manager.school.transitionExam({ ...scope, status: 'active' });
    await teacher.school.saveStudentExam(input);
    await db
      .update(examResultTable)
      .set({ daysAttended: 45, coScholastics: { removedArea: 'Legacy' } })
      .where(eq(examResultTable.examPlanId, input.subjects[0]!.examPlanId));
    await teacher.school.saveStudentExam({
      ...input,
      coScholastics: { art: 'New' },
    });
    expect(
      (await rows()).find(
        (row) => row.examPlanId === input.subjects[0]!.examPlanId,
      ),
    ).toMatchObject({
      daysAttended: 45,
      coScholastics: { removedArea: 'Legacy' },
    });
    expect(
      (await teacher.school.getStudentExam(scope)).assessment!.coScholastics,
    ).toEqual({ art: 'New' });
  });
  it('allows staff/platform-admin reads, denies their writes and enforces tenant/auth boundaries for all new endpoints', async () => {
    const input = await payload();
    const readOnly = [
      createTestClient(await createAdminSession()),
      await makeClient(scope.schoolId, [{ role: 'accountant' }]),
    ];
    for (const client of readOnly) {
      await client.school.getExamOverview(scope);
      await client.school.listExamClasses(scope);
      await client.school.listExamStudents(scope);
      await client.school.getStudentExam(scope);
      await client.school.getExamAssessmentSettings(scope);
      await Promise.all(
        [
          client.school.saveStudentExam(input),
          client.school.transitionExam({ ...scope, status: 'completed' }),
          client.school.updateExamAssessmentSettings({
            ...scope,
            totalWorkingDays: 20,
          }),
        ].map((operation) =>
          expect(operation).rejects.toMatchObject({ code: 'FORBIDDEN' }),
        ),
      );
    }
    for (const [client, code] of [
      [createTestClient(null), 'UNAUTHORIZED'],
      [
        await makeClient((await createTestSchool()).id, [{ role: 'manager' }]),
        'FORBIDDEN',
      ],
    ] as const) {
      await Promise.all(
        [
          client.school.getExamOverview(scope),
          client.school.listExamClasses(scope),
          client.school.listExamStudents(scope),
          client.school.getStudentExam(scope),
          client.school.getExamAssessmentSettings(scope),
          client.school.saveStudentExam(input),
          client.school.transitionExam({ ...scope, status: 'active' }),
          client.school.updateExamAssessmentSettings({
            ...scope,
            totalWorkingDays: 20,
          }),
        ].map((operation) => expect(operation).rejects.toMatchObject({ code })),
      );
    }
    await expect(
      teacher.school.transitionExam({ ...scope, status: 'active' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      teacher.school.updateExamAssessmentSettings({
        ...scope,
        totalWorkingDays: 20,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
  it('guards inactive sessions, cross-class students, sections, unknown exams and pagination', async () => {
    await expect(
      manager.school.getStudentExam({ ...scope, studentId: 'missing' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      manager.school.getStudentExam({ ...scope, examSlug: 'missing' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      manager.school.listExamStudents({
        ...scope,
        filters: { sectionId: 'missing' },
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      manager.school.listExamClasses({ ...scope, limit: 21 }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    const otherClass = await createTestClass({ schoolId: scope.schoolId });
    await expect(
      manager.school.getStudentExam({
        ...scope,
        classId: otherClass.schoolClass.id,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      manager.school.listExamStudents({
        ...scope,
        classId: otherClass.schoolClass.id,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      manager.school.getExamOverview({ ...scope, examSlug: 'missing' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      manager.school.getExamOverview({ ...scope, examSlug: '' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    const input = await payload();
    await db
      .update(schoolSessionTable)
      .set({ isActive: false })
      .where(eq(schoolSessionTable.id, scope.sessionId));
    await Promise.all(
      [
        manager.school.saveStudentExam(input),
        manager.school.transitionExam({ ...scope, status: 'completed' }),
        manager.school.updateExamAssessmentSettings({
          ...scope,
          totalWorkingDays: 20,
        }),
      ].map((operation) =>
        expect(operation).rejects.toMatchObject({ code: 'BAD_REQUEST' }),
      ),
    );
    expect((await manager.school.getStudentExam(scope)).student.studentId).toBe(
      scope.studentId,
    );
  });
});
