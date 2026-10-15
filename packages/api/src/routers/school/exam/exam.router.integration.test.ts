import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@campuspilot/db";
import { classTable } from "@campuspilot/db/schema/class";
import { schoolSessionTable } from "@campuspilot/db/schema/session";
import { examPlanTable, examResultTable } from "@campuspilot/db/schema/exam";
import { eq } from "drizzle-orm";
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
} from "../../../../test/fixtures";

describe("school exam lifecycle integration", () => {
  let scope: { schoolId: string; sessionId: string; examSlug: string };
  let classId: string;
  let studentId: string;
  let otherStudentId: string;
  let admin: ReturnType<typeof createTestClient>;
  let manager: ReturnType<typeof createTestClient>;
  let teacher: ReturnType<typeof createTestClient>;
  let assigned: ReturnType<typeof createTestClient>;
  let accountant: ReturnType<typeof createTestClient>;
  let outsider: ReturnType<typeof createTestClient>;
  let regular: ReturnType<typeof createTestClient>;
  beforeAll(async () => {
    const school = await createTestSchool();
    const session = await createTestSession({
      schoolId: school.id,
      sessionStartYear: 2026,
      sessionEndYear: 2027,
      isActive: true,
    });
    scope = { schoolId: school.id, sessionId: session.id, examSlug: "midterm" };
    classId = (await createTestClass({ schoolId: school.id })).schoolClass.id;
    const otherClassId = (await createTestClass({ schoolId: school.id }))
      .schoolClass.id;
    await db
      .update(classTable)
      .set({
        config: {
          subjects: {
            maths: {
              name: "Mathematics",
              books: [],
              examModes: {
                written: { name: "Written", percentage: 80 },
                practical: { name: "Practical", percentage: 20 },
              },
            },
          },
        },
      })
      .where(eq(classTable.id, classId));
    await db
      .update(schoolSessionTable)
      .set({
        sessionConfig: {
          examConfig: {},
          coScholasticAreas: { art: { name: "Art" } },
          gradingScale: {},
          attendanceTracking: { enabled: true },
        },
      })
      .where(eq(schoolSessionTable.id, session.id));
    studentId = (
      await createTestStudent({
        schoolId: school.id,
        sessionId: session.id,
        classId,
        admissionId: (await createTestAdmission({ schoolId: school.id })).id,
      })
    ).id;
    otherStudentId = (
      await createTestStudent({
        schoolId: school.id,
        sessionId: session.id,
        classId: otherClassId,
        admissionId: (await createTestAdmission({ schoolId: school.id })).id,
      })
    ).id;
    admin = createTestClient(await createAdminSession());
    manager = createTestClient(
      (await createSchoolStaffSession(school.id, [{ role: "manager" }]))
        .session,
    );
    teacher = createTestClient(
      (
        await createSchoolStaffSession(school.id, [
          { role: "teacher", meta: { classIds: [] } },
        ])
      ).session,
    );
    assigned = createTestClient(
      (
        await createSchoolStaffSession(school.id, [
          { role: "teacher", meta: { classIds: [classId] } },
        ])
      ).session,
    );
    accountant = createTestClient(
      (await createSchoolStaffSession(school.id, [{ role: "accountant" }]))
        .session,
    );
    outsider = createTestClient(
      (
        await createSchoolStaffSession((await createTestSchool()).id, [
          { role: "manager" },
        ])
      ).session,
    );
    regular = createTestClient(await createRegularUserSession());
    await manager.school.createExam({ ...scope, name: "Midterm", order: 1 });
  });

  it("enforces school governance and read-only platform/all-staff access", async () => {
    for (const client of [admin, teacher, accountant]) {
      expect((await client.school.listExams(scope)).items).toHaveLength(1);
      await expect(
        client.school.createExam({
          ...scope,
          examSlug: "forbidden",
          name: "Forbidden",
          order: 2,
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    for (const client of [outsider, regular])
      await expect(client.school.getExam(scope)).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    await expect(
      createTestClient(null).school.listExams(scope),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(
      manager.school.createExam({ ...scope, name: "", order: 0 }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      manager.school.createExam({ ...scope, name: "Duplicate", order: 1 }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(
      (
        await manager.school.updateExam({
          ...scope,
          name: "Midterm exam",
          order: 2,
        })
      ).name,
    ).toBe("Midterm exam");
    expect(
      (await manager.school.updateExam({ ...scope, name: "Renamed midterm" }))
        .order,
    ).toBe(2);
    await expect(manager.school.updateExam(scope)).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect(
      (await admin.school.getExamContext(scope)).classes.some(
        (row) => row.id === classId,
      ),
    ).toBe(true);
    await expect(
      manager.school.getExam({ ...scope, examSlug: "missing" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("enforces mode snapshots, state transitions and assigned-teacher approval through CRUD", async () => {
    const create = {
      ...scope,
      classId,
      subjectSlug: "maths",
      totalMarks: 100,
      totalWorkingDays: 200,
    };
    const plan = await manager.school.createExamPlan(create);
    const planScope = { ...scope, classId, examPlanId: plan.id };
    const result = {
      ...planScope,
      studentId,
      marks: { written: 65, practical: 18 },
      daysAttended: 180,
      coScholastics: { art: "A" },
      approved: false,
    };
    expect(plan.modeConfig.written!.maxMarks).toBe(80);
    await expect(
      manager.school.createExamPlan({ ...create, subjectSlug: "constructor" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      manager.school.createExamPlan({ ...create, totalMarks: 101 }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      manager.school.createExamPlan({
        ...create,
        modeConfig: {
          written: { percentage: 80, maxMarks: 79 },
          practical: { percentage: 20, maxMarks: 20 },
        },
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(manager.school.createExamPlan(create)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    await expect(teacher.school.upsertExamResult(result)).rejects.toMatchObject(
      { code: "BAD_REQUEST" },
    );
    await expect(
      manager.school.transitionExamPlan({ ...planScope, status: "active" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await manager.school.transitionExamPlan({
      ...planScope,
      status: "approved",
    });
    const updatedPlan = await manager.school.updateExamPlan({
      ...planScope,
      totalMarks: 100,
    });
    expect(updatedPlan.status).toBe("draft");
    expect(updatedPlan.totalWorkingDays).toBe(200);
    expect(updatedPlan.modeConfig).toEqual(plan.modeConfig);
    await expect(
      manager.school.updateExamPlan(planScope),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await manager.school.transitionExamPlan({
      ...planScope,
      status: "approved",
    });
    await manager.school.transitionExamPlan({ ...planScope, status: "active" });
    await expect(
      manager.school.updateExamPlan({ ...planScope, totalMarks: 100 }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      manager.school.deleteExamPlan(planScope),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      teacher.school.upsertExamResult({ ...result, approved: true }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: expect.stringContaining("assigned class teacher"),
    });
    await expect(
      teacher.school.upsertExamResults({
        ...planScope,
        results: [{ ...result, approved: true }],
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const saved = await teacher.school.upsertExamResult(result);
    expect(saved.approved).toBe(false);
    const secondStudentId = (
      await createTestStudent({
        schoolId: scope.schoolId,
        sessionId: scope.sessionId,
        classId,
        admissionId: (await createTestAdmission({ schoolId: scope.schoolId }))
          .id,
      })
    ).id;
    await expect(
      teacher.school.upsertExamResults({
        ...planScope,
        results: [
          { ...result, marks: { written: 60, practical: 10 } },
          {
            ...result,
            studentId: secondStudentId,
            marks: { written: 90, practical: 10 },
          },
        ],
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(
      (await teacher.school.getExamResult({ ...planScope, studentId })).marks
        .written,
    ).toBe(65);
    await expect(
      teacher.school.getExamResult({
        ...planScope,
        studentId: secondStudentId,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await assigned.school.upsertExamResults({
      ...planScope,
      results: [{ ...result, studentId: secondStudentId, approved: true }],
    });
    expect(
      (await teacher.school.getExamResult({ ...planScope, studentId })).id,
    ).toBe(saved.id);
    expect(
      (await admin.school.listExamResults(planScope)).pagination.totalItems,
    ).toBe(2);
    expect(
      (
        await manager.school.listExamResults({
          ...planScope,
          filters: { approved: false },
        })
      ).pagination.totalItems,
    ).toBe(1);
    expect(
      (
        await manager.school.listExamResults({
          ...planScope,
          filters: { approved: true, studentId },
        })
      ).pagination.totalItems,
    ).toBe(0);
    expect(
      (
        await manager.school.listExamPlans({
          ...scope,
          filters: { classId, status: "active" },
        })
      ).pagination.totalItems,
    ).toBe(1);
    expect(
      (
        await manager.school.listExamPlans({
          ...scope,
          filters: { classId, status: "draft" },
        })
      ).pagination.totalItems,
    ).toBe(0);
    expect(
      (await admin.school.listExamRoster(planScope)).items.some(
        (row) => row.result?.id === saved.id,
      ),
    ).toBe(true);
    await expect(
      manager.school.transitionExamPlan({ ...planScope, status: "completed" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      teacher.school.upsertExamResult({ ...result, studentId: otherStudentId }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      teacher.school.upsertExamResult({
        ...result,
        marks: { written: 81, practical: 18 },
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      teacher.school.upsertExamResult({ ...result, marks: { written: 65 } }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      teacher.school.upsertExamResult({ ...result, daysAttended: 201 }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      teacher.school.upsertExamResult({
        ...result,
        coScholastics: { unknown: "A" },
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(
      (await assigned.school.upsertExamResult({ ...result, approved: true }))
        .approved,
    ).toBe(true);
    await expect(
      assigned.school.upsertExamResult(result),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: expect.stringContaining("already approved"),
    });
    await expect(
      teacher.school.deleteExamResult({ ...planScope, studentId }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(
      (await manager.school.upsertExamResult({ ...result, approved: false }))
        .approved,
    ).toBe(false);
    await assigned.school.approveExamResult({
      ...planScope,
      studentId,
      approved: true,
    });
    expect(
      (
        await manager.school.transitionExamPlan({
          ...planScope,
          status: "completed",
        })
      ).status,
    ).toBe("completed");
    await expect(manager.school.upsertExamResult(result)).rejects.toMatchObject(
      { code: "BAD_REQUEST" },
    );
    await manager.school.transitionExamPlan({ ...planScope, status: "active" });
    await manager.school.deleteExamResult({ ...planScope, studentId });
    expect(
      await db
        .select()
        .from(examResultTable)
        .where(eq(examResultTable.id, saved.id)),
    ).toHaveLength(0);
    expect(
      (
        await db
          .select()
          .from(examPlanTable)
          .where(eq(examPlanTable.id, plan.id))
      )[0]!.status,
    ).toBe("active");
  });

  it("supports optional timetable CRUD and rejects invalid references and overlaps", async () => {
    expect(await teacher.school.getExamTimetable(scope)).toBeNull();
    const config = {
      columns: [classId],
      rows: [
        {
          id: "slot-1",
          date: "2026-10-20",
          startTime: "09:00",
          endTime: "10:00",
          cells: {
            [classId]: [
              { subjectSlug: "maths", modeSlug: "written" },
              { subjectSlug: "maths", modeSlug: "practical" },
            ],
          },
        },
      ],
    };
    for (const client of [admin, teacher, accountant])
      await expect(
        client.school.saveExamTimetable({ ...scope, config }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(
      (await manager.school.saveExamTimetable({ ...scope, config })).config,
    ).toEqual(config);
    expect((await admin.school.getExamTimetable(scope))!.config).toEqual(
      config,
    );
    await expect(
      manager.school.saveExamTimetable({
        ...scope,
        config: {
          ...config,
          rows: [...config.rows, { ...config.rows[0]!, id: "overlap" }],
        },
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      manager.school.saveExamTimetable({
        ...scope,
        config: {
          ...config,
          rows: [{ ...config.rows[0]!, date: "2026-02-30" }],
        },
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      manager.school.saveExamTimetable({
        ...scope,
        config: {
          ...config,
          rows: [
            {
              ...config.rows[0]!,
              cells: {
                [classId]: { subjectSlug: "invalid", modeSlug: "written" },
              },
            },
          ],
        },
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await manager.school.deleteExamTimetable(scope);
    expect(await manager.school.getExamTimetable(scope)).toBeNull();
  });

  it("deletes unused plans/exams and validates pagination and scope independently", async () => {
    const extra = { ...scope, examSlug: "final" };
    await manager.school.createExam({ ...extra, name: "Final", order: 3 });
    const plan = await manager.school.createExamPlan({
      ...extra,
      classId,
      subjectSlug: "maths",
    });
    expect(plan.totalMarks).toBe(100);
    const planScope = { ...extra, classId, examPlanId: plan.id };
    await expect(manager.school.deleteExam(extra)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    await expect(
      manager.school.getExamPlan({ ...planScope, classId: "wrong" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await manager.school.listExamPlans(extra)).items[0]!.id).toBe(
      plan.id,
    );
    await expect(
      manager.school.listExamPlans({ ...extra, limit: 21 }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await manager.school.deleteExamPlan(planScope);
    await manager.school.deleteExam(extra);
    await expect(manager.school.getExam(extra)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

describe("exam procedure authorization matrix", () => {
  it("every procedure rejects anonymous, unrelated-school and ungranted callers", async () => {
    const school = await createTestSchool();
    const session = await createTestSession({
      schoolId: school.id,
      sessionStartYear: 2040,
      sessionEndYear: 2041,
      isActive: true,
    });
    const scope = {
      schoolId: school.id,
      sessionId: session.id,
      examSlug: "final",
    };
    const planScope = { ...scope, classId: "class-1", examPlanId: "plan-1" };
    const callers = [
      { client: createTestClient(null), code: "UNAUTHORIZED" },
      {
        client: createTestClient(await createRegularUserSession()),
        code: "FORBIDDEN",
      },
      {
        client: createTestClient(
          (
            await createSchoolStaffSession((await createTestSchool()).id, [
              { role: "manager" },
            ])
          ).session,
        ),
        code: "FORBIDDEN",
      },
    ];
    function operations(client: ReturnType<typeof createTestClient>) {
      return [
        () => client.school.listExams(scope),
        () => client.school.getExam(scope),
        () => client.school.getExamContext(scope),
        () => client.school.createExam({ ...scope, name: "Final", order: 1 }),
        () => client.school.updateExam({ ...scope, name: "Final", order: 1 }),
        () => client.school.deleteExam(scope),
        () => client.school.listExamPlans(scope),
        () => client.school.getExamPlan(planScope),
        () =>
          client.school.createExamPlan({
            ...scope,
            classId: "class-1",
            subjectSlug: "maths",
            totalMarks: 100,
          }),
        () => client.school.updateExamPlan({ ...planScope, totalMarks: 100 }),
        () => client.school.deleteExamPlan(planScope),
        () =>
          client.school.transitionExamPlan({
            ...planScope,
            status: "approved",
          }),
        () => client.school.listExamResults(planScope),
        () => client.school.listExamRoster(planScope),
        () =>
          client.school.getExamResult({ ...planScope, studentId: "student-1" }),
        () =>
          client.school.upsertExamResult({
            ...planScope,
            studentId: "student-1",
            marks: { written: 1 },
            approved: true,
          }),
        () =>
          client.school.upsertExamResults({
            ...planScope,
            results: [
              {
                studentId: "student-1",
                marks: { written: 1 },
                approved: false,
              },
            ],
          }),
        () =>
          client.school.approveExamResult({
            ...planScope,
            studentId: "student-1",
            approved: true,
          }),
        () =>
          client.school.deleteExamResult({
            ...planScope,
            studentId: "student-1",
          }),
        () => client.school.getExamTimetable(scope),
        () =>
          client.school.saveExamTimetable({
            ...scope,
            config: { columns: [], rows: [] },
          }),
        () => client.school.deleteExamTimetable(scope),
      ];
    }
    for (const { client, code } of callers)
      for (const operation of operations(client))
        await expect(operation()).rejects.toMatchObject({ code });
  });
});
