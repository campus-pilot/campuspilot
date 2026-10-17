import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@campuspilot/db";
import { classTable } from "@campuspilot/db/schema/class";
import { schoolSessionTable } from "@campuspilot/db/schema/session";
import {
  examPlanTable,
  examResultTable,
  examAssessmentSettingsTable,
  examStudentAssessmentTable,
  examTimetableTable,
  examLifecycleTable,
} from "@campuspilot/db/schema/exam";
import { DEFAULT_REPORT_SECTIONS } from "@campuspilot/db/schema/jsonb/document-config";
import { and, eq } from "drizzle-orm";
import {
  createTestSchool,
  createTestSession,
  createTestClass,
  createTestStudent,
  createTestAdmission,
  createSchoolStaffSession,
  createTestClient,
} from "../../../../test/fixtures";
import {
  buildDocumentContexts,
  documentScheduleSlot,
} from "./document.context";
import { documentSourceSchema } from "./document.dto";
import {
  renderDocument,
  combineDocuments,
  convertDocumentPdf,
} from "./document.render";
import {
  DOCUMENT_MARKETPLACE,
  SAMPLE_DOCUMENT_CONTEXT,
} from "./document.catalog";
import { PDFDocument } from "pdf-lib";

/** Real data covers both class and school-wide export, including independent
 * lifecycle, marks approval, shared assessment approval, and display choices.
 */
describe("examination document parity", () => {
  let schoolId: string,
    sessionId: string,
    classId: string,
    secondClassId: string,
    firstStudent: string,
    secondStudent: string,
    pendingStudent: string;
  let manager: ReturnType<typeof createTestClient>;
  beforeAll(async () => {
    schoolId = (await createTestSchool({ name: "Parity School" })).id;
    sessionId = (
      await createTestSession({
        schoolId,
        sessionStartYear: 2026,
        sessionEndYear: 2027,
      })
    ).id;
    manager = createTestClient(
      (await createSchoolStaffSession(schoolId, [{ role: "manager" }])).session,
    );
    await db
      .update(schoolSessionTable)
      .set({
        sessionConfig: {
          examConfig: { final: { name: "Final examination", order: 2 } },
          attendanceTracking: { enabled: true },
          coScholasticAreas: { art: { name: "Art & Craft" } },
          gradingScale: {
            b: { label: "B", minScore: 0 },
            a: { label: "A", minScore: 80 },
          },
        },
      })
      .where(eq(schoolSessionTable.id, sessionId));
    classId = (await createTestClass({ schoolId, label: "Grade 8" }))
      .schoolClass.id;
    secondClassId = (await createTestClass({ schoolId, label: "Grade 9" }))
      .schoolClass.id;
    const student = async (c: string, name: string) =>
      (
        await createTestStudent({
          schoolId,
          sessionId,
          classId: c,
          admissionId: (await createTestAdmission({ schoolId, name })).id,
        })
      ).id;
    firstStudent = await student(classId, "Zero Attendance");
    secondStudent = await student(secondClassId, "Second Class");
    pendingStudent = await student(classId, "Pending Student");
    for (const c of [classId, secondClassId]) {
      await db
        .update(classTable)
        .set({
          config: {
            subjects: {
              math: {
                name: "Mathematics",
                books: [],
                examModes: {
                  written: { name: "Written", percentage: 80 },
                  oral: { name: "Oral", percentage: 20 },
                },
              },
              english: {
                name: "English",
                books: [],
                examModes: { written: { name: "Written", percentage: 100 } },
              },
            },
          },
        })
        .where(eq(classTable.id, c));
      for (const subjectSlug of ["math", "english"]) {
        const [plan] = await db
          .insert(examPlanTable)
          .values({
            schoolId,
            sessionId,
            classId: c,
            examSlug: "final",
            subjectSlug,
            totalMarks: 100,
            modeConfig:
              subjectSlug === "math"
                ? {
                    written: { maxMarks: 80, percentage: 80 },
                    oral: { maxMarks: 20, percentage: 20 },
                  }
                : { written: { maxMarks: 100, percentage: 100 } },
            status: "active",
            totalWorkingDays: 999,
          })
          .returning();
        for (const studentId of c === classId
          ? [firstStudent, pendingStudent]
          : [secondStudent])
          await db.insert(examResultTable).values({
            schoolId,
            sessionId,
            examPlanId: plan!.id,
            studentId,
            marks:
              subjectSlug === "math"
                ? { written: 70, oral: 18 }
                : { written: 90 },
            approved: studentId !== pendingStudent,
            daysAttended: 999,
            coScholastics: { art: "LEGACY" },
          });
      }
    }
    await db
      .insert(examAssessmentSettingsTable)
      .values({ schoolId, sessionId, examSlug: "final", totalWorkingDays: 90 });
    await db.insert(examStudentAssessmentTable).values(
      [firstStudent, secondStudent].map((studentId) => ({
        schoolId,
        sessionId,
        examSlug: "final",
        studentId,
        daysAttended: studentId === firstStudent ? 0 : 82,
        coScholastics: { art: "A" },
        approved: true,
      })),
    );
    await db
      .insert(examLifecycleTable)
      .values({ schoolId, sessionId, examSlug: "final", status: "active" });
    await db.insert(examTimetableTable).values({
      schoolId,
      sessionId,
      examSlug: "final",
      config: {
        columns: [classId, secondClassId],
        rows: [
          {
            id: "slot",
            date: "2026-10-20",
            startTime: "09:00",
            endTime: "12:00",
            cells: {
              [classId]: [
                { subjectSlug: "math", modeSlug: "written" },
                { subjectSlug: "math", modeSlug: "oral" },
              ],
              [secondClassId]: null,
            },
          },
        ],
      },
    });
  });
  const source = (overrides: Record<string, unknown> = {}) =>
    documentSourceSchema.parse({
      documentType: "report_card",
      sessionId,
      examSlug: "final",
      resultPolicy: "approved_only",
      ...overrides,
    });
  it("aggregates every old result field from the correct new records, with zero distinct from missing", async () => {
    const result = await buildDocumentContexts(
      db,
      schoolId,
      source({ classId, studentIds: [firstStudent] }),
    );
    expect(result.studentIds).toEqual([firstStudent]);
    expect(result.contexts[0]).toMatchObject({
      attendanceEnabled: true,
      assessmentApproved: true,
      attendance: { daysAttended: 0, totalWorkingDays: 90, percentage: 0 },
      coScholastics: { art: { areaName: "Art & Craft", grade: "A" } },
      coScholasticAreas: { art: { name: "Art & Craft" } },
      grandTotal: 178,
      grandMaxMarks: 200,
      overallPercentage: 89,
      overallGrade: "A",
      reportSections: DEFAULT_REPORT_SECTIONS,
    });
    const context = result.contexts[0] as {
      gradingScale: Record<string, unknown>;
      subjects: { name: string; modeConfig: unknown }[];
    };
    expect(Object.keys(context.gradingScale)).toEqual(["a", "b"]);
    expect(context.subjects).toHaveLength(2);
    expect(
      context.subjects.find((subject) => subject.name === "Mathematics")!
        .modeConfig,
    ).toMatchObject({ oral: { name: "Oral", maxMarks: 20 } });
  });
  it("supports school-wide approved batches and reports explicit exclusions", async () => {
    const result = await buildDocumentContexts(db, schoolId, source());
    expect(result.studentIds).toEqual([firstStudent, secondStudent]);
    expect(result.warnings).toEqual([
      expect.stringContaining("1 student was excluded"),
    ]);
    await expect(
      buildDocumentContexts(
        db,
        schoolId,
        source({ resultPolicy: "require_all" }),
      ),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      buildDocumentContexts(
        db,
        schoolId,
        source({ classId, studentIds: [pendingStudent] }),
      ),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      buildDocumentContexts(
        db,
        schoolId,
        source({ classId, studentIds: [secondStudent] }),
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      buildDocumentContexts(
        db,
        schoolId,
        source({ studentIds: [firstStudent] }),
      ),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
  it("never promotes legacy subject values into an unapproved shared assessment", async () => {
    await db
      .update(examStudentAssessmentTable)
      .set({ approved: false })
      .where(eq(examStudentAssessmentTable.studentId, firstStudent));
    try {
      await expect(
        buildDocumentContexts(
          db,
          schoolId,
          source({ classId, studentIds: [firstStudent] }),
        ),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      const result = await buildDocumentContexts(
        db,
        schoolId,
        source({
          classId,
          studentIds: [firstStudent],
          reportSections: {
            ...DEFAULT_REPORT_SECTIONS,
            includeAttendance: false,
            includeCoScholastics: false,
          },
        }),
      );
      expect(result.contexts[0]).toMatchObject({
        attendance: null,
        coScholastics: null,
        assessmentApproved: false,
      });
    } finally {
      await db
        .update(examStudentAssessmentTable)
        .set({ approved: true })
        .where(eq(examStudentAssessmentTable.studentId, firstStudent));
    }
  });
  it("does not require working-day configuration when attendance printing is disabled", async () => {
    await db
      .update(examAssessmentSettingsTable)
      .set({ totalWorkingDays: null })
      .where(eq(examAssessmentSettingsTable.schoolId, schoolId));
    try {
      await expect(
        buildDocumentContexts(
          db,
          schoolId,
          source({ classId, studentIds: [firstStudent] }),
        ),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      const result = await buildDocumentContexts(
        db,
        schoolId,
        source({
          classId,
          studentIds: [firstStudent],
          reportSections: {
            ...DEFAULT_REPORT_SECTIONS,
            includeAttendance: false,
          },
        }),
      );
      expect(result.contexts[0]).toMatchObject({ attendance: null });
    } finally {
      await db
        .update(examAssessmentSettingsTable)
        .set({ totalWorkingDays: 100 })
        .where(eq(examAssessmentSettingsTable.schoolId, schoolId));
    }
  });
  it("preserves calendar dates, weekdays, multi-subject cells and null cells for v1 templates", async () => {
    const result = await buildDocumentContexts(
      db,
      schoolId,
      documentSourceSchema.parse({
        documentType: "timetable",
        sessionId,
        examSlug: "final",
      }),
    );
    const context = result.contexts[0] as {
      rows: { dayOfWeek: string; cells: Record<string, unknown> }[];
    };
    expect(context.rows[0]).toMatchObject({
      date: "2026-10-20",
      displayDate: "20 Oct 2026",
      dayOfWeek: "Tuesday",
      displayStartTime: "9:00 AM",
      displayEndTime: "12:00 PM",
    });
    expect(context.rows[0]!.cells[classId]).toHaveLength(2);
    expect(context.rows[0]!.cells[secondClassId]).toBeNull();
    const html = renderDocument(
      '<table><tr><td colspan="{{add columns.length 2}}">{{#each rows}}{{dayOfWeek}}:{{#each ../columns}}{{#with (lookup ../cells classId)}}{{#each this}}{{subjectName}}/{{modeName}};{{/each}}{{else}}Empty{{/with}}{{/each}}{{/each}}</td></tr></table>',
      context,
    );
    expect(html).toContain('colspan="4"');
    expect(html).toContain("Mathematics/Oral");
    expect(html).toContain("Empty");
    expect(
      documentScheduleSlot({
        date: "2026-01-01",
        startTime: "00:05",
        endTime: "13:10",
      }),
    ).toMatchObject({
      dayOfWeek: "Thursday",
      displayStartTime: "12:05 AM",
      displayEndTime: "1:10 PM",
    });
  });
  it("renders flags through the API and stores source choices with immutable PDFs", async () => {
    const template = await manager.school.selectMarketplaceTemplate({
      schoolId,
      documentType: "report_card",
      slug: "report_card-modern",
      expectedRevisionId: null,
    });
    const sections = {
      ...DEFAULT_REPORT_SECTIONS,
      includeAttendance: false,
      includeCoScholastics: false,
      includeGradingScale: false,
    };
    const input = {
      schoolId,
      templateRevisionId: template.artifact.id,
      source: {
        documentType: "report_card" as const,
        sessionId,
        examSlug: "final",
        resultPolicy: "approved_only" as const,
        reportSections: sections,
      },
    };
    const preview = await manager.school.previewDocument(input);
    expect(preview.studentCount).toBe(2);
    expect(preview.html).toContain("Written");
    expect(preview.html).toContain("Oral");
    expect(preview.html).not.toContain("Attendance</h3>");
    expect(preview.html).not.toContain("Co-scholastic areas</h3>");
    const generated = await manager.school.generateDocument(input);
    expect(generated.artifact.studentIds).toEqual([
      firstStudent,
      secondStudent,
    ]);
    expect(generated.artifact.classId).toBeNull();
    expect(generated.artifact.generationOptions).toEqual({
      reportSections: sections,
      resultPolicy: "approved_only",
    });
    const history = await manager.school.listDocumentArtifacts({
      schoolId,
      filters: { examSlug: "final" },
    });
    expect(history.items[0]!.generationOptions).toEqual(
      generated.artifact.generationOptions,
    );
    await expect(
      manager.school.previewDocument({
        ...input,
        source: {
          ...input.source,
          reportSections: { includeAttendance: "yes" as unknown as boolean },
        },
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
  it("fits a full six-subject report with shared assessments and signatures on A4", async () => {
    const context = {
      ...SAMPLE_DOCUMENT_CONTEXT,
      subjects: Array.from({ length: 6 }, (_, index) => ({
        ...SAMPLE_DOCUMENT_CONTEXT.subjects[0],
        slug: `subject-${index}`,
        name: [
          "Mathematics",
          "English",
          "Science",
          "Social Studies",
          "Hindi",
          "Computer Science",
        ][index],
        marks: { written: 70, oral: 18 },
        modeConfig: {
          written: { name: "Written", percentage: 80, maxMarks: 80 },
          oral: { name: "Oral", percentage: 20, maxMarks: 20 },
        },
      })),
    };
    for (const slug of ["report_card-modern", "report_card-classic"]) {
      const template = DOCUMENT_MARKETPLACE.find((item) => item.slug === slug)!;
      const html = combineDocuments(
        [renderDocument(template.content, context)],
        "report_card",
      );
      const pdf = await PDFDocument.load(
        await convertDocumentPdf(html, "report_card"),
      );
      expect(pdf.getPageCount(), slug).toBe(1);
      expect(pdf.getPage(0).getWidth()).toBeCloseTo(595, 0);
      expect(pdf.getPage(0).getHeight()).toBeCloseTo(842, 0);
    }
  });
  it("enforces the explicit examination lifecycle independently of plan status", async () => {
    await db
      .update(examLifecycleTable)
      .set({ status: "ready" })
      .where(
        and(
          eq(examLifecycleTable.schoolId, schoolId),
          eq(examLifecycleTable.examSlug, "final"),
        ),
      );
    try {
      await expect(
        buildDocumentContexts(db, schoolId, source()),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    } finally {
      await db
        .update(examLifecycleTable)
        .set({ status: "active" })
        .where(eq(examLifecycleTable.schoolId, schoolId));
    }
  });
});
