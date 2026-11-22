import { createHash } from 'node:crypto';
import type { DatabaseExecutor } from '@campuspilot/db';
import { admissionTable } from '@campuspilot/db/schema/admission';
import { studentTable } from '@campuspilot/db/schema/student';
import { classTable } from '@campuspilot/db/schema/class';
import { examClassTable, examPlanTable } from '@campuspilot/db/schema/exam';
import { subjectsOfferedInExam } from '@campuspilot/db/schema/jsonb/class-config';
import { and, asc, count, eq } from 'drizzle-orm';
import { rpcError, toRpcError } from '../../../errors';
import { getExam, resolveModeConfig, type ExamScope } from './exam.service';
import { selectableExamClassIds } from './exam.dto';

/** Preview, creation and later class changes share one derivation. Class
 * configuration defines each class's subject plans; creation never accepts
 * client-authored marks or modes. Every school class is previewed with whether
 * it currently takes part (`participating`, read from `exam_class`); which
 * classes take part is chosen separately by the caller (see
 * {@link selectExamClassPlans}). Only the subjects offered in this examination
 * are listed (`isSubjectOfferedInExam`: classroom subjects, and subjects added
 * only for this examination); a subject added only for another examination is
 * not a candidate here. The configuration version covers the classes, their
 * offered subjects and modes and their participation, so a review goes stale
 * when any of them changes. Each subject also says whether it has its plan in
 * this exam (`planned`), which the version covers too, so a plan added or
 * removed meanwhile makes a review stale.
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
  // Whether each subject already has its plan in this exam: the fact that the
  // subject takes part, read from `exam_plan`, never from the selection.
  const plannedRows = await db
    .select({ classId: examPlanTable.classId, subjectSlug: examPlanTable.subjectSlug })
    .from(examPlanTable)
    .where(
      and(
        eq(examPlanTable.schoolId, scope.schoolId),
        eq(examPlanTable.sessionId, scope.sessionId),
        eq(examPlanTable.examSlug, scope.examSlug),
      ),
    );
  const planned = new Set(plannedRows.map((row) => `${row.classId}\u0000${row.subjectSlug}`));
  const totalMarks = 100;
  const plans: Array<ExamPlanInsert> = [];
  const overview = classes.map((schoolClass) => ({
    classId: schoolClass.id,
    label: schoolClass.label,
    studentCount:
      studentCounts.find((item) => item.classId === schoolClass.id)?.value ?? 0,
    participating: participating.has(schoolClass.id),
    subjects: Object.entries(subjectsOfferedInExam(schoolClass.config.subjects, scope)).map(
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
          planned: planned.has(`${schoolClass.id}\u0000${subjectSlug}`),
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

/** Per class ID, the subject slugs chosen to get a plan (`examSubjectSelectionSchema`). */
export type ExamSubjectSelection = Readonly<Record<string, readonly string[]>>;

/**
 * Validates a set of classes chosen to take part and returns the subject plans
 * to create for them, in preview order. Each class must belong to the school
 * and have at least one subject offered in the examination (a class with
 * nothing to examine cannot take part).
 *
 * `subjects` chooses, per class, which offered subjects get a plan; a chosen
 * class missing from it plans every offered subject (the behaviour before
 * subjects could be chosen). A choice must name offered subjects of that
 * class, at least one, and only classes in `classIds`. Every chosen subject
 * must have valid modes; problems in subjects or classes that were not chosen
 * do not block anything.
 */
export function selectExamClassPlans(
  prepared: PreparedExamPlan,
  classIds: readonly string[],
  subjects: ExamSubjectSelection = {},
): ExamPlanInsert[] {
  const chosen = new Set(classIds);
  const known = new Set(prepared.preview.classes.map((entry) => entry.classId));
  if (classIds.some((classId) => !known.has(classId)))
    throw rpcError.badRequest(
      'Every selected class must be a class of this school.',
    );
  if (Object.keys(subjects).some((classId) => !chosen.has(classId)))
    throw rpcError.badRequest(
      'Subjects were chosen for a class that does not join the examination in this change.',
    );
  const chosenSubjects = new Map<string, Set<string>>();
  for (const schoolClass of prepared.preview.classes) {
    if (!chosen.has(schoolClass.classId)) continue;
    if (!schoolClass.subjects.length)
      throw rpcError.badRequest(
        `${schoolClass.label} has no subjects configured, so it cannot take part. Deselect it or add subjects in class settings.`,
      );
    const wanted = Object.hasOwn(subjects, schoolClass.classId)
      ? subjects[schoolClass.classId]!
      : schoolClass.subjects.map((subject) => subject.subjectSlug);
    if (!wanted.length)
      throw rpcError.badRequest(`${schoolClass.label}: select at least one subject.`);
    if (wanted.some((slug) => !schoolClass.subjects.some((subject) => subject.subjectSlug === slug)))
      throw rpcError.badRequest(
        `${schoolClass.label}: every selected subject must be a subject offered in this examination.`,
      );
    for (const subject of schoolClass.subjects)
      if (wanted.includes(subject.subjectSlug) && subject.issue)
        throw rpcError.badRequest(
          `${schoolClass.label} · ${subject.name}: ${subject.issue}`,
        );
    chosenSubjects.set(schoolClass.classId, new Set(wanted));
  }
  return prepared.plans.filter((plan) => chosenSubjects.get(plan.classId)?.has(plan.subjectSlug));
}

/**
 * The subject plans to add and remove for classes that already take part,
 * from the subjects chosen for them (`updateExamClasses`). For each class in
 * `subjects`, the chosen slugs must be subjects offered in this exam; a
 * chosen subject without a plan gets one (its modes must be valid), and a
 * planned subject left out loses its plan (the caller applies the removal
 * guards). A subject with a plan that is no longer offered is not listed in
 * the review and stays as it is. Classes not in `subjects` keep their plans.
 */
export function selectSubjectPlanChanges(
  prepared: PreparedExamPlan,
  subjects: ExamSubjectSelection,
): { add: ExamPlanInsert[]; remove: Array<{ classId: string; subjectSlug: string; label: string; name: string }> } {
  const add: ExamPlanInsert[] = [];
  const remove: Array<{ classId: string; subjectSlug: string; label: string; name: string }> = [];
  for (const schoolClass of prepared.preview.classes) {
    if (!Object.hasOwn(subjects, schoolClass.classId)) continue;
    const wanted = subjects[schoolClass.classId]!;
    if (!wanted.length)
      throw rpcError.badRequest(`${schoolClass.label}: select at least one subject.`);
    if (wanted.some((slug) => !schoolClass.subjects.some((subject) => subject.subjectSlug === slug)))
      throw rpcError.badRequest(
        `${schoolClass.label}: every selected subject must be a subject offered in this examination.`,
      );
    for (const subject of schoolClass.subjects) {
      const chosen = wanted.includes(subject.subjectSlug);
      if (chosen && !subject.planned) {
        if (subject.issue)
          throw rpcError.badRequest(`${schoolClass.label} · ${subject.name}: ${subject.issue}`);
        const plan = prepared.plans.find((entry) => entry.classId === schoolClass.classId && entry.subjectSlug === subject.subjectSlug);
        if (plan) add.push(plan);
      }
      if (!chosen && subject.planned)
        remove.push({ classId: schoolClass.classId, subjectSlug: subject.subjectSlug, label: schoolClass.label, name: subject.name });
    }
  }
  return { add, remove };
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
  subjects?: ExamSubjectSelection,
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
    subjects,
  );
  if (!plans.length)
    throw rpcError.badRequest(
      'Configure at least one class subject and its assessment modes before creating an exam plan.',
    );
  return plans;
}
