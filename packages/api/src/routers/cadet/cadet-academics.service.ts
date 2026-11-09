import type { DatabaseExecutor } from '@campuspilot/db';
import { user } from '@campuspilot/db/schema/auth';
import { classTable, sectionTable } from '@campuspilot/db/schema/class';
import {
  examAssessmentSettingsTable,
  examLifecycleTable,
  examPlanTable,
  examResultTable,
  examStudentAssessmentTable,
  examStudentRemarkTable,
} from '@campuspilot/db/schema/exam';
import { classConfigSchema, type ClassConfig } from '@campuspilot/db/schema/jsonb/class-config';
import type { ModeConfig, ResultMarks } from '@campuspilot/db/schema/jsonb/exam-config';
import { sessionConfigSchema, type SessionConfig } from '@campuspilot/db/schema/jsonb/session-config';
import { schoolTable } from '@campuspilot/db/schema/school';
import { schoolSessionTable } from '@campuspilot/db/schema/session';
import { studentTable } from '@campuspilot/db/schema/student';
import { and, desc, eq, inArray } from 'drizzle-orm';

import { rpcError } from '../../errors';
import type { CadetExamState } from './cadet.dto';

/**
 * Everything the Cadet Portal shows about a student's examinations, read for
 * one admission only. The admission comes from the cadet's login, so every
 * query below is scoped to that admission's own enrollments; nothing here
 * accepts another student's id.
 *
 * A *class record* is one class within one session's enrollment
 * (`{studentId}.{classId}`). Classes own their subjects, so a subject is
 * identified by its record plus its slug and is never compared with a
 * subject of another record, even when the slug or name matches. Only
 * overall percentages are compared between records.
 *
 * Marks, remarks, attendance and co-scholastic grades are read only for
 * examinations the school explicitly released to the Cadet Portal
 * (`exam_lifecycle.cadet_released_at`). Class averages are computed only
 * when the school's `cadet_show_class_averages` setting is on; otherwise
 * they are null in every response.
 */

type Cadet = { schoolId: string; admissionId: string };

export type CadetRecord = {
  recordId: string;
  studentId: string;
  classId: string;
  sessionId: string;
  sessionLabel: string;
  sessionIsActive: boolean;
  sessionStartYear: number;
  sessionConfig: SessionConfig;
  classLabel: string;
  classConfig: ClassConfig;
  /** Only when the enrollment is still placed in this class; a detached or moved enrollment has no section here. */
  sectionLabel: string | null;
};

type PlanRow = {
  id: string;
  sessionId: string;
  examSlug: string;
  classId: string;
  subjectSlug: string;
  totalMarks: number;
  modeConfig: ModeConfig;
};

export type CadetExam = {
  examId: string;
  record: CadetRecord;
  examSlug: string;
  name: string;
  order: number;
  state: CadetExamState;
  releasedAt: Date | null;
  plans: PlanRow[];
};

export type SubjectScore = {
  subjectId: string;
  subjectSlug: string;
  name: string;
  obtained: number;
  max: number;
  percentage: number;
  grade: string | null;
  modes: Array<{ name: string; obtained: number; max: number }>;
};

export type ReleasedExamResult = {
  exam: CadetExam;
  /** Null when the student has no marks in this exam. */
  overall: { obtained: number; max: number; percentage: number; grade: string | null } | null;
  subjects: SubjectScore[];
  classAveragePercentage: number | null;
  subjectAverages: Map<string, number> | null;
};

const percent = (score: number, maximum: number) =>
  maximum > 0 ? Math.round((score / maximum) * 1000) / 10 : 0;
const mean = (values: number[]) =>
  values.length ? Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10 : null;

/** Highest grade whose threshold the percentage reaches; null without a scale. */
export function gradeFor(percentage: number, scale: SessionConfig['gradingScale']): string | null {
  return (
    Object.values(scale)
      .sort((a, b) => b.minScore - a.minScore)
      .find((grade) => percentage >= grade.minScore)?.label ?? null
  );
}

export const recordIdOf = (studentId: string, classId: string) => `${studentId}.${classId}`;
export const examIdOf = (recordId: string, examSlug: string) => `${recordId}.${examSlug}`;
export const subjectIdOf = (recordId: string, subjectSlug: string) => `${recordId}.${subjectSlug}`;

/** Splits an exam id into its record and slug. Student and class ids never contain a dot. */
export function parseExamId(examId: string) {
  const [studentId, classId, ...slug] = examId.split('.');
  if (!studentId || !classId || slug.length === 0) return null;
  return { recordId: recordIdOf(studentId, classId), examSlug: slug.join('.') };
}

const sessionLabelOf = (start: number, end: number) => `${start}–${String(end).slice(-2)}`;

function examState(
  planCountForClass: number,
  lifecycle: { status: 'ready' | 'active' | 'completed'; cadetReleasedAt: Date | null } | undefined,
): CadetExamState {
  if (planCountForClass > 0 && lifecycle?.cadetReleasedAt) return 'released';
  if (lifecycle?.status === 'completed') return 'awaiting_release';
  if (lifecycle?.status === 'active') return 'in_progress';
  return 'upcoming';
}

/** The school's name and Cadet Portal sharing setting. */
export async function loadCadetSchool(db: DatabaseExecutor, cadet: Cadet) {
  const [school] = await db
    .select({ name: schoolTable.name, showClassAverages: schoolTable.cadetShowClassAverages })
    .from(schoolTable)
    .where(eq(schoolTable.id, cadet.schoolId))
    .limit(1);
  if (!school) throw rpcError.notFound('School');
  return school;
}

/** The admission's enrollments, newest session first. */
export async function loadCadetEnrollments(db: DatabaseExecutor, cadet: Cadet) {
  return db
    .select({
      studentId: studentTable.id,
      sessionId: studentTable.sessionId,
      classId: studentTable.classId,
      rollNo: studentTable.rollNo,
      sectionLabel: sectionTable.label,
      classLabel: classTable.label,
      sessionStartYear: schoolSessionTable.sessionStartYear,
      sessionEndYear: schoolSessionTable.sessionEndYear,
      sessionIsActive: schoolSessionTable.isActive,
      sessionConfig: schoolSessionTable.sessionConfig,
    })
    .from(studentTable)
    .innerJoin(
      schoolSessionTable,
      and(eq(schoolSessionTable.id, studentTable.sessionId), eq(schoolSessionTable.schoolId, cadet.schoolId)),
    )
    .leftJoin(classTable, and(eq(classTable.id, studentTable.classId), eq(classTable.schoolId, cadet.schoolId)))
    .leftJoin(sectionTable, and(eq(sectionTable.id, studentTable.sectionId), eq(sectionTable.schoolId, cadet.schoolId)))
    .where(and(eq(studentTable.schoolId, cadet.schoolId), eq(studentTable.admissionId, cadet.admissionId)))
    .orderBy(desc(schoolSessionTable.sessionStartYear), desc(schoolSessionTable.sessionEndYear), desc(studentTable.id))
    .then((rows) =>
      rows.map((row) => ({
        ...row,
        sessionLabel: sessionLabelOf(row.sessionStartYear, row.sessionEndYear),
      })),
    );
}

/**
 * Loads the student's class records and every examination of them. A class
 * belongs to an enrollment when the enrollment is placed in it or has
 * results in its exam plans (a student moved or detached later keeps the
 * class they sat the exam in).
 */
export async function loadCadetAcademics(db: DatabaseExecutor, cadet: Cadet) {
  const enrollments = await loadCadetEnrollments(db, cadet);
  const studentIds = enrollments.map((row) => row.studentId);
  const resultRows = studentIds.length
    ? await db
        .select({
          studentId: examResultTable.studentId,
          marks: examResultTable.marks,
          plan: {
            id: examPlanTable.id,
            sessionId: examPlanTable.sessionId,
            examSlug: examPlanTable.examSlug,
            classId: examPlanTable.classId,
            subjectSlug: examPlanTable.subjectSlug,
            totalMarks: examPlanTable.totalMarks,
            modeConfig: examPlanTable.modeConfig,
          },
        })
        .from(examResultTable)
        .innerJoin(examPlanTable, eq(examPlanTable.id, examResultTable.examPlanId))
        .where(and(eq(examResultTable.schoolId, cadet.schoolId), inArray(examResultTable.studentId, studentIds)))
    : [];

  const recordKeys: Array<{ enrollment: (typeof enrollments)[number]; classId: string }> = [];
  for (const enrollment of enrollments) {
    const classIds = new Set<string>();
    if (enrollment.classId) classIds.add(enrollment.classId);
    for (const row of resultRows)
      if (row.studentId === enrollment.studentId && row.plan.sessionId === enrollment.sessionId) classIds.add(row.plan.classId);
    for (const classId of classIds) recordKeys.push({ enrollment, classId });
  }
  const classIds = [...new Set(recordKeys.map(({ classId }) => classId))];
  const sessionIds = [...new Set(enrollments.map(({ sessionId }) => sessionId))];
  const [classes, plans, lifecycles] = await Promise.all([
    classIds.length
      ? db
          .select({ id: classTable.id, label: classTable.label, config: classTable.config })
          .from(classTable)
          .where(and(eq(classTable.schoolId, cadet.schoolId), inArray(classTable.id, classIds)))
      : [],
    sessionIds.length
      ? db
          .select({
            id: examPlanTable.id,
            sessionId: examPlanTable.sessionId,
            examSlug: examPlanTable.examSlug,
            classId: examPlanTable.classId,
            subjectSlug: examPlanTable.subjectSlug,
            totalMarks: examPlanTable.totalMarks,
            modeConfig: examPlanTable.modeConfig,
          })
          .from(examPlanTable)
          .where(and(eq(examPlanTable.schoolId, cadet.schoolId), inArray(examPlanTable.sessionId, sessionIds)))
      : [],
    sessionIds.length
      ? db
          .select({
            sessionId: examLifecycleTable.sessionId,
            examSlug: examLifecycleTable.examSlug,
            status: examLifecycleTable.status,
            cadetReleasedAt: examLifecycleTable.cadetReleasedAt,
          })
          .from(examLifecycleTable)
          .where(and(eq(examLifecycleTable.schoolId, cadet.schoolId), inArray(examLifecycleTable.sessionId, sessionIds)))
      : [],
  ]);
  const classById = new Map(classes.map((row) => [row.id, row]));
  const lifecycleByExam = new Map(lifecycles.map((row) => [`${row.sessionId}|${row.examSlug}`, row]));

  const records: CadetRecord[] = recordKeys.flatMap(({ enrollment, classId }) => {
    const schoolClass = classById.get(classId);
    if (!schoolClass) return [];
    return [
      {
        recordId: recordIdOf(enrollment.studentId, classId),
        studentId: enrollment.studentId,
        classId,
        sessionId: enrollment.sessionId,
        sessionLabel: enrollment.sessionLabel,
        sessionIsActive: enrollment.sessionIsActive,
        sessionStartYear: enrollment.sessionStartYear,
        sessionConfig: sessionConfigSchema.parse(enrollment.sessionConfig ?? {}),
        classLabel: schoolClass.label,
        classConfig: classConfigSchema.parse(schoolClass.config ?? {}),
        sectionLabel: enrollment.classId === classId ? enrollment.sectionLabel : null,
      },
    ];
  });

  const exams = new Map<string, CadetExam[]>();
  for (const record of records) {
    const definitions = Object.entries(record.sessionConfig.examConfig).sort(
      ([slugA, a], [slugB, b]) => a.order - b.order || slugA.localeCompare(slugB),
    );
    const list: CadetExam[] = [];
    for (const [examSlug, definition] of definitions) {
      const examPlans = plans.filter((plan) => plan.sessionId === record.sessionId && plan.examSlug === examSlug);
      const classPlans = examPlans.filter((plan) => plan.classId === record.classId);
      // An exam planned only for other classes is not one this student sits.
      if (examPlans.length > 0 && classPlans.length === 0) continue;
      const lifecycle = lifecycleByExam.get(`${record.sessionId}|${examSlug}`);
      const state = examState(classPlans.length, lifecycle);
      list.push({
        examId: examIdOf(record.recordId, examSlug),
        record,
        examSlug,
        name: definition.name,
        order: definition.order,
        state,
        releasedAt: state === 'released' ? lifecycle!.cadetReleasedAt : null,
        plans: classPlans,
      });
    }
    exams.set(record.recordId, list);
  }

  const marksByPlan = new Map<string, ResultMarks>();
  for (const row of resultRows) marksByPlan.set(`${row.plan.id}|${row.studentId}`, row.marks);

  const current =
    records.find((record) => record.sessionIsActive && enrollments.some((row) => row.studentId === record.studentId && row.classId === record.classId)) ??
    records[0] ??
    null;

  return {
    enrollments,
    records,
    currentRecord: current,
    examsOf: (recordId: string) => exams.get(recordId) ?? [],
    /** The student's own marks for one plan, or undefined. */
    marksOf: (planId: string, studentId: string) => marksByPlan.get(`${planId}|${studentId}`),
  };
}

export type CadetAcademics = Awaited<ReturnType<typeof loadCadetAcademics>>;

export function findRecord(academics: CadetAcademics, recordId: string | undefined) {
  if (recordId === undefined) return academics.currentRecord;
  const record = academics.records.find((item) => item.recordId === recordId);
  // Another student's record and an unknown id look the same.
  if (!record) throw rpcError.notFound('Class');
  return record;
}

function subjectOrder(record: CadetRecord, plans: PlanRow[]) {
  const configured = Object.keys(record.classConfig.subjects);
  return [...plans].sort((a, b) => {
    const left = configured.indexOf(a.subjectSlug);
    const right = configured.indexOf(b.subjectSlug);
    if (left !== right) return (left === -1 ? Infinity : left) - (right === -1 ? Infinity : right);
    return a.subjectSlug.localeCompare(b.subjectSlug);
  });
}

const subjectName = (record: CadetRecord, slug: string) => record.classConfig.subjects[slug]?.name ?? slug;

/**
 * Scores of released examinations, with class averages computed from every
 * result in the same class plans only when `withAverages` is true.
 */
export async function scoreReleasedExams(
  db: DatabaseExecutor,
  academics: CadetAcademics,
  exams: CadetExam[],
  withAverages: boolean,
): Promise<ReleasedExamResult[]> {
  const released = exams.filter((exam) => exam.state === 'released');
  const planIds = released.flatMap((exam) => exam.plans.map((plan) => plan.id));
  const classRows = withAverages && planIds.length
    ? await db
        .select({ planId: examResultTable.examPlanId, studentId: examResultTable.studentId, marks: examResultTable.marks })
        .from(examResultTable)
        .where(inArray(examResultTable.examPlanId, planIds))
    : [];
  return released.map((exam) => {
    const { record } = exam;
    const subjects: SubjectScore[] = [];
    for (const plan of subjectOrder(record, exam.plans)) {
      const marks = academics.marksOf(plan.id, record.studentId);
      if (!marks) continue;
      const obtained = Object.values(marks).reduce((sum, value) => sum + value, 0);
      const percentage = percent(obtained, plan.totalMarks);
      const modeNames = record.classConfig.subjects[plan.subjectSlug]?.examModes ?? {};
      subjects.push({
        subjectId: subjectIdOf(record.recordId, plan.subjectSlug),
        subjectSlug: plan.subjectSlug,
        name: subjectName(record, plan.subjectSlug),
        obtained,
        max: plan.totalMarks,
        percentage,
        grade: gradeFor(percentage, record.sessionConfig.gradingScale),
        modes: Object.entries(plan.modeConfig).map(([slug, mode]) => ({
          name: modeNames[slug]?.name ?? slug,
          obtained: marks[slug] ?? 0,
          max: mode.maxMarks,
        })),
      });
    }
    const obtained = subjects.reduce((sum, subject) => sum + subject.obtained, 0);
    const max = subjects.reduce((sum, subject) => sum + subject.max, 0);
    const overall = subjects.length
      ? { obtained, max, percentage: percent(obtained, max), grade: gradeFor(percent(obtained, max), record.sessionConfig.gradingScale) }
      : null;

    let classAveragePercentage: number | null = null;
    let subjectAverages: Map<string, number> | null = null;
    if (withAverages) {
      const planById = new Map(exam.plans.map((plan) => [plan.id, plan]));
      const rows = classRows.filter((row) => planById.has(row.planId));
      const totals = new Map<string, { obtained: number; max: number }>();
      subjectAverages = new Map();
      for (const plan of exam.plans) {
        const percentages = rows
          .filter((row) => row.planId === plan.id)
          .map((row) => percent(Object.values(row.marks).reduce((sum, value) => sum + value, 0), plan.totalMarks));
        const average = mean(percentages);
        if (average !== null) subjectAverages.set(subjectIdOf(record.recordId, plan.subjectSlug), average);
      }
      for (const row of rows) {
        const plan = planById.get(row.planId)!;
        const total = totals.get(row.studentId) ?? { obtained: 0, max: 0 };
        total.obtained += Object.values(row.marks).reduce((sum, value) => sum + value, 0);
        total.max += plan.totalMarks;
        totals.set(row.studentId, total);
      }
      classAveragePercentage = mean([...totals.values()].map((total) => percent(total.obtained, total.max)));
    }
    return { exam, overall, subjects, classAveragePercentage, subjectAverages };
  });
}

/** Attendance, co-scholastic grades and the remark of one released exam. */
export async function releasedExamExtras(db: DatabaseExecutor, cadet: Cadet, exam: CadetExam) {
  const { record } = exam;
  const [assessment] = await db
    .select({ daysAttended: examStudentAssessmentTable.daysAttended, coScholastics: examStudentAssessmentTable.coScholastics })
    .from(examStudentAssessmentTable)
    .where(
      and(
        eq(examStudentAssessmentTable.schoolId, cadet.schoolId),
        eq(examStudentAssessmentTable.sessionId, record.sessionId),
        eq(examStudentAssessmentTable.examSlug, exam.examSlug),
        eq(examStudentAssessmentTable.studentId, record.studentId),
      ),
    )
    .limit(1);
  const [settings] = await db
    .select({ totalWorkingDays: examAssessmentSettingsTable.totalWorkingDays })
    .from(examAssessmentSettingsTable)
    .where(
      and(
        eq(examAssessmentSettingsTable.schoolId, cadet.schoolId),
        eq(examAssessmentSettingsTable.sessionId, record.sessionId),
        eq(examAssessmentSettingsTable.examSlug, exam.examSlug),
      ),
    )
    .limit(1);
  const remarks = await loadRemarks(db, cadet, [exam]);
  const areas = record.sessionConfig.coScholasticAreas;
  return {
    attendance:
      assessment?.daysAttended !== null && assessment?.daysAttended !== undefined && settings?.totalWorkingDays
        ? { daysAttended: assessment.daysAttended, totalWorkingDays: settings.totalWorkingDays }
        : null,
    coScholastics: Object.entries(assessment?.coScholastics ?? {})
      .sort(([a], [b]) => Object.keys(areas).indexOf(a) - Object.keys(areas).indexOf(b))
      .map(([slug, grade]) => ({ area: areas[slug]?.name ?? slug, grade })),
    remark: remarks[0]?.remark ?? null,
  };
}

/** Remarks of the given exams; callers pass released exams only. */
export async function loadRemarks(db: DatabaseExecutor, cadet: Cadet, exams: CadetExam[]) {
  const released = exams.filter((exam) => exam.state === 'released');
  if (!released.length) return [];
  const studentIds = [...new Set(released.map((exam) => exam.record.studentId))];
  const rows = await db
    .select({
      sessionId: examStudentRemarkTable.sessionId,
      examSlug: examStudentRemarkTable.examSlug,
      studentId: examStudentRemarkTable.studentId,
      text: examStudentRemarkTable.text,
      authorName: user.name,
      updatedAt: examStudentRemarkTable.updatedAt,
    })
    .from(examStudentRemarkTable)
    .leftJoin(user, eq(user.id, examStudentRemarkTable.authorId))
    .where(and(eq(examStudentRemarkTable.schoolId, cadet.schoolId), inArray(examStudentRemarkTable.studentId, studentIds)));
  return released.flatMap((exam) => {
    const row = rows.find(
      (item) => item.sessionId === exam.record.sessionId && item.examSlug === exam.examSlug && item.studentId === exam.record.studentId,
    );
    return row ? [{ exam, remark: { text: row.text, authorName: row.authorName ?? null, updatedAt: row.updatedAt } }] : [];
  });
}
