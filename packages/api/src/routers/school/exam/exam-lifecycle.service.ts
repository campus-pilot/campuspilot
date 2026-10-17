import type { DatabaseExecutor, DatabaseTransaction } from '@campuspilot/db';
import {
  examLifecycleTable,
  examPlanTable,
  examResultTable,
  examStudentAssessmentTable,
} from '@campuspilot/db/schema/exam';
import { and, asc, count, eq, inArray, isNull, or } from 'drizzle-orm';
import { getExam, type ExamScope } from './exam.service';
import { admissionTable } from '@campuspilot/db/schema/admission';
import { studentTable } from '@campuspilot/db/schema/student';
import type { z } from 'zod';
import type { ExamOverviewDto, examLifecycleInputSchema } from './exam.dto';
import { rpcError } from '../../../errors';
import { examWhere, assessmentWhere, lifecycleWhere } from './exam.scope';

/** Fetch overview facts in two queries for the whole page. Lifecycle remains
 * independent of plan count, including exams without plans or known timestamps.
 */
export async function examOverviews(
  db: DatabaseExecutor,
  scope: Pick<ExamScope, 'schoolId' | 'sessionId'>,
  examSlugs: string[],
) {
  if (!examSlugs.length) return new Map<string, ExamOverviewDto>();
  const [lifecycles, plans] = await Promise.all([
    db
      .select()
      .from(examLifecycleTable)
      .where(
        and(
          eq(examLifecycleTable.schoolId, scope.schoolId),
          eq(examLifecycleTable.sessionId, scope.sessionId),
          inArray(examLifecycleTable.examSlug, examSlugs),
        ),
      ),
    db
      .select({ examSlug: examPlanTable.examSlug, value: count() })
      .from(examPlanTable)
      .where(
        and(
          eq(examPlanTable.schoolId, scope.schoolId),
          eq(examPlanTable.sessionId, scope.sessionId),
          inArray(examPlanTable.examSlug, examSlugs),
        ),
      )
      .groupBy(examPlanTable.examSlug),
  ]);
  const lifecycleBySlug = new Map(lifecycles.map((row) => [row.examSlug, row]));
  const countBySlug = new Map(plans.map((row) => [row.examSlug, row.value]));
  return new Map(
    examSlugs.map((slug) => {
      const lifecycle = lifecycleBySlug.get(slug);
      return [
        slug,
        {
          planCount: countBySlug.get(slug) ?? 0,
          status: lifecycle?.status ?? null,
          startedAt: lifecycle?.startedAt ?? null,
          completedAt: lifecycle?.completedAt ?? null,
        },
      ];
    }),
  );
}

export async function examOverview(db: DatabaseExecutor, scope: ExamScope) {
  return (await examOverviews(db, scope, [scope.examSlug])).get(
    scope.examSlug,
  )!;
}

/** Completion is one exam-wide decision. It includes registered enrollments,
 * every saved score, and shared assessments; reopening preserves approval data.
 */
export async function transitionExam(
  tx: DatabaseTransaction,
  input: z.infer<typeof examLifecycleInputSchema>,
) {
  const { session } = await getExam(tx, input, 'update');
  const plans = await tx
    .select()
    .from(examPlanTable)
    .where(examWhere(input))
    .orderBy(asc(examPlanTable.id))
    .for('update');
  if (!plans.length) throw rpcError.notFound('Exam plan');
  const [lifecycle] = await tx
    .select()
    .from(examLifecycleTable)
    .where(lifecycleWhere(input));
  if (input.status === 'completed') {
    if (lifecycle?.status !== 'active')
      throw rpcError.badRequest('Only a started examination can be completed.');
    if (plans.some((plan) => plan.status !== 'active'))
      throw rpcError.badRequest(
        'All classes must be open for result entry before completing the examination.',
      );
    await requireReviewedExam(
      tx,
      input,
      session.config.attendanceTracking.enabled ||
        Object.keys(session.config.coScholasticAreas).length > 0,
    );
  } else {
    if (
      lifecycle?.status === 'active' &&
      plans.every((plan) => plan.status === 'active')
    )
      throw rpcError.badRequest('Result entry is already open.');
    // Mixed states may exist from the previous per-subject lifecycle. This
    // deliberate school-admin action opens the entire exam without data loss.
  }
  await tx
    .update(examPlanTable)
    .set({ status: input.status, updatedAt: new Date() })
    .where(examWhere(input));
  const now = new Date();
  // Only ready → active establishes a first start. A legacy active/completed
  // examination can have an unknown start time, which reopening must preserve.
  await tx
    .insert(examLifecycleTable)
    .values({
      schoolId: input.schoolId,
      sessionId: input.sessionId,
      examSlug: input.examSlug,
      status: input.status,
      startedAt:
        input.status === 'active' ? now : (lifecycle?.startedAt ?? null),
      completedAt: input.status === 'completed' ? now : null,
    })
    .onConflictDoUpdate({
      target: [examLifecycleTable.sessionId, examLifecycleTable.examSlug],
      set: {
        status: input.status,
        startedAt:
          lifecycle?.status === 'ready' && input.status === 'active'
            ? now
            : (lifecycle?.startedAt ?? null),
        completedAt: input.status === 'completed' ? now : null,
      },
    });
  return { updatedCount: plans.length };
}

/** Completion includes the current registered roster and every saved assessment,
 * including historical rows no longer represented in that roster.
 */
async function requireReviewedExam(
  tx: DatabaseTransaction,
  scope: ExamScope,
  requiresSharedAssessment: boolean,
) {
  const [missing] = await tx
    .select({ id: studentTable.id })
    .from(studentTable)
    .innerJoin(admissionTable, eq(admissionTable.id, studentTable.admissionId))
    .innerJoin(
      examPlanTable,
      and(examWhere(scope), eq(examPlanTable.classId, studentTable.classId)),
    )
    .leftJoin(
      examResultTable,
      and(
        eq(examResultTable.examPlanId, examPlanTable.id),
        eq(examResultTable.studentId, studentTable.id),
      ),
    )
    .leftJoin(
      examStudentAssessmentTable,
      and(
        assessmentWhere(scope),
        eq(examStudentAssessmentTable.studentId, studentTable.id),
      ),
    )
    .where(
      and(
        eq(studentTable.schoolId, scope.schoolId),
        eq(studentTable.sessionId, scope.sessionId),
        eq(admissionTable.registered, true),
        or(
          isNull(examResultTable.id),
          eq(examResultTable.approved, false),
          ...(requiresSharedAssessment
            ? [
                isNull(examStudentAssessmentTable.studentId),
                eq(examStudentAssessmentTable.approved, false),
              ]
            : []),
        ),
      ),
    )
    .limit(1);
  const [unapproved] = await tx
    .select({ id: examResultTable.id })
    .from(examResultTable)
    .innerJoin(examPlanTable, eq(examPlanTable.id, examResultTable.examPlanId))
    .where(and(examWhere(scope), eq(examResultTable.approved, false)))
    .limit(1);
  const [unreviewed] = await tx
    .select()
    .from(examStudentAssessmentTable)
    .where(
      and(
        assessmentWhere(scope),
        eq(examStudentAssessmentTable.approved, false),
      ),
    )
    .limit(1);
  if (missing || unapproved || unreviewed)
    throw rpcError.badRequest(
      'Every registered student needs approved results for all subjects and a reviewed attendance/activity assessment before completing the examination.',
    );
}
