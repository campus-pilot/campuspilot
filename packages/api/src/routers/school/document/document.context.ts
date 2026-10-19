import type { DatabaseExecutor } from "@campuspilot/db";
import { admissionTable } from "@campuspilot/db/schema/admission";
import { classTable, sectionTable } from "@campuspilot/db/schema/class";
import {
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
import { sessionConfigSchema } from "@campuspilot/db/schema/jsonb/session-config";
import { and, asc, eq, inArray } from "drizzle-orm";
import { rpcError } from "../../../errors";
import type { DocumentSource } from "./document.dto";
import { documentImage } from "./document.storage";

export function documentGrade(
  percentage: number,
  scale: Record<string, { label: string; minScore: number }>,
) {
  return (
    Object.values(scale)
      .sort((a, b) => b.minScore - a.minScore)
      .find((grade) => percentage >= grade.minScore)?.label ?? "—"
  );
}
const percent = (score: number, maximum: number) =>
  maximum > 0 ? Math.round((score / maximum) * 1000) / 10 : 0;

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

/** Called inside a repeatable-read transaction. Every relationship is checked
 * independently, including historical sessions and explicit student selections.
 * Missing/unapproved marks are errors rather than fabricated zero scores.
 */
export async function buildDocumentContexts(
  db: DatabaseExecutor,
  schoolId: string,
  source: DocumentSource,
) {
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
  const schoolContext = {
    name: school.name,
    location: school.location,
    registrationNo: school.registrationNo,
    logoUrl: await documentImage(school.logoS3Key),
  };
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
    exam: exam
      ? {
          ...exam,
          status: lifecycle?.status ?? null,
          startedAt: lifecycle?.startedAt?.toISOString() ?? null,
          completedAt: lifecycle?.completedAt?.toISOString() ?? null,
        }
      : null,
    generatedAt: new Date().toISOString(),
  };
  const sortedRows = [...(grid?.config.rows ?? [])].sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      a.startTime.localeCompare(b.startTime) ||
      a.id.localeCompare(b.id),
  );
  const subjectsForCell = (
    row: (typeof sortedRows)[number],
    classId: string,
  ) => {
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
  };
  if (source.documentType === "timetable") {
    if (!grid || !sortedRows.length)
      throw rpcError.badRequest(
        "No exam timetable is available. Add examination slots first.",
      );
    // Timetable PDFs are examination-wide. The DTO has no classId and context
    // construction preserves every configured column plus every subject/mode in
    // a shared slot; do not narrow this from a contextual UI selection.
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
    .limit(501);
  if (source.studentIds && enrolled.length !== source.studentIds.length)
    throw rpcError.notFound("One or more selected enrolled students");
  if (!enrolled.length)
    throw rpcError.badRequest(
      "This selection has no registered students in the selected session.",
    );
  if (enrolled.length > 500)
    throw rpcError.badRequest(
      "Select up to 500 students per document request.",
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
        studentPlans.every((plan) =>
          results.some(
            (result) =>
              result.studentId === student.id &&
              result.examPlanId === plan.id &&
              result.approved,
          ),
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
    const identity = {
      name: admission.name,
      admissionNo: admission.admissionNo,
      dob: admission.dob,
      fatherName: admission.fatherName,
      motherName: admission.motherName,
      address: admission.address,
      phoneNo: admission.phoneNo,
      className: schoolClass.label,
      sectionName: section?.label ?? null,
      rollNo: student.rollNo?.toString() ?? null,
      photoUrl: await documentImage(admission.photoS3Key),
    };
    embeddedBytes +=
      (identity.photoUrl?.length ?? 0) + (schoolContext.logoUrl?.length ?? 0);
    if (embeddedBytes > 20_000_000)
      throw rpcError.badRequest(
        "The selected photos exceed the document size limit. Select fewer students or use smaller photos.",
      );
    const subjects =
      source.documentType === "report_card"
        ? studentPlans.map((plan) => {
            const result = results.find(
              (r) => r.examPlanId === plan.id && r.studentId === student.id,
            );
            if (!result?.approved)
              throw rpcError.badRequest(
                `Approve every subject result for ${admission.name} before generating report cards.`,
              );
            const subject = schoolClass.config.subjects[plan.subjectSlug];
            if (!subject)
              throw rpcError.badRequest(
                "A report subject is no longer configured.",
              );
            const modes = Object.entries(plan.modeConfig);
            if (
              modes.some(
                ([slug, mode]) =>
                  !Object.hasOwn(result.marks, slug) ||
                  result.marks[slug]! > mode.maxMarks,
              ) ||
              Object.keys(result.marks).some(
                (slug) => !Object.hasOwn(plan.modeConfig, slug),
              )
            )
              throw rpcError.badRequest(
                `Marks for ${admission.name} do not match the subject plan.`,
              );
            const total = Object.values(result.marks).reduce(
              (sum, mark) => sum + mark,
              0,
            );
            const percentage = percent(total, plan.totalMarks);
            return {
              slug: plan.subjectSlug,
              name: subject.name,
              totalMarks: plan.totalMarks,
              marks: result.marks,
              modeConfig: Object.fromEntries(
                modes.map(([slug, mode]) => [
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
                      percentage: percent(
                        result.daysAttended,
                        plan.totalWorkingDays,
                      ),
                    }
                  : null,
              coScholastics: result.coScholastics
                ? Object.fromEntries(
                    Object.entries(result.coScholastics).map(
                      ([slug, grade]) => [
                        slug,
                        {
                          areaName:
                            config.coScholasticAreas[slug]?.name ?? slug,
                          grade,
                        },
                      ],
                    ),
                  )
                : null,
            };
          })
        : [];
    const grandTotal = subjects.reduce((sum, s) => sum + s.total, 0);
    const grandMaxMarks = subjects.reduce((sum, s) => sum + s.totalMarks, 0);
    const overallPercentage = percent(grandTotal, grandMaxMarks);
    // Shared assessment values are separate records. Never choose a subject's
    // legacy metadata as an exam-wide attendance or activity value.
    let attendance = null;
    if (
      (source.documentType !== "report_card" ||
        source.reportSections.includeAttendance) &&
      config.attendanceTracking.enabled &&
      assessment?.approved &&
      assessment.daysAttended !== null
    ) {
      if (
        settings?.totalWorkingDays === null ||
        settings?.totalWorkingDays === undefined ||
        settings.totalWorkingDays <= 0 ||
        assessment.daysAttended < 0 ||
        assessment.daysAttended > settings.totalWorkingDays
      )
        throw rpcError.badRequest(
          "Configure valid examination working days before printing attendance.",
        );
      attendance = {
        daysAttended: assessment.daysAttended,
        totalWorkingDays: settings.totalWorkingDays,
        percentage: percent(assessment.daysAttended, settings.totalWorkingDays),
      };
    }
    const coScholastics =
      assessment?.approved &&
      assessment.coScholastics &&
      Object.keys(assessment.coScholastics).length
        ? Object.fromEntries(
            Object.entries(assessment.coScholastics).map(([slug, grade]) => [
              slug,
              { areaName: config.coScholasticAreas[slug]?.name ?? slug, grade },
            ]),
          )
        : null;
    includedStudentIds.push(student.id);
    contexts.push({
      ...common,
      student: identity,
      timetable,
      subjects,
      grandTotal,
      grandMaxMarks,
      overallPercentage,
      overallGrade: documentGrade(overallPercentage, config.gradingScale),
      gradingScale: Object.fromEntries(
        Object.entries(config.gradingScale).sort(
          ([, a], [, b]) => b.minScore - a.minScore,
        ),
      ),
      attendance,
      coScholastics,
      coScholasticAreas: Object.keys(config.coScholasticAreas).length
        ? config.coScholasticAreas
        : null,
      assessmentApproved: assessment?.approved ?? null,
      reportSections:
        source.documentType === "report_card" ? source.reportSections : null,
      attendanceEnabled: config.attendanceTracking.enabled,
    });
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
