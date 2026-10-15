import type { DatabaseExecutor } from '@campuspilot/db';
import { admissionTable } from '@campuspilot/db/schema/admission';
import { classTable, sectionTable } from '@campuspilot/db/schema/class';
import {
  examPlanTable,
  examResultTable,
  examTimetableTable,
} from '@campuspilot/db/schema/exam';
import { schoolTable } from '@campuspilot/db/schema/school';
import { schoolSessionTable } from '@campuspilot/db/schema/session';
import { studentTable } from '@campuspilot/db/schema/student';
import { sessionConfigSchema } from '@campuspilot/db/schema/jsonb/session-config';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { rpcError } from '../../../errors';
import type { DocumentSource } from './document.dto';
import { documentImage } from './document.storage';

export function documentGrade(
  percentage: number,
  scale: Record<string, { label: string; minScore: number }>,
) {
  return (
    Object.values(scale)
      .sort((a, b) => b.minScore - a.minScore)
      .find((grade) => percentage >= grade.minScore)?.label ?? '—'
  );
}
const percent = (score: number, maximum: number) =>
  maximum > 0 ? Math.round((score / maximum) * 1000) / 10 : 0;

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
  if (!school) throw rpcError.notFound('School');
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
  if (!session) throw rpcError.notFound('School session');
  const config = sessionConfigSchema.parse(session.sessionConfig ?? {});
  const examSlug = 'examSlug' in source ? source.examSlug : null;
  const exam =
    examSlug && Object.hasOwn(config.examConfig, examSlug)
      ? { slug: examSlug, ...config.examConfig[examSlug]! }
      : null;
  if (examSlug && !exam) throw rpcError.notFound('Exam');
  const classes = await db
    .select()
    .from(classTable)
    .where(eq(classTable.schoolId, schoolId))
    .orderBy(asc(classTable.displayOrder), asc(classTable.id));
  const classMap = new Map(classes.map((c) => [c.id, c]));
  if (source.classId && !classMap.has(source.classId))
    throw rpcError.notFound('School class');
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
  const common = {
    school: schoolContext,
    session: {
      startYear: session.sessionStartYear,
      endYear: session.sessionEndYear,
    },
    exam,
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
          'A timetable subject or mode is no longer configured. Update the timetable first.',
        );
      return {
        ...entry,
        subjectName: subject.name,
        modeName: subject.examModes[entry.modeSlug]!.name,
      };
    });
  };
  if (source.documentType === 'timetable') {
    if (!grid || !sortedRows.length)
      throw rpcError.badRequest(
        'No exam timetable is available. Add examination slots first.',
      );
    const columnIds = source.classId ? [source.classId] : grid.config.columns;
    if (
      !columnIds.length ||
      columnIds.some(
        (id) => !classMap.has(id) || !grid.config.columns.includes(id),
      )
    )
      throw rpcError.badRequest(
        'The selected class is not part of this timetable.',
      );
    const columns = columnIds.map((id) => ({
      classId: id,
      label: classMap.get(id)!.label,
    }));
    const rows = sortedRows.map((row) => ({
      displayDate: row.date,
      startTime: row.startTime,
      endTime: row.endTime,
      entries: columnIds.map((classId) => ({
        classId,
        subjects: subjectsForCell(row, classId),
      })),
    }));
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
    throw rpcError.badRequest('Select each student only once.');
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
        eq(sectionTable.classId, source.classId),
        eq(sectionTable.schoolId, schoolId),
      ),
    )
    .where(
      and(
        eq(studentTable.schoolId, schoolId),
        eq(studentTable.sessionId, session.id),
        eq(studentTable.classId, source.classId),
        eq(admissionTable.registered, true),
        source.studentIds
          ? inArray(studentTable.id, source.studentIds)
          : undefined,
      ),
    )
    .orderBy(asc(admissionTable.name), asc(studentTable.id))
    .limit(501);
  if (source.studentIds && enrolled.length !== source.studentIds.length)
    throw rpcError.notFound('One or more selected enrolled students');
  if (!enrolled.length)
    throw rpcError.badRequest(
      'This class has no registered students in the selected session.',
    );
  if (enrolled.length > 500)
    throw rpcError.badRequest(
      'Select up to 500 students per document request.',
    );
  const schoolClass = classMap.get(source.classId)!;
  const plans =
    source.documentType === 'report_card'
      ? await db
          .select()
          .from(examPlanTable)
          .where(
            and(
              eq(examPlanTable.schoolId, schoolId),
              eq(examPlanTable.sessionId, session.id),
              eq(examPlanTable.examSlug, examSlug!),
              eq(examPlanTable.classId, schoolClass.id),
            ),
          )
          .orderBy(asc(examPlanTable.subjectSlug), asc(examPlanTable.id))
      : [];
  const results = plans.length
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
  if (
    source.documentType === 'report_card' &&
    (!plans.length ||
      plans.some((p) => p.status === 'draft' || p.status === 'approved'))
  )
    throw rpcError.badRequest(
      'Report cards need active or completed subject plans.',
    );
  const warnings: string[] = [];
  const timetable =
    source.documentType === 'admit_card'
      ? sortedRows.flatMap((row) =>
          subjectsForCell(row, source.classId).map((subject) => ({
            displayDate: row.date,
            startTime: row.startTime,
            endTime: row.endTime,
            ...subject,
          })),
        )
      : [];
  if (source.documentType === 'admit_card' && !timetable.length)
    warnings.push(
      'No exam schedule is configured for this class. Admit cards will include identity details only.',
    );
  const contexts: object[] = [];
  let embeddedBytes = 0;
  for (const { student, admission, section } of enrolled) {
    if (student.sectionId && !section)
      throw rpcError.badRequest(
        'A student section no longer belongs to the selected class.',
      );
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
        'The selected photos exceed the document size limit. Select fewer students or use smaller photos.',
      );
    const subjects = plans.map((plan) => {
      const result = results.find(
        (r) => r.examPlanId === plan.id && r.studentId === student.id,
      );
      if (!result?.approved)
        throw rpcError.badRequest(
          `Approve every subject result for ${admission.name} before generating report cards.`,
        );
      const subject = schoolClass.config.subjects[plan.subjectSlug];
      if (!subject)
        throw rpcError.badRequest('A report subject is no longer configured.');
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
                percentage: percent(result.daysAttended, plan.totalWorkingDays),
              }
            : null,
        coScholastics: result.coScholastics
          ? Object.fromEntries(
              Object.entries(result.coScholastics).map(([slug, grade]) => [
                slug,
                {
                  areaName: config.coScholasticAreas[slug]?.name ?? slug,
                  grade,
                },
              ]),
            )
          : null,
      };
    });
    const grandTotal = subjects.reduce((sum, s) => sum + s.total, 0);
    const grandMaxMarks = subjects.reduce((sum, s) => sum + s.totalMarks, 0);
    const overallPercentage = percent(grandTotal, grandMaxMarks);
    contexts.push({
      ...common,
      student: identity,
      timetable,
      subjects,
      grandTotal,
      grandMaxMarks,
      overallPercentage,
      overallGrade: documentGrade(overallPercentage, config.gradingScale),
      gradingScale: config.gradingScale,
      attendanceEnabled: config.attendanceTracking.enabled,
    });
  }
  return {
    contexts,
    studentIds: enrolled.map((s) => s.student.id),
    warnings,
    name: `${source.documentType === 'id_card' ? 'Student IDs' : source.documentType === 'admit_card' ? `${exam!.name} · Admit cards` : `${exam!.name} · Report cards`} · ${schoolClass.label}`,
  };
}
