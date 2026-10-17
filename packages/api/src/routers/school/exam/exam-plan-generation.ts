import { createHash } from 'node:crypto';
import type { DatabaseExecutor } from '@campuspilot/db';
import { admissionTable } from '@campuspilot/db/schema/admission';
import { studentTable } from '@campuspilot/db/schema/student';
import { classTable } from '@campuspilot/db/schema/class';
import { examPlanTable } from '@campuspilot/db/schema/exam';
import { and, asc, count, eq } from 'drizzle-orm';
import { rpcError, toRpcError } from '../../../errors';
import { getExam, resolveModeConfig, type ExamScope } from './exam.service';

/** Preview and creation share one derivation. Class configuration defines the
 * entire initial plan; creation never accepts client-authored marks or modes.
 * Empty classes are shown and skipped; invalid configured subjects block all writes.
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
  const totalMarks = 100;
  const plans: Array<typeof examPlanTable.$inferInsert> = [];
  const overview = classes.map((schoolClass) => ({
    classId: schoolClass.id,
    label: schoolClass.label,
    studentCount:
      studentCounts.find((item) => item.classId === schoolClass.id)?.value ?? 0,
    subjects: Object.entries(schoolClass.config.subjects).map(
      ([subjectSlug, subject]) => {
        let issue: string | null = null;
        try {
          const modeConfig = resolveModeConfig(totalMarks, subject.examModes);
          plans.push({
            ...scope,
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

export function assertCreatableExamPlan(
  prepared: Awaited<ReturnType<typeof prepareExamPlan>>,
  version: string,
) {
  if (prepared.preview.existingPlanCount > 0)
    throw rpcError.conflict(
      'An exam plan already exists. Existing plans and results have been preserved.',
    );
  if (prepared.preview.configurationVersion !== version)
    throw rpcError.conflict(
      'Class or subject configuration has changed. Review the updated plan overview before creating it.',
    );
  for (const schoolClass of prepared.preview.classes)
    for (const subject of schoolClass.subjects) {
      if (subject.issue)
        throw rpcError.badRequest(
          `${schoolClass.label} · ${subject.name}: ${subject.issue}`,
        );
    }
  if (!prepared.plans.length)
    throw rpcError.badRequest(
      'Configure at least one class subject and its assessment modes before creating an exam plan.',
    );
}
