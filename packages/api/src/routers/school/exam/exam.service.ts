import type { DatabaseExecutor, DatabaseTransaction } from '@campuspilot/db';
import { classTable } from '@campuspilot/db/schema/class';
import { admissionTable } from '@campuspilot/db/schema/admission';
import {
  examPlanTable,
  examResultTable,
  examLifecycleTable,
} from '@campuspilot/db/schema/exam';
import { schoolSessionTable } from '@campuspilot/db/schema/session';
import { studentTable } from '@campuspilot/db/schema/student';
import { sessionConfigSchema } from '@campuspilot/db/schema/jsonb/session-config';
import {
  modeConfigSchema,
  type ModeConfig,
} from '@campuspilot/db/schema/jsonb/exam-config';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { rpcError } from '../../../errors';
import type {
  examScopeSchema,
  planScopeSchema,
  resultValuesSchema,
} from './exam.dto';

type SessionScope = { schoolId: string; sessionId: string };
export type ExamScope = z.infer<typeof examScopeSchema>;
export type PlanScope = z.infer<typeof planScopeSchema>;

/** All exam mutations lock the session before the plan. Definition/timetable
 * changes take an exclusive session lock, preventing references from changing
 * between validation and commit. Historical sessions remain readable.
 */
export async function getExamSession(
  db: DatabaseExecutor,
  scope: SessionScope,
  lock?: 'share' | 'update',
) {
  const query = db
    .select()
    .from(schoolSessionTable)
    .where(
      and(
        eq(schoolSessionTable.schoolId, scope.schoolId),
        eq(schoolSessionTable.id, scope.sessionId),
      ),
    )
    .limit(1);
  const [session] = await (lock ? query.for(lock) : query);
  if (!session) throw rpcError.notFound('School session');
  if (lock && !session.isActive)
    throw rpcError.badRequest(
      'Only the active academic session can be modified.',
    );
  return {
    ...session,
    config: sessionConfigSchema.parse(session.sessionConfig ?? {}),
  };
}
export async function getExam(
  db: DatabaseExecutor,
  scope: ExamScope,
  lock?: 'share' | 'update',
) {
  const session = await getExamSession(db, scope, lock);
  const exam = Object.hasOwn(session.config.examConfig, scope.examSlug)
    ? session.config.examConfig[scope.examSlug]
    : undefined;
  if (!exam) throw rpcError.notFound('Exam');
  return { session, exam: { slug: scope.examSlug, ...exam } };
}
export async function getPlan(
  db: DatabaseExecutor,
  scope: PlanScope,
  lock = false,
) {
  const session = await getExamSession(db, scope, lock ? 'share' : undefined);
  const query = db
    .select()
    .from(examPlanTable)
    .where(
      and(
        eq(examPlanTable.id, scope.examPlanId),
        eq(examPlanTable.schoolId, scope.schoolId),
        eq(examPlanTable.sessionId, scope.sessionId),
        eq(examPlanTable.classId, scope.classId),
      ),
    )
    .limit(1);
  const [plan] = await (lock ? query.for('update') : query);
  if (!plan) throw rpcError.notFound('Exam plan');
  return { plan, session };
}
export async function getExamClass(
  db: DatabaseExecutor,
  schoolId: string,
  classId: string,
) {
  const [schoolClass] = await db
    .select()
    .from(classTable)
    .where(and(eq(classTable.id, classId), eq(classTable.schoolId, schoolId)))
    .limit(1);
  if (!schoolClass) throw rpcError.notFound('Class');
  return schoolClass;
}

/** Maximum marks must be exact integers; silently rounding would change the
 * declared percentage weights. The saved plan snapshots the configured modes.
 */
export function resolveModeConfig(
  totalMarks: number,
  modes: Record<string, { percentage: number }>,
  override?: ModeConfig,
) {
  const config =
    override ??
    Object.fromEntries(
      Object.entries(modes).map(([slug, mode]) => [
        slug,
        {
          percentage: mode.percentage,
          maxMarks: (totalMarks * mode.percentage) / 100,
        },
      ]),
    );
  const parsed = modeConfigSchema.safeParse(config);
  if (!parsed.success)
    throw rpcError.badRequest(
      'Exam modes must total 100% and produce whole-number maximum marks. Adjust the total marks or percentages.',
    );
  for (const [slug, mode] of Object.entries(config)) {
    if (!Object.hasOwn(modes, slug))
      throw rpcError.badRequest(`Unknown exam mode: ${slug}.`);
    if (
      Math.abs(mode.maxMarks - (totalMarks * mode.percentage) / 100) > 0.000001
    )
      throw rpcError.badRequest(
        `Maximum marks for ${slug} must equal total marks × percentage / 100.`,
      );
  }
  return parsed.data;
}
export function requireActivePlan(plan: typeof examPlanTable.$inferSelect) {
  if (plan.status !== 'active')
    throw rpcError.badRequest(
      'Results can only be changed while the exam plan is active.',
    );
}
/** Every result mutation requires the explicit examination start in addition to
 * its subject lock, including legacy single-subject APIs.
 */
export async function requireStartedExam(
  db: DatabaseExecutor,
  scope: ExamScope,
) {
  const [lifecycle] = await db
    .select()
    .from(examLifecycleTable)
    .where(
      and(
        eq(examLifecycleTable.schoolId, scope.schoolId),
        eq(examLifecycleTable.sessionId, scope.sessionId),
        eq(examLifecycleTable.examSlug, scope.examSlug),
      ),
    );
  if (lifecycle?.status !== 'active')
    throw rpcError.badRequest(
      'Start the examination before entering or approving results. Completed examinations must be reopened by the principal, manager or exam coordinator.',
    );
}
export function requireRevisionPermission(
  approved: boolean,
  canRevise: boolean,
) {
  if (approved && !canRevise)
    throw rpcError.forbidden(
      'This result is already approved. Only an exam coordinator, principal, or manager can change or delete it.',
    );
}
/** Academic marks are validated separately from legacy per-subject metadata. */
export function validateResultMarks(
  plan: typeof examPlanTable.$inferSelect,
  marks: z.infer<typeof resultValuesSchema>['marks'],
) {
  const modes = Object.keys(plan.modeConfig);
  if (
    modes.length !== Object.keys(marks).length ||
    modes.some((slug) => !Object.hasOwn(marks, slug))
  )
    throw rpcError.badRequest(
      'Marks must include exactly the exam plan’s assessment modes.',
    );
  for (const slug of modes)
    if (marks[slug]! > plan.modeConfig[slug]!.maxMarks)
      throw rpcError.badRequest(
        `Marks for ${slug} cannot exceed ${plan.modeConfig[slug]!.maxMarks}.`,
      );
}
export function validateResult(
  plan: typeof examPlanTable.$inferSelect,
  config: ReturnType<typeof sessionConfigSchema.parse>,
  row: z.infer<typeof resultValuesSchema>,
) {
  validateResultMarks(plan, row.marks);
  for (const area of Object.keys(row.coScholastics ?? {}))
    if (!Object.hasOwn(config.coScholasticAreas, area))
      throw rpcError.badRequest(`Unknown co-scholastic area: ${area}.`);
  if (row.daysAttended !== null) {
    if (!config.attendanceTracking.enabled)
      throw rpcError.badRequest(
        'Attendance tracking is disabled for this session.',
      );
    if (plan.totalWorkingDays === null)
      throw rpcError.badRequest(
        'Set the plan’s total working days before recording attendance.',
      );
    if (row.daysAttended > plan.totalWorkingDays)
      throw rpcError.badRequest(
        'Days attended cannot exceed total working days.',
      );
  }
}

/** One plan lock serializes marks writes, reviews, deletion and completion.
 * Batches are atomic, and approval is an explicit field rather than a role
 * inferred side effect. Saving without approval clears any previous approval.
 */
export async function saveResults(
  tx: DatabaseTransaction,
  scope: PlanScope,
  rows: z.infer<typeof resultValuesSchema>[],
  canRevise: boolean,
) {
  const { plan, session } = await getPlan(tx, scope, true);
  await requireStartedExam(tx, plan);
  requireActivePlan(plan);
  const studentIds = rows.map((row) => row.studentId);
  await requireRegisteredExamStudents(tx, scope, studentIds);
  const existing = await tx
    .select()
    .from(examResultTable)
    .where(
      and(
        eq(examResultTable.examPlanId, plan.id),
        inArray(examResultTable.studentId, studentIds),
      ),
    );
  for (const row of existing)
    requireRevisionPermission(row.approved, canRevise);
  for (const row of rows) validateResult(plan, session.config, row);
  return persistExamResults(
    tx,
    rows.map((row) => ({
      ...row,
      examPlanId: plan.id,
      schoolId: plan.schoolId,
      sessionId: plan.sessionId,
    })),
    'replace',
  );
}

/** Placement and registration stay locked through the result write. Call after
 * locking the session and all affected plans, always in deterministic order.
 */
export async function requireRegisteredExamStudents(
  tx: DatabaseTransaction,
  scope: SessionScope & { classId: string },
  studentIds: string[],
) {
  const students = await tx
    .select({ id: studentTable.id })
    .from(studentTable)
    .innerJoin(
      admissionTable,
      and(
        eq(admissionTable.id, studentTable.admissionId),
        eq(admissionTable.schoolId, scope.schoolId),
      ),
    )
    .where(
      and(
        eq(studentTable.schoolId, scope.schoolId),
        eq(studentTable.sessionId, scope.sessionId),
        eq(studentTable.classId, scope.classId),
        inArray(studentTable.id, studentIds),
        eq(admissionTable.registered, true),
      ),
    )
    .orderBy(asc(studentTable.id))
    .for('share', { of: [studentTable, admissionTable] });
  if (students.length !== studentIds.length)
    throw rpcError.badRequest(
      'Every result must belong to a registered student enrolled in this plan’s school, session, and class.',
    );
}

/** Both result workflows use one bulk upsert. Student-wide saves change academic
 * scores only, leaving historical per-subject attendance and activities untouched.
 * Compatibility saves explicitly replace that metadata from their own payload.
 */
export function persistExamResults(
  tx: DatabaseTransaction,
  rows: Array<typeof examResultTable.$inferInsert>,
  metadata: 'preserve' | 'replace',
) {
  return tx
    .insert(examResultTable)
    .values(rows)
    .onConflictDoUpdate({
      target: [examResultTable.examPlanId, examResultTable.studentId],
      set: {
        marks: sqlExcluded('marks'),
        approved: sqlExcluded('approved'),
        updatedAt: new Date(),
        ...(metadata === 'replace'
          ? {
              coScholastics: sqlExcluded('co_scholastics'),
              daysAttended: sqlExcluded('days_attended'),
            }
          : {}),
      },
    })
    .returning();
}
/** Column names are a private allowlist supplied only by the implementation. */
function sqlExcluded(
  column: 'marks' | 'co_scholastics' | 'days_attended' | 'approved',
) {
  return sql.raw(`excluded.${column}`);
}
