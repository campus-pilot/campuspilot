import { createHash } from 'node:crypto';
import type { DatabaseExecutor } from '@campuspilot/db';
import { admissionTable } from '@campuspilot/db/schema/admission';
import { studentTable } from '@campuspilot/db/schema/student';
import { classTable } from '@campuspilot/db/schema/class';
import { examClassTable, examPlanTable } from '@campuspilot/db/schema/exam';
import { and, asc, count, eq } from 'drizzle-orm';
import { rpcError, toRpcError } from '../../../errors';
import { getExam, resolveModeConfig, type ExamScope } from './exam.service';
import { selectableExamClassIds } from './exam.dto';

/** Preview, creation and later class changes share one derivation. Class
 * configuration defines each class's subject plans; creation never accepts
 * client-authored marks or modes. Every school class is previewed with whether
 * it currently takes part (`participating`, read from `exam_class`); which
 * classes take part is chosen separately by the caller (see
 * {@link selectExamClassPlans}). The configuration version covers the classes,
 * their subjects and modes and their participation, so a review goes stale when
 * any of them changes.
 */
export async function prepareExamPlan(
  db: DatabaseExecutor,
  scope: ExamScope,
  lock = false,
) {
  const { exam } = await getExam(db, scope, lock ? 'update' : undefined);
  const query = db
    .select()
    .from(classTable)
    .where(eq(classTable.schoolId, scope.schoolId))
    .orderBy(asc(classTable.displayOrder), asc(classTable.id));
  const classes = await (lock ? query.for('share') : query);
  const [existing] = await db
    .select({ value: count() })
    .from(examPlanTable)
    .where(
      and(
        eq(examPlanTable.schoolId, scope.schoolId),
        eq(examPlanTable.sessionId, scope.sessionId),
        eq(examPlanTable.examSlug, scope.examSlug),
      ),
    );
  const studentCounts = await db
    .select({ classId: studentTable.classId, value: count() })
    .from(studentTable)
    .innerJoin(admissionTable, eq(admissionTable.id, studentTable.admissionId))
    .where(
      and(
        eq(studentTable.schoolId, scope.schoolId),
        eq(studentTable.sessionId, scope.sessionId),
        eq(admissionTable.schoolId, scope.schoolId),
        eq(admissionTable.registered, true),
      ),
    )
    .groupBy(studentTable.classId);
  const participants = await db
    .select({ classId: examClassTable.classId })
    .from(examClassTable)
    .where(
      and(
        eq(examClassTable.schoolId, scope.schoolId),
        eq(examClassTable.sessionId, scope.sessionId),
        eq(examClassTable.examSlug, scope.examSlug),
      ),
    );
  const participating = new Set(participants.map((row) => row.classId));
  const totalMarks = 100;
  const plans: Array<ExamPlanInsert> = [];
  const overview = classes.map((schoolClass) => ({
    classId: schoolClass.id,
    label: schoolClass.label,
    studentCount:
      studentCounts.find((item) => item.classId === schoolClass.id)?.value ?? 0,
    participating: participating.has(schoolClass.id),
    subjects: Object.entries(schoolClass.config.subjects).map(
      ([subjectSlug, subject]) => {
        let issue: string | null = null;
        try {
          const modeConfig = resolveModeConfig(totalMarks, subject.examModes);
          plans.push({
            schoolId: scope.schoolId,
            sessionId: scope.sessionId,
            examSlug: scope.examSlug,
            classId: schoolClass.id,
            subjectSlug,
            totalMarks,
            modeConfig,
            totalWorkingDays: null,
            status: 'draft',
          });
        } catch (error) {
          const failure = toRpcError(error);
          if (failure.code !== 'BAD_REQUEST') throw failure;
          issue = failure.message;
        }
        return {
          subjectSlug,
          name: subject.name,
          issue,
          modes: Object.entries(subject.examModes).map(([slug, mode]) => ({
            slug,
            name: mode.name,
            percentage: mode.percentage,
            maxMarks: (totalMarks * mode.percentage) / 100,
          })),
        };
      },
    ),
  }));
  const planCount = overview.reduce(
    (sum, schoolClass) => sum + schoolClass.subjects.length,
    0,
  );
  // Bind creation to the reviewed configuration, not a timestamp or number of
  // rows. Labels, subject identities, percentages and class membership all matter.
  const configurationVersion = createHash('sha256')
    .update(
      JSON.stringify({
        schoolId: scope.schoolId,
        sessionId: scope.sessionId,
        exam,
        totalMarks,
        classes: overview.map(
          ({ studentCount, ...schoolClass }) => schoolClass,
        ),
      }),
    )
    .digest('hex');
  return {
    preview: {
      totalMarks: 100 as const,
      classes: overview,
      planCount,
      existingPlanCount: existing!.value,
      configurationVersion,
    },
    plans,
  };
}

type ExamPlanInsert = typeof examPlanTable.$inferInsert;
type PreparedExamPlan = Awaited<ReturnType<typeof prepareExamPlan>>;

/**
 * Validates a set of classes chosen to take part and returns the subject plans
 * to create for them, in preview order. Each class must belong to the school
 * and have at least one configured subject (a class with nothing to examine
 * cannot take part), and every subject of a chosen class must have valid modes.
 * Problems in classes that were not chosen do not block anything.
 */
export function selectExamClassPlans(
  prepared: PreparedExamPlan,
  classIds: readonly string[],
): ExamPlanInsert[] {
  const chosen = new Set(classIds);
  const known = new Set(prepared.preview.classes.map((entry) => entry.classId));
  if (classIds.some((classId) => !known.has(classId)))
    throw rpcError.badRequest(
      'Every selected class must be a class of this school.',
    );
  for (const schoolClass of prepared.preview.classes) {
    if (!chosen.has(schoolClass.classId)) continue;
    if (!schoolClass.subjects.length)
      throw rpcError.badRequest(
        `${schoolClass.label} has no subjects configured, so it cannot take part. Deselect it or add subjects in class settings.`,
      );
    for (const subject of schoolClass.subjects)
      if (subject.issue)
        throw rpcError.badRequest(
          `${schoolClass.label} · ${subject.name}: ${subject.issue}`,
        );
  }
  return prepared.plans.filter((plan) => chosen.has(plan.classId));
}

/**
 * The classes a plan generation covers: the caller's list when it sent one,
 * otherwise every class of this review that can take part. Resolved from the
 * same review the configuration version is checked against.
 */
export function resolveExamPlanClassIds(
  prepared: PreparedExamPlan,
  classIds: readonly string[] | undefined,
): string[] {
  return classIds ? [...classIds] : selectableExamClassIds(prepared.preview);
}

/**
 * Checks that the initial plan can be created from this review for the chosen
 * classes and returns their subject plans. Existing plans are never
 * overwritten, and a stale review is refused before the selection is judged.
 * Without `classIds`, every class that can take part is chosen; a school with
 * none then gets the "configure subjects" refusal, not "select a class".
 */
export function assertCreatableExamPlan(
  prepared: PreparedExamPlan,
  version: string,
  classIds: readonly string[] | undefined,
): ExamPlanInsert[] {
  if (prepared.preview.existingPlanCount > 0)
    throw rpcError.conflict(
      'An exam plan already exists. Existing plans and results have been preserved.',
    );
  if (prepared.preview.configurationVersion !== version)
    throw rpcError.conflict(
      'Class or subject configuration has changed. Review the updated plan overview before creating it.',
    );
  if (classIds && !classIds.length)
    throw rpcError.badRequest(
      'Select at least one class to take part in the examination.',
    );
  const plans = selectExamClassPlans(
    prepared,
    resolveExamPlanClassIds(prepared, classIds),
  );
  if (!plans.length)
    throw rpcError.badRequest(
      'Configure at least one class subject and its assessment modes before creating an exam plan.',
    );
  return plans;
}
