import { db } from "@campuspilot/db";
import {
  examLifecycleTable,
  examPlanTable,
} from "@campuspilot/db/schema/exam";
import { financeLedgerEntryTable } from "@campuspilot/db/schema/finance";
import { schoolSessionTable } from "@campuspilot/db/schema/session";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";

import {
  createRegularUserSession,
  createSchoolStaffSession,
  createTestAdmission,
  createTestClass,
  createTestClient,
  createTestSchool,
  createTestSession,
  createTestStudent,
} from "../../../../test/fixtures";

describe("school.getDashboard integration", () => {
  let schoolId: string;
  let sessionId: string;
  let firstClassId: string;
  let secondClassId: string;
  let principal: ReturnType<typeof createTestClient>;
  let manager: ReturnType<typeof createTestClient>;
  let teacher: ReturnType<typeof createTestClient>;
  let accountant: ReturnType<typeof createTestClient>;
  let examCoordinator: ReturnType<typeof createTestClient>;

  beforeEach(async () => {
    const school = await createTestSchool();
    schoolId = school.id;
    const session = await createTestSession({
      schoolId,
      sessionStartYear: 2026,
      sessionEndYear: 2027,
      isActive: true,
    });
    sessionId = session.id;
    const firstClass = await createTestClass({
      schoolId,
      label: "Grade 6",
      sections: [
        { slug: "a", label: "A" },
        { slug: "b", label: "B" },
      ],
    });
    const secondClass = await createTestClass({
      schoolId,
      label: "Grade 7",
    });
    firstClassId = firstClass.schoolClass.id;
    secondClassId = secondClass.schoolClass.id;

    const firstAdmission = await createTestAdmission({
      schoolId,
      admissionClassId: firstClassId,
    });
    const secondAdmission = await createTestAdmission({
      schoolId,
      admissionClassId: secondClassId,
    });
    await createTestAdmission({
      schoolId,
      registered: false,
    });
    await createTestAdmission({ schoolId });
    await createTestStudent({
      schoolId,
      sessionId,
      admissionId: firstAdmission.id,
      classId: firstClassId,
      sectionId: firstClass.sections[0]!.id,
    });
    await createTestStudent({
      schoolId,
      sessionId,
      admissionId: secondAdmission.id,
      classId: secondClassId,
      sectionId: secondClass.sections[0]!.id,
    });

    const principalStaff = await createSchoolStaffSession(schoolId, [
      { role: "principal" },
    ]);
    principal = createTestClient(principalStaff.session);
    manager = createTestClient(
      (await createSchoolStaffSession(schoolId, [{ role: "manager" }])).session,
    );
    teacher = createTestClient(
      (
        await createSchoolStaffSession(schoolId, [
          { role: "teacher", meta: { classIds: [firstClassId] } },
        ])
      ).session,
    );
    accountant = createTestClient(
      (await createSchoolStaffSession(schoolId, [{ role: "accountant" }]))
        .session,
    );
    examCoordinator = createTestClient(
      (
        await createSchoolStaffSession(schoolId, [
          { role: "exam_coordinator" },
        ])
      ).session,
    );

    await db
      .update(schoolSessionTable)
      .set({
        sessionConfig: {
          examConfig: {
            half_yearly: { name: "Half Yearly", order: 1 },
          },
          coScholasticAreas: {},
          gradingScale: {},
          attendanceTracking: { enabled: false },
        },
        financeConfig: {
          recurring: "monthly",
          currency: "INR",
          timeZone: "Asia/Kolkata",
          cycleStartMonth: 4,
          elements: {},
        },
      })
      .where(eq(schoolSessionTable.id, sessionId));
    await db.insert(examPlanTable).values([
      {
        schoolId,
        sessionId,
        examSlug: "half_yearly",
        classId: firstClassId,
        subjectSlug: "mathematics",
        totalMarks: 100,
        modeConfig: { written: { percentage: 100, maxMarks: 100 } },
        status: "active",
      },
      {
        schoolId,
        sessionId,
        examSlug: "half_yearly",
        classId: secondClassId,
        subjectSlug: "english",
        totalMarks: 100,
        modeConfig: { written: { percentage: 100, maxMarks: 100 } },
        status: "active",
      },
    ]);
    await db.insert(examLifecycleTable).values({
      schoolId,
      sessionId,
      examSlug: "half_yearly",
      status: "active",
      startedAt: new Date("2026-08-01T00:00:00.000Z"),
    });
    await db.insert(financeLedgerEntryTable).values([
      {
        schoolId,
        sessionId,
        admissionId: firstAdmission.id,
        sequence: BigInt(1),
        type: "bill",
        direction: "debit",
        amountMinor: BigInt(100_000),
        currency: "INR",
        effectiveAt: new Date("2026-07-01T00:00:00.000Z"),
        recordedBy: principalStaff.user.id,
        idempotencyKey: randomUUID(),
      },
      {
        schoolId,
        sessionId,
        admissionId: firstAdmission.id,
        sequence: BigInt(2),
        type: "payment",
        direction: "credit",
        amountMinor: BigInt(70_000),
        currency: "INR",
        effectiveAt: new Date("2026-07-15T00:00:00.000Z"),
        recordedBy: principalStaff.user.id,
        idempotencyKey: randomUUID(),
      },
      {
        schoolId,
        sessionId,
        admissionId: firstAdmission.id,
        sequence: BigInt(3),
        type: "refund",
        direction: "debit",
        amountMinor: BigInt(5_000),
        currency: "INR",
        effectiveAt: new Date("2026-08-01T00:00:00.000Z"),
        recordedBy: principalStaff.user.id,
        idempotencyKey: randomUUID(),
      },
    ]);
  });

  it("rejects anonymous, unassigned, and cross-school callers", async () => {
    await expect(
      createTestClient(null).school.getDashboard({ schoolId, sessionId }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(
      createTestClient(await createRegularUserSession()).school.getDashboard({
        schoolId,
        sessionId,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const otherSchool = await createTestSchool();
    const outsider = createTestClient(
      (
        await createSchoolStaffSession(otherSchool.id, [{ role: "manager" }])
      ).session,
    );
    await expect(
      outsider.school.getDashboard({ schoolId, sessionId }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("returns all independently authorized school-wide sections and exact totals", async () => {
    const result = await principal.school.getDashboard({ schoolId, sessionId });

    expect(result.actions).toEqual({
      createAdmission: true,
      recordPayment: true,
      enterResults: true,
      createNotice: false,
    });
    expect(result.admissions).toMatchObject({
      total: 4,
      registered: 3,
      unregistered: 1,
      unassigned: 1,
    });
    expect(result.classrooms).toMatchObject({
      scope: "school",
      classCount: 2,
      sectionCount: 3,
      studentCount: 2,
    });
    expect(result.examinations).toMatchObject({
      scope: "school",
      configured: 1,
      active: 1,
      exams: [
        {
          slug: "half_yearly",
          status: "active",
          planCount: 2,
          classCount: 2,
        },
      ],
    });
    expect(result.billing).toMatchObject({
      primaryCurrency: "INR",
      currencies: [
        {
          currency: "INR",
          billedMinor: "100000",
          paymentMinor: "70000",
          refundMinor: "5000",
          netCashMinor: "65000",
          dueMinor: "35000",
          billedAdmissions: 1,
        },
      ],
    });
    expect(result.billing?.currencies[0]?.monthly).toEqual([
      {
        month: "2026-07",
        billedMinor: "100000",
        paymentMinor: "70000",
        refundMinor: "0",
        netCashMinor: "70000",
      },
      {
        month: "2026-08",
        billedMinor: "0",
        paymentMinor: "0",
        refundMinor: "5000",
        netCashMinor: "-5000",
      },
    ]);
    await expect(
      manager.school.getDashboard({ schoolId, sessionId }),
    ).resolves.toMatchObject({
      admissions: { total: 4 },
      classrooms: { scope: "school", studentCount: 2 },
      billing: { primaryCurrency: "INR" },
      examinations: { scope: "school", active: 1 },
      actions: {
        createAdmission: true,
        recordPayment: true,
        enterResults: true,
      },
    });
  });

  it("contracts a teacher-only dashboard to assigned classrooms and removes finance", async () => {
    const result = await teacher.school.getDashboard({ schoolId, sessionId });

    expect(result.billing).toBeNull();
    expect(result.classrooms).toMatchObject({
      scope: "assigned",
      classCount: 1,
      sectionCount: 2,
      studentCount: 1,
      classes: [{ id: firstClassId, label: "Grade 6" }],
    });
    expect(result.examinations).toMatchObject({
      scope: "assigned",
      exams: [{ planCount: 1, classCount: 1 }],
    });
    expect(result.actions).toEqual({
      createAdmission: false,
      recordPayment: false,
      enterResults: true,
      createNotice: false,
    });
  });

  it("composes finance and examination responsibilities independently", async () => {
    const finance = await accountant.school.getDashboard({ schoolId, sessionId });
    expect(finance.billing).not.toBeNull();
    expect(finance.examinations).not.toBeNull();
    expect(finance.actions).toEqual({
      createAdmission: false,
      recordPayment: true,
      enterResults: false,
      createNotice: false,
    });

    const examinations = await examCoordinator.school.getDashboard({
      schoolId,
      sessionId,
    });
    expect(examinations.billing).toBeNull();
    expect(examinations.examinations?.scope).toBe("school");
    expect(examinations.actions.enterResults).toBe(true);

    const combined = createTestClient(
      (
        await createSchoolStaffSession(schoolId, [
          { role: "teacher", meta: { classIds: [firstClassId] } },
          { role: "accountant" },
        ])
      ).session,
    );
    await expect(
      combined.school.getDashboard({ schoolId, sessionId }),
    ).resolves.toMatchObject({
      classrooms: { scope: "school", classCount: 2 },
      billing: { primaryCurrency: "INR" },
      actions: { recordPayment: true, enterResults: true },
    });
  });

  it("rejects malformed input and does not accept a session from another school", async () => {
    await expect(
      principal.school.getDashboard({ schoolId: "", sessionId }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const otherSchool = await createTestSchool();
    const otherSession = await createTestSession({
      schoolId: otherSchool.id,
      sessionStartYear: 2026,
      sessionEndYear: 2027,
    });
    await expect(
      principal.school.getDashboard({ schoolId, sessionId: otherSession.id }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
