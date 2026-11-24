import type { Database } from "@campuspilot/db";
import { admissionTable } from "@campuspilot/db/schema/admission";
import { classTable, sectionTable } from "@campuspilot/db/schema/class";
import {
  examAssessmentSettingsTable,
  examLifecycleTable,
  examPlanTable,
  examResultTable,
  examStudentAssessmentTable,
  examTimetableTable,
} from "@campuspilot/db/schema/exam";
import {
  financeBillTable,
  financeLedgerEntryTable,
  financePaymentTable,
} from "@campuspilot/db/schema/finance";
import { financeSchemaConfigSchema } from "@campuspilot/db/schema/jsonb/finance-config";
import { sessionConfigSchema, type SessionConfig } from "@campuspilot/db/schema/jsonb/session-config";
import { schoolTable } from "@campuspilot/db/schema/school";
import { schoolSessionTable } from "@campuspilot/db/schema/session";
import { studentTable } from "@campuspilot/db/schema/student";
import { createLogger } from "@campuspilot/logger";
import { measure } from "@campuspilot/logger/perf";
import { SCHOOL_ACTIONS, type SchoolAction } from "@campuspilot/opa/policies/school";
import { ORPCError } from "@orpc/server";
import { and, asc, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";

import type { Context } from "../../../context";
import { rpcError } from "../../../errors";
import { isSchoolFeatureEnabled } from "../../../feature-flags/feature-flags.service";
import { checkPermissions } from "../../../permissions/authorization";
import { shareableAttendance, shareableCoScholastics } from "../exam/exam-assessment-rules";
import { scorePercent } from "../exam/exam-scoring";
import { sampleDocumentContext } from "./document.catalog";
import {
  documentGradingScale,
  documentScheduleSlot,
  examDocumentContext,
  reportCardSubject,
  reportCardTotals,
  resultMarksMatchPlan,
  schoolDocumentContextFor,
  sortedTimetableRows,
  studentDocumentIdentity,
  timetableCellSubjects,
} from "./document.context";
import {
  GENERATOR_DOCUMENT_FEATURE,
  isFinanceDocumentType,
  TEMPLATE_PREVIEW_IMAGE_MARKER,
  type DocumentSource,
  type TemplateDocumentType as DocumentType,
  type TemplatePreviewPart,
  type TemplatePreviewPartSource,
} from "./document.dto";
import {
  DOCUMENT_IMAGE_FIELDS,
  documentImageDataUri,
  documentImageRef,
  isDocumentImageRef,
  loadDocumentImage,
} from "./document.images";
import { sourceReadActions } from "./document.permissions";
import { withReportModeLayout } from "./document.report-modes";
import { resolveDocumentSource } from "./document.source";

/**
 * The context a template preview renders with, built from the school's own
 * data (docs/document-system.md, "Preview context").
 *
 * A preview in school S shows S's data where the caller may read it and the
 * sample (`sampleDocumentContext`) everywhere else. The context always has
 * every field of the sample, so every template variable is defined; the
 * school's data replaces the sample one part at a time ({@link
 * TemplatePreviewPart}), and each part is decided on its own:
 *
 * - `school`: the school's name, location, registration number and logo are
 *   public school details, so anyone who may read the template sees them.
 *   A detail the school has not filled in (no location, no registration
 *   number, no logo) shows the sample's, so a design always shows where it
 *   goes; a logo that cannot be read shows the sample logo.
 * - `session`: the session's years.
 * - `student`: one registered student enrolled in the session, the first in
 *   the order documents print (class, section, roll number, name, id), with
 *   the class and section. A record is shown as it is, its empty fields
 *   included: a real student is never mixed with sample fields.
 * - `exam`: the first exam of the session (by its order, then slug) that has
 *   subject plans (report and admit cards) or a timetable with slots
 *   (timetables), its lifecycle, and for report cards its subjects with
 *   their modes and maxima, the grading scale, the co-scholastic areas and
 *   whether attendance is tracked: configuration, shown as configured. The
 *   student is taken from the exam's classes; without a student the exam's
 *   first class is shown (the sample student then carries its class name).
 * - `results` (report cards): the student's marks per subject, attendance,
 *   activity grades and approval. Marks that do not fit the plan, and every
 *   per-student value the school has not recorded, are sample values (marks
 *   as a share of each mode's maximum), because a report card preview needs
 *   marks to show its layout. Results are shown approved or not: someone who
 *   may read results reads both.
 * - `timetable`: the exam's timetable (admit cards: the student's class's
 *   slots; timetables: every classroom, built by the generator itself).
 * - `finance`: the latest posted bill, the latest payment or the latest
 *   ledger account of the session, rendered by the finance builder exactly
 *   as it generates (snapshot identity, real amounts); otherwise the sample's
 *   admission and amounts.
 *
 * **Permissions.** A part is the school's only when the caller holds every
 * read it needs, and only reads from the type's own `sourceReadActions` (what
 * generating the document needs) count, checked in one OPA round; a part
 * whose read is missing stays the sample and the preview never fails for it.
 * Student, result, timetable and finance data also need the school's
 * `studentManagement` feature (their procedures are gated on it). Notices and
 * question papers take the school and session only (their bodies stay the
 * sample notice and the example paper).
 *
 * **Session.** The caller's `sessionId` (the management app's selected
 * session) must belong to the school, or the preview is NOT_FOUND; without
 * one, the school's active session is used, else its latest by start year.
 *
 * Images are references here ({@link documentImageRef}); a preview embeds
 * them with {@link embedTemplatePreviewImages}, and
 * `getDocumentTemplatePreviewContext` marks them instead
 * ({@link describeTemplatePreviewImages}).
 */
export type TemplatePreview = {
  documentType: DocumentType;
  /** The session the data was read from; null when the school has none or the caller may not read it. */
  sessionId: string | null;
  parts: Partial<Record<TemplatePreviewPart, TemplatePreviewPartSource>>;
  context: Record<string, unknown>;
};

export type TemplatePreviewInput = { schoolId: string; documentType: DocumentType; sessionId?: string };

/** What the caller may read, decided once per preview. */
export type TemplatePreviewAccess = {
  /** Granted actions among the type's preview reads ({@link previewReadActions}). */
  granted: ReadonlySet<SchoolAction>;
  /** Whether the school has student management (student, result, timetable and finance data). */
  studentManagement: boolean;
};

const log = createLogger({ pkg: "document-preview" });

const SCHOOL_PART = { source: "school" } as const;
const sampled = (reason: "not_permitted" | "feature_off" | "no_data"): TemplatePreviewPartSource => ({ source: "sample", reason });

/**
 * The reads a type's preview may use: its generation's source reads
 * (`sourceReadActions`) without the template read the procedure already
 * checked. Notices and question papers render the school and the session
 * only, so they use the session read alone.
 */
export function previewReadActions(documentType: DocumentType): SchoolAction[] {
  if (documentType === "notice" || documentType === "question_paper") return [SCHOOL_ACTIONS.READ_SESSION];
  return sourceReadActions(documentType).filter(
    (action) =>
      action !== SCHOOL_ACTIONS.READ_DOCUMENT_TEMPLATES && action !== SCHOOL_ACTIONS.READ_FINANCE_DOCUMENT_TEMPLATES,
  );
}

/** The reads each part needs, for a type. Every one is in the type's {@link previewReadActions}. */
function partActions(part: Exclude<TemplatePreviewPart, "school">, documentType: DocumentType): SchoolAction[] {
  switch (part) {
    case "session":
      // A finance document reads its session through the finance read (its
      // generation needs no general session read).
      return [isFinanceDocumentType(documentType) ? SCHOOL_ACTIONS.READ_SESSION_FINANCE : SCHOOL_ACTIONS.READ_SESSION];
    case "student":
      return [SCHOOL_ACTIONS.READ_SESSION, SCHOOL_ACTIONS.READ_CLASS, SCHOOL_ACTIONS.READ_STUDENT];
    case "exam":
      return [
        SCHOOL_ACTIONS.READ_SESSION,
        SCHOOL_ACTIONS.READ_CLASS,
        SCHOOL_ACTIONS.READ_EXAMS,
        // A report card prints the subject plans themselves.
        ...(documentType === "report_card" ? [SCHOOL_ACTIONS.READ_EXAM_PLANS] : []),
      ];
    case "results":
      return [SCHOOL_ACTIONS.READ_EXAM_RESULTS];
    case "timetable":
      return [SCHOOL_ACTIONS.READ_EXAM_TIMETABLE];
    case "finance":
      return [SCHOOL_ACTIONS.READ_SESSION_FINANCE, SCHOOL_ACTIONS.READ_ADMISSION_LEDGER];
  }
}

/** Parts whose data belongs to student management (docs/feature-flags.md). */
const STUDENT_MANAGEMENT_PARTS: ReadonlySet<TemplatePreviewPart> = new Set(["student", "results", "timetable", "finance"]);

/**
 * Why a part must stay the sample for this caller, or null when it may be
 * the school's. A read outside the type's own preview reads is never
 * granted, so a preview cannot show what generating the type would not.
 */
function partDenied(
  part: Exclude<TemplatePreviewPart, "school">,
  documentType: DocumentType,
  access: TemplatePreviewAccess,
): TemplatePreviewPartSource | null {
  const allowed = new Set(previewReadActions(documentType));
  if (!partActions(part, documentType).every((action) => allowed.has(action) && access.granted.has(action)))
    return sampled("not_permitted");
  if (STUDENT_MANAGEMENT_PARTS.has(part) && !access.studentManagement) return sampled("feature_off");
  return null;
}

/**
 * What the caller may read for a preview of `documentType` in this school:
 * one OPA round for the type's preview reads, and the student management
 * feature for the types that print its data (the template procedures have
 * already required the type's own feature).
 */
export async function templatePreviewAccess(
  context: Context,
  input: Pick<TemplatePreviewInput, "schoolId" | "documentType">,
  signal?: AbortSignal,
): Promise<TemplatePreviewAccess> {
  const actions = previewReadActions(input.documentType);
  const results = await checkPermissions(
    context,
    actions.map((action) => ({ action, resource: { kind: "school" as const, schoolId: input.schoolId } })) as Parameters<typeof checkPermissions>[1],
    signal,
  );
  const usesStudentData = input.documentType !== "notice" && input.documentType !== "question_paper";
  return {
    granted: new Set(actions.filter((_action, index) => results[index])),
    studentManagement: usesStudentData && (await isSchoolFeatureEnabled(context.db, input.schoolId, GENERATOR_DOCUMENT_FEATURE)),
  };
}

/**
 * The session a preview reads: the requested one, which must be the
 * school's (NOT_FOUND otherwise, whatever the caller may read), else the
 * school's active session, else its latest by start year; null when the
 * school has no session. One indexed query.
 */
async function previewSession(db: Database, schoolId: string, sessionId: string | undefined) {
  const [session] = await db
    .select()
    .from(schoolSessionTable)
    .where(and(eq(schoolSessionTable.schoolId, schoolId), sessionId ? eq(schoolSessionTable.id, sessionId) : undefined))
    .orderBy(
      desc(schoolSessionTable.isActive),
      desc(schoolSessionTable.sessionStartYear),
      desc(schoolSessionTable.sessionEndYear),
      asc(schoolSessionTable.id),
    )
    .limit(1);
  if (sessionId && !session) throw rpcError.notFound("School session");
  return session ?? null;
}

type SessionRow = typeof schoolSessionTable.$inferSelect;
type SampleSchool = { name: string; location: string | null; registrationNo: string | null; logoUrl: unknown };

/**
 * The school block: the school's public details, each one the school has not
 * filled in shown as the sample's. The logo is a reference, embedded later.
 */
async function previewSchoolBlock(db: Database, schoolId: string, sample: SampleSchool) {
  const [school] = await db
    .select({
      name: schoolTable.name,
      location: schoolTable.location,
      registrationNo: schoolTable.registrationNo,
      logoS3Key: schoolTable.logoS3Key,
    })
    .from(schoolTable)
    .where(eq(schoolTable.id, schoolId))
    .limit(1);
  if (!school) throw rpcError.notFound("School");
  const real = await schoolDocumentContextFor(school, "reference");
  return {
    name: real.name,
    location: real.location ?? sample.location,
    registrationNo: real.registrationNo ?? sample.registrationNo,
    logoUrl: real.logoUrl ?? sample.logoUrl,
  };
}

/**
 * Builds the preview context of `input.documentType` for a caller with
 * `access` (see {@link TemplatePreview}). A handful of indexed queries: the
 * school, the session, then only what the type prints (at most about ten
 * for a report card), never one per student or subject.
 */
export async function buildTemplatePreviewContext(
  db: Database,
  input: TemplatePreviewInput,
  access: TemplatePreviewAccess,
): Promise<TemplatePreview> {
  const { schoolId, documentType } = input;
  const sample = sampleDocumentContext(documentType) as Record<string, unknown> & { school: SampleSchool };
  const [school, session] = await Promise.all([
    previewSchoolBlock(db, schoolId, sample.school),
    previewSession(db, schoolId, input.sessionId),
  ]);
  const parts: TemplatePreview["parts"] = { school: SCHOOL_PART };
  const context: Record<string, unknown> = { ...sample, school, generatedAt: new Date().toISOString() };
  const sessionDenied = partDenied("session", documentType, access);
  // The session is named only to a caller who may read it.
  const preview: TemplatePreview = { documentType, sessionId: session && !sessionDenied ? session.id : null, parts, context };

  parts.session = !session ? sampled("no_data") : (sessionDenied ?? SCHOOL_PART);
  if (session && !sessionDenied)
    context.session = { startYear: session.sessionStartYear, endYear: session.sessionEndYear };
  if (documentType === "notice" || documentType === "question_paper") return preview;

  if (documentType === "bill" || documentType === "receipt" || documentType === "statement") {
    parts.finance = !session ? sampled("no_data") : (partDenied("finance", documentType, access) ?? SCHOOL_PART);
    if (session && parts.finance.source === "school") {
      const finance = await financePreviewContext(db, schoolId, documentType, session);
      if (finance) Object.assign(context, finance, { school });
      else parts.finance = sampled("no_data");
    }
    return preview;
  }

  const studentDenied = partDenied("student", documentType, access);
  if (documentType === "id_card") {
    parts.student = !session ? sampled("no_data") : (studentDenied ?? SCHOOL_PART);
    const student = session && !studentDenied ? await firstEnrolledStudent(db, schoolId, session.id, null) : null;
    if (student) context.student = student.identity;
    else if (parts.student.source === "school") parts.student = sampled("no_data");
    return preview;
  }

  const examDenied = partDenied("exam", documentType, access);
  const timetableDenied = partDenied("timetable", documentType, access);
  if (documentType === "timetable") {
    parts.exam = !session ? sampled("no_data") : (examDenied ?? SCHOOL_PART);
    parts.timetable = !session ? sampled("no_data") : (timetableDenied ?? examDenied ?? SCHOOL_PART);
    if (!session || examDenied || timetableDenied) return preview;
    const grid = await timetablePreviewContext(db, schoolId, session);
    if (grid) Object.assign(context, { exam: grid.exam, columns: grid.columns, rows: grid.rows });
    else parts.exam = parts.timetable = sampled("no_data");
    return preview;
  }

  // Report and admit cards: the exam, one of its classes and a student of it.
  await examCardPreviewContext(db, { schoolId, documentType, session, access, preview, studentDenied, examDenied, timetableDenied });
  return preview;
}

/** One registered enrolled student of the session, first in print order, as the `student` block. */
async function firstEnrolledStudent(db: Database, schoolId: string, sessionId: string, classIds: string[] | null) {
  if (classIds && !classIds.length) return null;
  const [row] = await db
    .select({
      studentId: studentTable.id,
      classId: classTable.id,
      rollNo: studentTable.rollNo,
      admission: admissionTable,
      className: classTable.label,
      sectionName: sectionTable.label,
    })
    .from(studentTable)
    .innerJoin(admissionTable, and(eq(admissionTable.id, studentTable.admissionId), eq(admissionTable.schoolId, schoolId)))
    .innerJoin(classTable, and(eq(classTable.id, studentTable.classId), eq(classTable.schoolId, schoolId)))
    .leftJoin(
      sectionTable,
      and(
        eq(sectionTable.id, studentTable.sectionId),
        eq(sectionTable.classId, studentTable.classId),
        eq(sectionTable.schoolId, schoolId),
      ),
    )
    .where(
      and(
        eq(studentTable.schoolId, schoolId),
        eq(studentTable.sessionId, sessionId),
        eq(admissionTable.registered, true),
        classIds ? inArray(studentTable.classId, classIds) : undefined,
      ),
    )
    .orderBy(
      asc(classTable.displayOrder),
      asc(sectionTable.displayOrder),
      asc(studentTable.rollNo),
      asc(admissionTable.name),
      asc(studentTable.id),
    )
    .limit(1);
  if (!row) return null;
  return {
    studentId: row.studentId,
    classId: row.classId,
    identity: studentDocumentIdentity(
      { admission: row.admission, student: { rollNo: row.rollNo }, className: row.className, sectionName: row.sectionName ?? null },
      documentImageRef(row.admission.photoS3Key),
    ),
  };
}

/** The session's exams in their order (then slug), from its configuration; empty when it cannot be read. */
function orderedExams(session: SessionRow): { config: SessionConfig; exams: Array<{ slug: string; name: string; order: number }> } | null {
  const parsed = sessionConfigSchema.safeParse(session.sessionConfig ?? {});
  if (!parsed.success) return null;
  const exams = Object.entries(parsed.data.examConfig)
    .map(([slug, exam]) => ({ slug, name: exam.name, order: exam.order }))
    .sort((a, b) => a.order - b.order || a.slug.localeCompare(b.slug));
  return { config: parsed.data, exams };
}

async function examLifecycle(db: Database, schoolId: string, sessionId: string, examSlug: string) {
  const [lifecycle] = await db
    .select()
    .from(examLifecycleTable)
    .where(
      and(
        eq(examLifecycleTable.schoolId, schoolId),
        eq(examLifecycleTable.sessionId, sessionId),
        eq(examLifecycleTable.examSlug, examSlug),
      ),
    )
    .limit(1);
  return lifecycle;
}

/**
 * A timetable's `exam`, `columns` and `rows`, built by the generator itself
 * (`resolveDocumentSource` with a timetable source) for the first exam of the
 * session with a timetable that has slots. Null when there is none or the
 * generator refuses it (a broken timetable previews as the sample).
 */
async function timetablePreviewContext(db: Database, schoolId: string, session: SessionRow) {
  const exams = orderedExams(session)?.exams ?? [];
  if (!exams.length) return null;
  const withSlots = await db
    .select({ examSlug: examTimetableTable.examSlug })
    .from(examTimetableTable)
    .where(
      and(
        eq(examTimetableTable.schoolId, schoolId),
        eq(examTimetableTable.sessionId, session.id),
        sql`jsonb_array_length(${examTimetableTable.config} -> 'rows') > 0`,
      ),
    );
  const slugs = new Set(withSlots.map((row) => row.examSlug));
  const exam = exams.find((candidate) => slugs.has(candidate.slug));
  if (!exam) return null;
  const resolved = await refusalAsNull(() =>
    resolveDocumentSource(db, schoolId, { documentType: "timetable", sessionId: session.id, examSlug: exam.slug }, { images: "reference" }),
  );
  return (resolved?.contexts[0] as { exam: unknown; columns: unknown; rows: unknown } | undefined) ?? null;
}

/**
 * Report and admit cards: the first exam with subject plans, the first of
 * its classes with a registered student (else its first class), that
 * student, and the exam's subjects with the student's results (report cards)
 * or the class's slots (admit cards). See {@link TemplatePreview}.
 */
async function examCardPreviewContext(
  db: Database,
  input: {
    schoolId: string;
    documentType: "report_card" | "admit_card";
    session: SessionRow | null;
    access: TemplatePreviewAccess;
    preview: TemplatePreview;
    studentDenied: TemplatePreviewPartSource | null;
    examDenied: TemplatePreviewPartSource | null;
    timetableDenied: TemplatePreviewPartSource | null;
  },
) {
  const { schoolId, documentType, session, preview, studentDenied, examDenied } = input;
  const { parts, context } = preview;
  const reportCard = documentType === "report_card";
  const noSession = sampled("no_data");
  parts.student = !session ? noSession : (studentDenied ?? SCHOOL_PART);
  parts.exam = !session ? noSession : (examDenied ?? SCHOOL_PART);
  if (reportCard) parts.results = !session ? noSession : (partDenied("results", documentType, input.access) ?? studentDenied ?? SCHOOL_PART);
  else parts.timetable = !session ? noSession : (input.timetableDenied ?? examDenied ?? SCHOOL_PART);
  if (!session) return;

  // The exam: the first (by order, then slug) with subject plans, and its classes.
  const sessionExams = examDenied ? null : orderedExams(session);
  let exam: { slug: string; name: string; order: number } | undefined;
  let examClassIds: string[] = [];
  let classes: Array<typeof classTable.$inferSelect> = [];
  if (sessionExams?.exams.length) {
    const [planned, schoolClasses] = await Promise.all([
      db
        .selectDistinct({ examSlug: examPlanTable.examSlug, classId: examPlanTable.classId })
        .from(examPlanTable)
        .where(and(eq(examPlanTable.schoolId, schoolId), eq(examPlanTable.sessionId, session.id))),
      db
        .select()
        .from(classTable)
        .where(eq(classTable.schoolId, schoolId))
        .orderBy(asc(classTable.displayOrder), asc(classTable.id)),
    ]);
    exam = sessionExams.exams.find((candidate) => planned.some((row) => row.examSlug === candidate.slug));
    classes = schoolClasses;
    const planClassIds = new Set(planned.filter((row) => row.examSlug === exam?.slug).map((row) => row.classId));
    examClassIds = schoolClasses.filter((schoolClass) => planClassIds.has(schoolClass.id)).map((schoolClass) => schoolClass.id);
  }
  if (!exam || !examClassIds.length) {
    exam = undefined;
    if (!examDenied) parts.exam = sampled("no_data");
    // Timetable slots and results belong to an exam: without one they stay the sample.
    if (parts.timetable?.source === "school") parts.timetable = sampled("no_data");
    if (parts.results?.source === "school") parts.results = sampled("no_data");
  }

  // The student: from the exam's classes when the exam is the school's, else any.
  const student = studentDenied ? null : await firstEnrolledStudent(db, schoolId, session.id, exam ? examClassIds : null);
  if (student) context.student = student.identity;
  else if (!studentDenied) parts.student = sampled("no_data");
  if (!student && parts.results?.source === "school") parts.results = sampled("no_data");
  if (!exam || !sessionExams) return;

  const classId = student?.classId ?? examClassIds[0]!;
  const schoolClass = classes.find((candidate) => candidate.id === classId)!;
  // The sample student is shown in the class whose exam data is printed.
  if (!student) context.student = { ...(context.student as object), className: schoolClass.label };
  context.exam = examDocumentContext(exam, await examLifecycle(db, schoolId, session.id, exam.slug));

  if (!reportCard) {
    if (input.timetableDenied) return;
    const [grid] = await db
      .select({ config: examTimetableTable.config })
      .from(examTimetableTable)
      .where(
        and(
          eq(examTimetableTable.schoolId, schoolId),
          eq(examTimetableTable.sessionId, session.id),
          eq(examTimetableTable.examSlug, exam.slug),
        ),
      )
      .limit(1);
    const classMap = new Map(classes.map((candidate) => [candidate.id, candidate]));
    const timetable = grid
      ? refusalAsNullSync(() =>
          sortedTimetableRows(grid.config.rows).flatMap((row) =>
            timetableCellSubjects(row, classId, classMap).map((subject) => ({ ...documentScheduleSlot(row), ...subject })),
          ),
        )
      : null;
    if (timetable?.length) context.timetable = timetable;
    else parts.timetable = sampled("no_data");
    return;
  }

  await reportCardPreview(db, { schoolId, session, exam: exam.slug, config: sessionExams.config, schoolClass, student, preview });
}

/** A sample mark of a mode: a share of its maximum, varied by subject so the totals read like a report. */
const SAMPLE_MARK_SHARES = [0.88, 0.92, 0.76, 0.84, 0.95] as const;

/**
 * The report card part of the preview: the plans of the exam for the class
 * (configuration), and, when results may be read, the student's marks and
 * exam-wide assessment. Missing per-student values are sample values.
 */
async function reportCardPreview(
  db: Database,
  input: {
    schoolId: string;
    session: SessionRow;
    exam: string;
    config: SessionConfig;
    schoolClass: typeof classTable.$inferSelect;
    student: { studentId: string } | null;
    preview: TemplatePreview;
  },
) {
  const { schoolId, session, exam, config, schoolClass, preview } = input;
  const { context, parts } = preview;
  const readResults = parts.results?.source === "school" && input.student !== null;
  const studentId = input.student?.studentId ?? null;
  const plans = await db
    .select()
    .from(examPlanTable)
    .where(
      and(
        eq(examPlanTable.schoolId, schoolId),
        eq(examPlanTable.sessionId, session.id),
        eq(examPlanTable.examSlug, exam),
        eq(examPlanTable.classId, schoolClass.id),
      ),
    )
    .orderBy(asc(examPlanTable.subjectSlug), asc(examPlanTable.id));
  const [results, [assessment], [settings]] =
    readResults && studentId
      ? await Promise.all([
          plans.length
            ? db
                .select()
                .from(examResultTable)
                .where(
                  and(
                    eq(examResultTable.schoolId, schoolId),
                    eq(examResultTable.sessionId, session.id),
                    eq(examResultTable.studentId, studentId),
                    inArray(examResultTable.examPlanId, plans.map((plan) => plan.id)),
                  ),
                )
            : [],
          db
            .select()
            .from(examStudentAssessmentTable)
            .where(
              and(
                eq(examStudentAssessmentTable.schoolId, schoolId),
                eq(examStudentAssessmentTable.sessionId, session.id),
                eq(examStudentAssessmentTable.examSlug, exam),
                eq(examStudentAssessmentTable.studentId, studentId),
              ),
            )
            .limit(1),
          db
            .select()
            .from(examAssessmentSettingsTable)
            .where(
              and(
                eq(examAssessmentSettingsTable.schoolId, schoolId),
                eq(examAssessmentSettingsTable.sessionId, session.id),
                eq(examAssessmentSettingsTable.examSlug, exam),
              ),
            )
            .limit(1),
        ])
      : [[], [], []];
  const resultByPlan = new Map(results.map((result) => [result.examPlanId, result]));
  let recorded = 0;
  const subjects = plans.flatMap((plan, index) => {
    const subject = schoolClass.config.subjects[plan.subjectSlug];
    if (!subject) return [];
    const result = resultByPlan.get(plan.id);
    if (result && resultMarksMatchPlan(result.marks, plan.modeConfig)) {
      recorded += 1;
      return [reportCardSubject({ plan, subject, result, config })];
    }
    const share = SAMPLE_MARK_SHARES[index % SAMPLE_MARK_SHARES.length]!;
    const marks = Object.fromEntries(
      Object.entries(plan.modeConfig).map(([slug, mode]) => [slug, Math.round(mode.maxMarks * share)]),
    );
    return [reportCardSubject({ plan, subject, result: { marks, daysAttended: null, coScholastics: null }, config })];
  });
  if (!subjects.length) {
    // No configured subject to print: the exam's structure stays the sample's.
    if (parts.results?.source === "school") parts.results = sampled("no_data");
    return;
  }
  if (parts.results?.source === "school" && recorded === 0 && !assessment) parts.results = sampled("no_data");

  const attendanceEnabled = config.attendanceTracking.enabled;
  const shareable = shareableAttendance(attendanceEnabled, assessment, settings?.totalWorkingDays);
  const areas = Object.keys(config.coScholasticAreas).length ? config.coScholasticAreas : null;
  const approvedGrades = shareableCoScholastics(assessment);
  const sampleAttendance = context.attendance;
  Object.assign(context, {
    subjects,
    ...reportCardTotals(subjects, config.gradingScale),
    gradingScale: documentGradingScale(config.gradingScale),
    attendanceEnabled,
    attendance: !attendanceEnabled
      ? null
      : shareable.kind === "ok"
        ? {
            daysAttended: shareable.daysAttended,
            totalWorkingDays: shareable.totalWorkingDays,
            percentage: scorePercent(shareable.daysAttended, shareable.totalWorkingDays),
          }
        : sampleAttendance,
    coScholasticAreas: areas,
    coScholastics: !areas
      ? null
      : Object.fromEntries(
          Object.entries(areas).map(([slug, area]) => [
            slug,
            { areaName: area.name, grade: approvedGrades?.[slug] ?? "A" },
          ]),
        ),
    assessmentApproved: assessment ? assessment.approved : true,
  });
  Object.assign(context, withReportModeLayout(context as typeof context & { subjects: typeof subjects }));
}

/**
 * The finance part: the context the finance builder generates
 * (`resolveDocumentSource`, posting-time snapshots and real amounts) for
 * the session's latest posted bill, latest receipted payment, or the ledger
 * account with the latest entry (a statement through today, or the
 * session's last day once it has ended). Null when there is none or the
 * builder refuses it.
 */
async function financePreviewContext(
  db: Database,
  schoolId: string,
  documentType: "bill" | "receipt" | "statement",
  session: SessionRow,
): Promise<object | null> {
  const source = await financePreviewSource(db, schoolId, documentType, session);
  if (!source) return null;
  const resolved = await refusalAsNull(() => resolveDocumentSource(db, schoolId, source, { images: "reference" }));
  return resolved?.contexts[0] ?? null;
}

async function financePreviewSource(
  db: Database,
  schoolId: string,
  documentType: "bill" | "receipt" | "statement",
  session: SessionRow,
): Promise<DocumentSource | null> {
  if (documentType === "bill") {
    const [bill] = await db
      .select({ id: financeBillTable.id })
      .from(financeBillTable)
      .where(
        and(
          eq(financeBillTable.schoolId, schoolId),
          eq(financeBillTable.sessionId, session.id),
          eq(financeBillTable.status, "posted"),
        ),
      )
      .orderBy(desc(financeBillTable.issueDate), desc(financeBillTable.id))
      .limit(1);
    return bill ? { documentType, sessionId: session.id, billIds: [bill.id] } : null;
  }
  if (documentType === "receipt") {
    const [payment] = await db
      .select({ id: financePaymentTable.id })
      .from(financePaymentTable)
      .where(
        and(
          eq(financePaymentTable.schoolId, schoolId),
          eq(financePaymentTable.sessionId, session.id),
          isNotNull(financePaymentTable.documentSnapshot),
        ),
      )
      .orderBy(desc(financePaymentTable.receivedAt), desc(financePaymentTable.id))
      .limit(1);
    return payment ? { documentType, sessionId: session.id, transactions: [{ kind: "payment", id: payment.id }] } : null;
  }
  const finance = financeSchemaConfigSchema.safeParse(session.financeConfig);
  if (!finance.success) return null;
  const { currency, timeZone, cycleStartMonth } = finance.data;
  const month = String(cycleStartMonth).padStart(2, "0");
  const sessionStart = `${session.sessionStartYear}-${month}-01`;
  const lastDay = new Date(`${session.sessionEndYear}-${month}-01T00:00:00.000Z`);
  lastDay.setUTCDate(lastDay.getUTCDate() - 1);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const sessionLastDay = lastDay.toISOString().slice(0, 10);
  const throughDate = today < sessionLastDay ? today : sessionLastDay;
  if (throughDate < sessionStart) return null;
  const [entry] = await db
    .select({ admissionId: financeLedgerEntryTable.admissionId })
    .from(financeLedgerEntryTable)
    .where(
      and(
        eq(financeLedgerEntryTable.schoolId, schoolId),
        eq(financeLedgerEntryTable.sessionId, session.id),
        eq(financeLedgerEntryTable.currency, currency),
      ),
    )
    .orderBy(desc(financeLedgerEntryTable.effectiveAt), desc(financeLedgerEntryTable.sequence))
    .limit(1);
  return entry ? { documentType, sessionId: session.id, admissionIds: [entry.admissionId], throughDate } : null;
}

/** Refusals a builder gives for data a preview cannot use; anything else (an outage) is rethrown. */
const DATA_REFUSALS = new Set(["BAD_REQUEST", "NOT_FOUND", "CONFLICT"]);

/** The builder's result, or null when it refused the school's data (the part then stays the sample). */
async function refusalAsNull<T>(build: () => Promise<T>): Promise<T | null> {
  try {
    return await build();
  } catch (error) {
    if (error instanceof ORPCError && DATA_REFUSALS.has(error.code)) return null;
    throw error;
  }
}

function refusalAsNullSync<T>(build: () => T): T | null {
  try {
    return build();
  } catch (error) {
    if (error instanceof ORPCError && DATA_REFUSALS.has(error.code)) return null;
    throw error;
  }
}

/**
 * The preview context of a template for this caller (one function for every
 * preview and for `getDocumentTemplatePreviewContext`): the access check and
 * the build, timed as `doc.preview.context`.
 */
export function resolveTemplatePreviewContext(
  context: Context,
  input: TemplatePreviewInput,
  signal?: AbortSignal,
): Promise<TemplatePreview> {
  return measure("doc.preview.context", async () =>
    buildTemplatePreviewContext(context.db, input, await templatePreviewAccess(context, input, signal)),
  );
}

type ContextRecord = Record<string, unknown>;
const isRecord = (value: unknown): value is ContextRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * The preview context as a template receives it: every image reference
 * read from storage (with the generation path's checks: a PNG, JPEG or
 * WebP of at most 5 MB) and embedded as a `data:` URI, timed as
 * `doc.preview.images`. An image that cannot be read is the sample's image
 * for that field (the sample logo; no photo), logged as
 * `doc.preview.image.unavailable`: an image never fails a preview.
 */
export function embedTemplatePreviewImages(preview: TemplatePreview): Promise<Record<string, unknown>> {
  return measure("doc.preview.images", async () => {
    const sample = sampleDocumentContext(preview.documentType) as ContextRecord;
    const embedded: ContextRecord = { ...preview.context };
    for (const [parent, field] of DOCUMENT_IMAGE_FIELDS) {
      const holder = embedded[parent];
      const reference = isRecord(holder) ? holder[field] : null;
      if (!isRecord(holder) || !isDocumentImageRef(reference)) continue;
      const key = reference.documentImageKey;
      let value: unknown;
      try {
        value = documentImageDataUri(await loadDocumentImage(key));
      } catch (err) {
        log.warn({ err, key, field: `${parent}.${field}` }, "doc.preview.image.unavailable");
        const sampleHolder = sample[parent];
        value = isRecord(sampleHolder) ? (sampleHolder[field] ?? null) : null;
      }
      embedded[parent] = { ...holder, [field]: value };
    }
    return embedded;
  });
}

/** The preview context resolved and embedded: what every template preview renders. */
export async function templatePreviewRenderContext(
  context: Context,
  input: TemplatePreviewInput,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  return embedTemplatePreviewImages(await resolveTemplatePreviewContext(context, input, signal));
}

/**
 * The preview context for a client to read: each image field holds
 * {@link TEMPLATE_PREVIEW_IMAGE_MARKER} when an image would print there (a
 * reference or a sample data URI), or null, instead of megabytes of data.
 * Nothing is read from storage.
 */
export function describeTemplatePreviewImages(context: Record<string, unknown>): Record<string, unknown> {
  const described: ContextRecord = { ...context };
  for (const [parent, field] of DOCUMENT_IMAGE_FIELDS) {
    const holder = described[parent];
    if (!isRecord(holder) || !(field in holder)) continue;
    described[parent] = { ...holder, [field]: holder[field] ? TEMPLATE_PREVIEW_IMAGE_MARKER : null };
  }
  return described;
}
