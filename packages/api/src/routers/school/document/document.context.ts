import type { DatabaseExecutor } from "@campuspilot/db";
import { formatPhoneNumberForDisplay } from "@campuspilot/db/phone";
import { admissionTable } from "@campuspilot/db/schema/admission";
import { classTable, sectionTable } from "@campuspilot/db/schema/class";
import {
  examClassTable,
  examPlanTable,
  examAssessmentSettingsTable,
  examStudentAssessmentTable,
  examLifecycleTable,
  examResultTable,
  examTimetableTable,
} from "@campuspilot/db/schema/exam";
import { schoolTable } from "@campuspilot/db/schema/school";
import { schoolSessionTable } from "@campuspilot/db/schema/session";
import { studentTable } from "@campuspilot/db/schema/student";
import { sessionConfigSchema, type SessionConfig } from "@campuspilot/db/schema/jsonb/session-config";
import { and, asc, eq, inArray } from "drizzle-orm";
import { rpcError } from "../../../errors";
import { MAX_DOCUMENT_SOURCE_ITEMS, type DocumentSource } from "./document.dto";
import { documentImage } from "./document.storage";
import { documentImageRef, type DocumentImageRef } from "./document.images";
import { withReportModeLayout } from "./document.report-modes";
import { gradeLabel, scorePercent } from "../exam/exam-scoring";
import { shareableAttendance, shareableCoScholastics } from "../exam/exam-assessment-rules";

/** Report cards print "—" where no grade applies; the rule itself is shared with the Cadet Portal. */
export function documentGrade(
  percentage: number,
  scale: Record<string, { label: string; minScore: number }>,
) {
  return gradeLabel(percentage, scale) ?? "—";
}
const percent = scorePercent;

/** Calendar dates and local school times never pass through the host timezone. */
export function documentScheduleSlot(row: {
  date: string;
  startTime: string;
  endTime: string;
}) {
  const date = new Date(`${row.date}T00:00:00.000Z`);
  const formatTime = (time: string) => {
    const [hour, minute] = time.split(":").map(Number);
    return `${hour! % 12 || 12}:${String(minute).padStart(2, "0")} ${hour! < 12 ? "AM" : "PM"}`;
  };
  return {
    date: row.date,
    displayDate: new Intl.DateTimeFormat("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    }).format(date),
    dayOfWeek: new Intl.DateTimeFormat("en-IN", {
      weekday: "long",
      timeZone: "UTC",
    }).format(date),
    startTime: row.startTime,
    endTime: row.endTime,
    displayStartTime: formatTime(row.startTime),
    displayEndTime: formatTime(row.endTime),
  };
}

/**
 * How a context builder hands images to the renderer (`document.images.ts`):
 * - `embed` (the default): `data:` URIs read now, as every caller outside
 *   generation jobs and previews expects (notifications, the Cadet Portal
 *   timetable, tests);
 * - `reference`: a {@link DocumentImageRef} per image and no image read at
 *   all. Previews resolve the references of their sample only; a generation
 *   job resolves them per batch into conversion assets.
 */
export type DocumentImageMode = "embed" | "reference";

/** Options every document context builder accepts. */
export type DocumentContextOptions = {
  images?: DocumentImageMode;
  /**
   * The instant every document prints as `generatedAt`. A generation job
   * passes the moment its request was accepted, so a retried or resumed
   * job prints the same value; otherwise it is now.
   */
  generatedAt?: Date;
};

type SchoolIdentity = {
  name: string;
  location: string | null;
  registrationNo: string | null;
  logoS3Key: string | null;
};

/**
 * The `school` block every document context carries: public identity facts
 * and the logo embedded as a data URI (null without a logo). The one builder
 * for academic, finance and notice documents, so the block cannot drift
 * between them.
 */
export async function buildSchoolDocumentContext(school: SchoolIdentity) {
  return {
    name: school.name,
    location: school.location,
    registrationNo: school.registrationNo,
    logoUrl: await documentImage(school.logoS3Key),
  };
}

/**
 * The same `school` block for a builder in `images` mode: embedded as
 * {@link buildSchoolDocumentContext} does, or with the logo as a reference.
 */
export async function schoolDocumentContextFor(
  school: SchoolIdentity,
  images: DocumentImageMode = "embed",
): Promise<{
  name: string;
  location: string | null;
  registrationNo: string | null;
  logoUrl: string | DocumentImageRef | null;
}> {
  if (images === "embed") return buildSchoolDocumentContext(school);
  return {
    name: school.name,
    location: school.location,
    registrationNo: school.registrationNo,
    logoUrl: documentImageRef(school.logoS3Key),
  };
}

type SchoolClassRow = typeof classTable.$inferSelect;
type TimetableRow = NonNullable<(typeof examTimetableTable.$inferSelect)["config"]>["rows"][number];

/** A timetable's slots in print order: date, then start time, then id. */
export function sortedTimetableRows(rows: readonly TimetableRow[]): TimetableRow[] {
  return [...rows].sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      a.startTime.localeCompare(b.startTime) ||
      a.id.localeCompare(b.id),
  );
}

/**
 * The subjects one timetable slot schedules for one class, resolved to their
 * configured names. A subject or mode that is no longer configured is a
 * BAD_REQUEST (the timetable must be updated first). Shared by generation
 * and template previews.
 */
export function timetableCellSubjects(
  row: TimetableRow,
  classId: string,
  classMap: ReadonlyMap<string, Pick<SchoolClassRow, "config">>,
) {
  const cell = row.cells[classId];
  return (cell ? (Array.isArray(cell) ? cell : [cell]) : []).map((entry) => {
    const subject = classMap.get(classId)?.config.subjects[entry.subjectSlug];
    if (!subject?.examModes[entry.modeSlug])
      throw rpcError.badRequest(
        "A timetable subject or mode is no longer configured. Update the timetable first.",
      );
    return {
      ...entry,
      subjectName: subject.name,
      modeName: subject.examModes[entry.modeSlug]!.name,
    };
  });
}

/** The `exam` block of an examination document: its definition plus its lifecycle facts (null when unknown). */
export function examDocumentContext(
  exam: { slug: string; name: string; order: number },
  lifecycle: Pick<typeof examLifecycleTable.$inferSelect, "status" | "startedAt" | "completedAt"> | undefined,
) {
  return {
    ...exam,
    status: lifecycle?.status ?? null,
    startedAt: lifecycle?.startedAt?.toISOString() ?? null,
    completedAt: lifecycle?.completedAt?.toISOString() ?? null,
  };
}

/**
 * The `student` block of a student document. The one builder for generation
 * and template previews, so the block cannot drift between them. The photo
 * is passed in as the caller's image mode produced it.
 */
export function studentDocumentIdentity(
  row: {
    admission: Pick<
      typeof admissionTable.$inferSelect,
      "name" | "admissionNo" | "dob" | "fatherName" | "motherName" | "address" | "phoneNo" | "whatsappNo"
    >;
    student: Pick<typeof studentTable.$inferSelect, "rollNo">;
    className: string;
    sectionName: string | null;
  },
  photoUrl: string | DocumentImageRef | null,
) {
  const { admission, student } = row;
  return {
    name: admission.name,
    admissionNo: admission.admissionNo,
    dob: admission.dob,
    fatherName: admission.fatherName,
    motherName: admission.motherName,
    address: admission.address,
    // Display form (`+91 98765 43210`); an unmigrated value is shown as stored.
    phoneNo: formatPhoneNumberForDisplay(admission.phoneNo),
    whatsappNo: admission.whatsappNo === null ? null : formatPhoneNumberForDisplay(admission.whatsappNo),
    className: row.className,
    sectionName: row.sectionName,
    rollNo: student.rollNo?.toString() ?? null,
    photoUrl,
  };
}

/** Whether a result's marks are exactly the plan's modes, each within its maximum. */
export function resultMarksMatchPlan(
  marks: Readonly<Record<string, number>>,
  modeConfig: Readonly<Record<string, { maxMarks: number }>>,
) {
  return (
    Object.entries(modeConfig).every(
      ([slug, mode]) => Object.hasOwn(marks, slug) && marks[slug]! <= mode.maxMarks,
    ) && Object.keys(marks).every((slug) => Object.hasOwn(modeConfig, slug))
  );
}

/**
 * One subject of a report card from its plan and the student's marks. It
 * checks nothing: generation validates the result against the plan first,
 * and a template preview passes marks it made to fit the plan.
 */
export function reportCardSubject(input: {
  plan: Pick<typeof examPlanTable.$inferSelect, "subjectSlug" | "totalMarks" | "modeConfig" | "totalWorkingDays">;
  subject: { name: string; examModes: Record<string, { name: string }> };
  result: Pick<typeof examResultTable.$inferSelect, "marks" | "daysAttended" | "coScholastics">;
  config: Pick<SessionConfig, "gradingScale" | "coScholasticAreas">;
}) {
  const { plan, subject, result, config } = input;
  const total = Object.values(result.marks).reduce((sum, mark) => sum + mark, 0);
  const percentage = percent(total, plan.totalMarks);
  return {
    slug: plan.subjectSlug,
    name: subject.name,
    totalMarks: plan.totalMarks,
    marks: result.marks,
    modeConfig: Object.fromEntries(
      Object.entries(plan.modeConfig).map(([slug, mode]) => [
        slug,
        { ...mode, name: subject.examModes[slug]?.name ?? slug },
      ]),
    ),
    total,
    percentage,
    grade: documentGrade(percentage, config.gradingScale),
    attendance:
      result.daysAttended !== null && plan.totalWorkingDays !== null
        ? {
            daysAttended: result.daysAttended,
            totalWorkingDays: plan.totalWorkingDays,
            percentage: percent(result.daysAttended, plan.totalWorkingDays),
          }
        : null,
    coScholastics: result.coScholastics
      ? Object.fromEntries(
          Object.entries(result.coScholastics).map(([slug, grade]) => [
            slug,
            { areaName: config.coScholasticAreas[slug]?.name ?? slug, grade },
          ]),
        )
      : null,
  };
}

/** A report card's totals over its subjects, graded with the session's scale. */
export function reportCardTotals(
  subjects: ReadonlyArray<{ total: number; totalMarks: number }>,
  gradingScale: SessionConfig["gradingScale"],
) {
  const grandTotal = subjects.reduce((sum, s) => sum + s.total, 0);
  const grandMaxMarks = subjects.reduce((sum, s) => sum + s.totalMarks, 0);
  const overallPercentage = percent(grandTotal, grandMaxMarks);
  return { grandTotal, grandMaxMarks, overallPercentage, overallGrade: documentGrade(overallPercentage, gradingScale) };
}

/** The session's grading scale as report cards print it: highest threshold first. */
export function documentGradingScale(gradingScale: SessionConfig["gradingScale"]) {
  return Object.fromEntries(Object.entries(gradingScale).sort(([, a], [, b]) => b.minScore - a.minScore));
}

/** Called inside a repeatable-read transaction. Every relationship is checked
 * independently, including historical sessions and explicit student selections.
 * Missing/unapproved marks are errors rather than fabricated zero scores.
 */
export async function buildDocumentContexts(
  db: DatabaseExecutor,
  schoolId: string,
  source: DocumentSource,
  options: DocumentContextOptions = {},
) {
  const images = options.images ?? "embed";
  if (source.documentType === "bill" || source.documentType === "receipt" || source.documentType === "statement" || source.documentType === "bill_due") {
    throw rpcError.badRequest("Finance documents use the immutable finance context builder.");
  }
  const [school] = await db
    .select()
    .from(schoolTable)
    .where(eq(schoolTable.id, schoolId))
    .limit(1);
  if (!school) throw rpcError.notFound("School");
  const [session] = await db
    .select()
    .from(schoolSessionTable)
    .where(
      and(
        eq(schoolSessionTable.id, source.sessionId),
        eq(schoolSessionTable.schoolId, schoolId),
      ),
    )
    .limit(1);
  if (!session) throw rpcError.notFound("School session");
  const config = sessionConfigSchema.parse(session.sessionConfig ?? {});
  const examSlug = "examSlug" in source ? source.examSlug : null;
  const exam =
    examSlug && Object.hasOwn(config.examConfig, examSlug)
      ? { slug: examSlug, ...config.examConfig[examSlug]! }
      : null;
  if (examSlug && !exam) throw rpcError.notFound("Exam");
  const classes = await db
    .select()
    .from(classTable)
    .where(eq(classTable.schoolId, schoolId))
    .orderBy(asc(classTable.displayOrder), asc(classTable.id));
  const classMap = new Map(classes.map((c) => [c.id, c]));
  if (
    "classId" in source &&
    source.classId &&
    !classMap.has(source.classId)
  )
    throw rpcError.notFound("School class");
  // The classes taking part in the examination (`exam_class`), its own fact.
  // An excluded class appears in none of the examination's documents.
  const examClassIds = examSlug
    ? new Set(
        (
          await db
            .select({ classId: examClassTable.classId })
            .from(examClassTable)
            .where(
              and(
                eq(examClassTable.schoolId, schoolId),
                eq(examClassTable.sessionId, session.id),
                eq(examClassTable.examSlug, examSlug),
              ),
            )
        ).map((row) => row.classId),
      )
    : new Set<string>();
  if (
    examSlug &&
    "classId" in source &&
    source.classId &&
    !examClassIds.has(source.classId)
  )
    throw rpcError.badRequest(
      "This class does not take part in this examination.",
    );
  const [grid] = examSlug
    ? await db
        .select()
        .from(examTimetableTable)
        .where(
          and(
            eq(examTimetableTable.schoolId, schoolId),
            eq(examTimetableTable.sessionId, session.id),
            eq(examTimetableTable.examSlug, examSlug),
          ),
        )
        .limit(1)
    : [];
  const schoolContext = await schoolDocumentContextFor(school, images);
  const [lifecycle] = examSlug
    ? await db
        .select()
        .from(examLifecycleTable)
        .where(
          and(
            eq(examLifecycleTable.schoolId, schoolId),
            eq(examLifecycleTable.sessionId, session.id),
            eq(examLifecycleTable.examSlug, examSlug),
          ),
        )
        .limit(1)
    : [];
  const common = {
    school: schoolContext,
    session: {
      startYear: session.sessionStartYear,
      endYear: session.sessionEndYear,
    },
    exam: exam ? examDocumentContext(exam, lifecycle) : null,
    generatedAt: (options.generatedAt ?? new Date()).toISOString(),
  };
  const sortedRows = sortedTimetableRows(grid?.config.rows ?? []);
  const subjectsForCell = (row: TimetableRow, classId: string) =>
    timetableCellSubjects(row, classId, classMap);
  if (source.documentType === "timetable") {
    if (!grid || !sortedRows.length)
      throw rpcError.badRequest(
        "No exam timetable is available. Add examination slots first.",
      );
    // Timetable PDFs are examination-wide. The DTO has no classId and context
    // construction preserves every configured column plus every subject/mode in
    // a shared slot; do not narrow this from a contextual UI selection.
    // Columns are always classes taking part: saving the timetable and
    // removing a class keep them so. A column that is not (a broken invariant)
    // is refused rather than printed or silently dropped.
    const columnIds = grid.config.columns;
    if (
      !columnIds.length ||
      columnIds.some(
        (id) => !classMap.has(id) || !grid.config.columns.includes(id),
      )
    )
      throw rpcError.badRequest(
        "The selected class is not part of this timetable.",
      );
    if (columnIds.some((id) => !examClassIds.has(id)))
      throw rpcError.badRequest(
        "The timetable includes a class that does not take part in this examination. Update the timetable first.",
      );
    const columns = columnIds.map((id) => ({
      classId: id,
      label: classMap.get(id)!.label,
    }));
    const rows = sortedRows.map((row) => {
      const entries = columnIds.map((classId) => ({
        classId,
        subjects: subjectsForCell(row, classId),
      }));
      const cells = Object.fromEntries(
        entries.map(({ classId, subjects }) => [
          classId,
          !subjects.length
            ? null
            : Array.isArray(row.cells[classId])
              ? subjects
              : subjects[0],
        ]),
      );
      return { ...documentScheduleSlot(row), entries, cells };
    });
    return {
      contexts: [{ ...common, columns, rows }],
      studentIds: [],
      warnings: [] as string[],
      name: `${exam!.name} · Timetable`,
    };
  }
  if (
    source.studentIds &&
    new Set(source.studentIds).size !== source.studentIds.length
  )
    throw rpcError.badRequest("Select each student only once.");
  // School-wide examination documents are scoped to explicit plan classes,
  // never every class that happens to exist in the school.
  const plans =
    source.documentType === "report_card" ||
    source.documentType === "admit_card"
      ? await db
          .select()
          .from(examPlanTable)
          .where(
            and(
              eq(examPlanTable.schoolId, schoolId),
              eq(examPlanTable.sessionId, session.id),
              eq(examPlanTable.examSlug, source.examSlug),
              source.classId
                ? eq(examPlanTable.classId, source.classId)
                : undefined,
            ),
          )
          .orderBy(asc(examPlanTable.subjectSlug), asc(examPlanTable.id))
      : [];
  if (source.documentType === "report_card") {
    if (
      !plans.length ||
      plans.some(
        (plan) => plan.status === "draft" || plan.status === "approved",
      ) ||
      lifecycle?.status === "ready"
    )
      throw rpcError.badRequest(
        "Report cards need started examinations and active or completed subject plans.",
      );
    if (source.studentIds && !source.classId)
      throw rpcError.badRequest(
        "Choose a class for an explicit student selection.",
      );
  }
  if (source.documentType === "admit_card") {
    if (!plans.length)
      throw rpcError.badRequest(
        "Admit cards need an examination plan for the selected classes.",
      );
    if (source.studentIds && !source.classId)
      throw rpcError.badRequest(
        "Choose a class for an explicit student selection.",
      );
  }
  const enrolled = await db
    .select({
      student: studentTable,
      admission: admissionTable,
      section: sectionTable,
    })
    .from(studentTable)
    .innerJoin(
      admissionTable,
      and(
        eq(admissionTable.id, studentTable.admissionId),
        eq(admissionTable.schoolId, schoolId),
      ),
    )
    .leftJoin(
      sectionTable,
      and(
        eq(sectionTable.id, studentTable.sectionId),
        eq(sectionTable.classId, studentTable.classId),
        eq(sectionTable.schoolId, schoolId),
      ),
    )
    .innerJoin(
      classTable,
      and(
        eq(classTable.id, studentTable.classId),
        eq(classTable.schoolId, schoolId),
      ),
    )
    .where(
      and(
        eq(studentTable.schoolId, schoolId),
        eq(studentTable.sessionId, session.id),
        source.classId
          ? eq(studentTable.classId, source.classId)
          : inArray(studentTable.classId, [
              ...new Set(plans.map((plan) => plan.classId)),
            ]),
        eq(admissionTable.registered, true),
        source.studentIds
          ? inArray(studentTable.id, source.studentIds)
          : undefined,
      ),
    )
    .orderBy(
      asc(classTable.displayOrder),
      asc(sectionTable.displayOrder),
      asc(studentTable.rollNo),
      asc(admissionTable.name),
      asc(studentTable.id),
    )
    .limit(MAX_DOCUMENT_SOURCE_ITEMS + 1);
  if (source.studentIds && enrolled.length !== source.studentIds.length)
    throw rpcError.notFound("One or more selected enrolled students");
  if (!enrolled.length)
    throw rpcError.badRequest(
      "This selection has no registered students in the selected session.",
    );
  if (enrolled.length > MAX_DOCUMENT_SOURCE_ITEMS)
    throw rpcError.badRequest(
      `Select up to ${MAX_DOCUMENT_SOURCE_ITEMS.toLocaleString("en-IN")} students per document request.`,
    );
  const results = source.documentType === "report_card" && plans.length
    ? await db
        .select()
        .from(examResultTable)
        .where(
          and(
            eq(examResultTable.schoolId, schoolId),
            eq(examResultTable.sessionId, session.id),
            inArray(
              examResultTable.examPlanId,
              plans.map((p) => p.id),
            ),
            inArray(
              examResultTable.studentId,
              enrolled.map((s) => s.student.id),
            ),
          ),
        )
    : [];
  const [settings] =
    source.documentType === "report_card"
      ? await db
          .select()
          .from(examAssessmentSettingsTable)
          .where(
            and(
              eq(examAssessmentSettingsTable.schoolId, schoolId),
              eq(examAssessmentSettingsTable.sessionId, session.id),
              eq(examAssessmentSettingsTable.examSlug, source.examSlug),
            ),
          )
          .limit(1)
      : [];
  const assessments =
    source.documentType === "report_card"
      ? await db
          .select()
          .from(examStudentAssessmentTable)
          .where(
            and(
              eq(examStudentAssessmentTable.schoolId, schoolId),
              eq(examStudentAssessmentTable.sessionId, session.id),
              eq(examStudentAssessmentTable.examSlug, source.examSlug),
              inArray(
                examStudentAssessmentTable.studentId,
                enrolled.map((row) => row.student.id),
              ),
            ),
          )
      : [];
  const assessmentByStudent = new Map(
    assessments.map((row) => [row.studentId, row]),
  );
  // One lookup per student and plan instead of scanning every result for
  // each (quadratic in the class size, seconds of blocked CPU at 1,500
  // students). A student has at most one result per plan (unique).
  const resultKey = (studentId: string, planId: string) => `${studentId}\u0000${planId}`;
  const resultByStudentPlan = new Map(
    results.map((result) => [resultKey(result.studentId, result.examPlanId), result]),
  );
  const requiresAssessment =
    source.documentType === "report_card" &&
    ((source.reportSections.includeAttendance &&
      config.attendanceTracking.enabled) ||
      (source.reportSections.includeCoScholastics &&
        Object.keys(config.coScholasticAreas).length > 0));
  const warnings: string[] = [];
  const classesWithoutSchedules = new Set<string>();
  const contexts: object[] = [];
  const includedStudentIds: string[] = [];
  let embeddedBytes = 0;
  let excluded = 0;
  for (const { student, admission, section } of enrolled) {
    if (student.sectionId && !section)
      throw rpcError.badRequest(
        "A student section no longer belongs to the selected class.",
      );
    const schoolClass = classMap.get(student.classId!)!;
    const studentPlans = plans.filter(
      (plan) => plan.classId === student.classId,
    );
    const timetable =
      source.documentType === "admit_card"
        ? sortedRows.flatMap((row) =>
            subjectsForCell(row, schoolClass.id).map((subject) => ({
              ...documentScheduleSlot(row),
              ...subject,
            })),
          )
        : [];
    if (source.documentType === "admit_card" && !timetable.length)
      classesWithoutSchedules.add(schoolClass.id);
    const assessment = assessmentByStudent.get(student.id);
    if (source.documentType === "report_card") {
      const marksApproved =
        studentPlans.length > 0 &&
        studentPlans.every(
          (plan) => resultByStudentPlan.get(resultKey(student.id, plan.id))?.approved === true,
        );
      if (!marksApproved || (requiresAssessment && !assessment?.approved)) {
        if (source.resultPolicy === "approved_only" && !source.studentIds) {
          excluded++;
          continue;
        }
        throw rpcError.badRequest(
          `Approve every subject result and the configured exam-wide attendance/activities for ${admission.name} before generating report cards.`,
        );
      }
    }
    const identity = studentDocumentIdentity(
      { admission, student, className: schoolClass.label, sectionName: section?.label ?? null },
      images === "embed"
        ? await documentImage(admission.photoS3Key)
        : documentImageRef(admission.photoS3Key),
    );
    // Embedded images travel inside the one HTML document, so they share
    // its limit. Referenced images are limited per conversion batch instead
    // (`DOCUMENT_BATCH_IMAGE_MAX_BYTES`).
    if (images === "embed") {
      embeddedBytes +=
        (typeof identity.photoUrl === "string" ? identity.photoUrl.length : 0) +
        (typeof schoolContext.logoUrl === "string" ? schoolContext.logoUrl.length : 0);
      if (embeddedBytes > 20_000_000)
        throw rpcError.badRequest(
          "The selected photos exceed the document size limit. Select fewer students or use smaller photos.",
        );
    }
    const subjects =
      source.documentType === "report_card"
        ? studentPlans.map((plan) => {
            const result = resultByStudentPlan.get(resultKey(student.id, plan.id));
            if (!result?.approved)
              throw rpcError.badRequest(
                `Approve every subject result for ${admission.name} before generating report cards.`,
              );
            const subject = schoolClass.config.subjects[plan.subjectSlug];
            if (!subject)
              throw rpcError.badRequest(
                "A report subject is no longer configured.",
              );
            if (!resultMarksMatchPlan(result.marks, plan.modeConfig))
              throw rpcError.badRequest(
                `Marks for ${admission.name} do not match the subject plan.`,
              );
            return reportCardSubject({ plan, subject, result, config });
          })
        : [];
    const totals = reportCardTotals(subjects, config.gradingScale);
    // Shared assessment values are separate records. Never choose a subject's
    // legacy metadata as an exam-wide attendance or activity value.
    let attendance = null;
    const shareable = shareableAttendance(
      config.attendanceTracking.enabled,
      assessment,
      settings?.totalWorkingDays,
    );
    if (
      (source.documentType !== "report_card" ||
        source.reportSections.includeAttendance) &&
      shareable.kind !== "none"
    ) {
      if (shareable.kind === "invalid")
        throw rpcError.badRequest(
          "Configure valid examination working days before printing attendance.",
        );
      attendance = {
        daysAttended: shareable.daysAttended,
        totalWorkingDays: shareable.totalWorkingDays,
        percentage: percent(shareable.daysAttended, shareable.totalWorkingDays),
      };
    }
    const approvedGrades = shareableCoScholastics(assessment);
    const coScholastics = approvedGrades
      ? Object.fromEntries(
          Object.entries(approvedGrades).map(([slug, grade]) => [
            slug,
            { areaName: config.coScholasticAreas[slug]?.name ?? slug, grade },
          ]),
        )
      : null;
    includedStudentIds.push(student.id);
    contexts.push(withReportModeLayout({
      ...common,
      student: identity,
      timetable,
      subjects,
      ...totals,
      gradingScale: documentGradingScale(config.gradingScale),
      attendance,
      coScholastics,
      coScholasticAreas: Object.keys(config.coScholasticAreas).length
        ? config.coScholasticAreas
        : null,
      assessmentApproved: assessment?.approved ?? null,
      reportSections:
        source.documentType === "report_card" ? source.reportSections : null,
      attendanceEnabled: config.attendanceTracking.enabled,
    }));
  }
  if (!contexts.length)
    throw rpcError.badRequest(
      "No students have complete approved results and the requested assessments for this selection.",
    );
  if (excluded)
    warnings.push(
      `${excluded} student${excluded === 1 ? " was" : "s were"} excluded because results or requested assessments are missing or unapproved.`,
    );
  for (const classId of classesWithoutSchedules)
    warnings.push(
      `No exam schedule is configured for ${classMap.get(classId)!.label}. Those admit cards will include identity details only.`,
    );
  return {
    contexts,
    studentIds: includedStudentIds,
    warnings,
    name: `${source.documentType === "id_card" ? "Student IDs" : source.documentType === "admit_card" ? `${exam!.name} · Admit cards` : `${exam!.name} · Report cards`} · ${source.classId ? classMap.get(source.classId)!.label : "All classes"}`,
  };
}
