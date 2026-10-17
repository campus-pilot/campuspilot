import type { DatabaseExecutor, DatabaseTransaction } from '@campuspilot/db';
import { admissionTable } from '@campuspilot/db/schema/admission';
import { sectionTable } from '@campuspilot/db/schema/class';
import {
  examPlanTable,
  examResultTable,
  examStudentAssessmentTable,
  examAssessmentSettingsTable,
} from '@campuspilot/db/schema/exam';
import { studentTable } from '@campuspilot/db/schema/student';
import { and, asc, eq, ilike, sql } from 'drizzle-orm';
import type { z } from 'zod';
import type * as dto from './exam.dto';
import {
  getExam,
  getExamClass,
  requireActivePlan,
  requireStartedExam,
  requireRevisionPermission,
  persistExamResults,
  requireRegisteredExamStudents,
  validateResultMarks,
} from './exam.service';
import { rpcError } from '../../../errors';

import { examWhere, assessmentWhere, settingsWhere } from './exam.scope';

export function studentWhere(
  scope: z.infer<typeof dto.examClassScopeSchema>,
  filters?: { sectionId?: string },
  searchQuery?: string,
) {
  return and(
    eq(studentTable.schoolId, scope.schoolId),
    eq(studentTable.sessionId, scope.sessionId),
    eq(studentTable.classId, scope.classId),
    eq(admissionTable.schoolId, scope.schoolId),
    eq(admissionTable.registered, true),
    filters?.sectionId
      ? eq(studentTable.sectionId, filters.sectionId)
      : undefined,
    searchQuery
      ? ilike(
          admissionTable.name,
          `%${searchQuery.replace(/[\\%_]/g, '\\$&')}%`,
        )
      : undefined,
  );
}
/** Counts use the exam's saved subject snapshots, never today's subject count. */
export function studentQuery(
  db: DatabaseExecutor,
  scope: z.infer<typeof dto.examClassScopeSchema>,
) {
  const resultCount = (approved: boolean) =>
    sql<number>`(select count(*)::int from ${examResultTable} inner join ${examPlanTable} on ${examPlanTable.id} = ${examResultTable.examPlanId} where ${examResultTable.studentId} = ${studentTable.id} and ${examWhere(scope)} and ${examPlanTable.classId} = ${studentTable.classId} ${approved ? sql`and ${examResultTable.approved} = true` : sql``})`.mapWith(
      Number,
    );
  return db
    .select({
      studentId: studentTable.id,
      name: admissionTable.name,
      admissionNo: admissionTable.admissionNo,
      rollNo: studentTable.rollNo,
      sectionId: studentTable.sectionId,
      sectionLabel: sectionTable.label,
      savedSubjects: resultCount(false),
      approvedSubjects: resultCount(true),
      subjectCount:
        sql<number>`(select count(*)::int from ${examPlanTable} where ${examWhere(scope)} and ${examPlanTable.classId} = ${studentTable.classId})`.mapWith(
          Number,
        ),
      assessmentApproved: sql<boolean>`coalesce(${examStudentAssessmentTable.approved}, false)`,
    })
    .from(studentTable)
    .innerJoin(admissionTable, eq(admissionTable.id, studentTable.admissionId))
    .leftJoin(
      sectionTable,
      and(
        eq(sectionTable.id, studentTable.sectionId),
        eq(sectionTable.classId, scope.classId),
        eq(sectionTable.schoolId, scope.schoolId),
      ),
    )
    .leftJoin(
      examStudentAssessmentTable,
      and(
        assessmentWhere(scope),
        eq(examStudentAssessmentTable.studentId, studentTable.id),
      ),
    );
}
export async function studentWorkspace(
  db: DatabaseExecutor,
  scope: z.infer<typeof dto.examStudentScopeSchema>,
) {
  const { session, exam } = await getExam(db, scope);
  const schoolClass = await getExamClass(db, scope.schoolId, scope.classId);
  const [student] = await studentQuery(db, scope).where(
    and(studentWhere(scope), eq(studentTable.id, scope.studentId)),
  );
  if (!student)
    throw rpcError.notFound('Registered student in this class and session');
  const subjects = await db
    .select({ plan: examPlanTable, result: examResultTable })
    .from(examPlanTable)
    .leftJoin(
      examResultTable,
      and(
        eq(examResultTable.examPlanId, examPlanTable.id),
        eq(examResultTable.studentId, scope.studentId),
      ),
    )
    .where(and(examWhere(scope), eq(examPlanTable.classId, scope.classId)))
    .orderBy(asc(examPlanTable.subjectSlug), asc(examPlanTable.id));
  if (!subjects.length) throw rpcError.notFound('Exam plan for this class');
  const [assessment] = await db
    .select()
    .from(examStudentAssessmentTable)
    .where(
      and(
        assessmentWhere(scope),
        eq(examStudentAssessmentTable.studentId, scope.studentId),
      ),
    );
  const [settings] = await db
    .select()
    .from(examAssessmentSettingsTable)
    .where(settingsWhere(scope));
  return {
    student,
    className: schoolClass.label,
    subjects,
    assessment: assessment ?? null,
    totalWorkingDays: settings?.totalWorkingDays ?? null,
    context: {
      exam,
      classes: [
        {
          id: schoolClass.id,
          label: schoolClass.label,
          subjects: schoolClass.config.subjects,
        },
      ],
      coScholasticAreas: session.config.coScholasticAreas,
      attendanceTracking: session.config.attendanceTracking,
    },
  };
}
/** The session is locked first and subject plans in ID order. A student's entire
 * exam is saved atomically, including an explicit approval decision for both the
 * subject scores and their single attendance/activity record. Legacy subject
 * metadata is preserved verbatim, not silently reinterpreted as shared data.
 */
export async function saveStudentExam(
  tx: DatabaseTransaction,
  input: z.infer<typeof dto.saveStudentExamInputSchema>,
  canRevise: boolean,
) {
  await getExam(tx, input, 'share');
  await requireStartedExam(tx, input);
  const plans = await tx
    .select()
    .from(examPlanTable)
    .where(and(examWhere(input), eq(examPlanTable.classId, input.classId)))
    .orderBy(asc(examPlanTable.id))
    .for('update');
  if (!plans.length) throw rpcError.notFound('Exam plan for this class');
  if (
    plans.length !== input.subjects.length ||
    plans.some(
      (plan) => !input.subjects.some((row) => row.examPlanId === plan.id),
    )
  )
    throw rpcError.badRequest(
      'Include every subject in this class exam exactly once. Refresh if the plan has changed.',
    );
  for (const plan of plans) requireActivePlan(plan);
  const workspace = await studentWorkspace(tx, input);
  requireRevisionPermission(workspace.assessment?.approved ?? false, canRevise);
  const { context, totalWorkingDays } = workspace;
  if (
    input.daysAttended !== null &&
    (!context.attendanceTracking.enabled ||
      totalWorkingDays === null ||
      input.daysAttended > totalWorkingDays)
  )
    throw rpcError.badRequest(
      'Attendance requires session tracking and configured exam working days, and cannot exceed working days.',
    );
  for (const slug of Object.keys(input.coScholastics ?? {}))
    if (!Object.hasOwn(context.coScholasticAreas, slug))
      throw rpcError.badRequest(`Unknown co-scholastic area: ${slug}.`);
  await requireRegisteredExamStudents(tx, input, [input.studentId]);
  const subjects = new Map(input.subjects.map((row) => [row.examPlanId, row]));
  const previous = new Map(
    workspace.subjects.map((row) => [row.plan.id, row.result]),
  );
  for (const plan of plans) {
    validateResultMarks(plan, subjects.get(plan.id)!.marks);
    requireRevisionPermission(
      previous.get(plan.id)?.approved ?? false,
      canRevise,
    );
  }
  await persistExamResults(
    tx,
    plans.map((plan) => ({
      examPlanId: plan.id,
      schoolId: input.schoolId,
      sessionId: input.sessionId,
      studentId: input.studentId,
      marks: subjects.get(plan.id)!.marks,
      approved: input.approved,
    })),
    'preserve',
  );
  await tx
    .insert(examStudentAssessmentTable)
    .values({
      schoolId: input.schoolId,
      sessionId: input.sessionId,
      examSlug: input.examSlug,
      studentId: input.studentId,
      daysAttended: input.daysAttended,
      coScholastics: input.coScholastics,
      approved: input.approved,
    })
    .onConflictDoUpdate({
      target: [
        examStudentAssessmentTable.sessionId,
        examStudentAssessmentTable.examSlug,
        examStudentAssessmentTable.studentId,
      ],
      set: {
        daysAttended: input.daysAttended,
        coScholastics: input.coScholastics,
        approved: input.approved,
        updatedAt: new Date(),
      },
    });
  return studentWorkspace(tx, input);
}
