import type { DatabaseExecutor, DatabaseTransaction } from '@campuspilot/db';
import { examKeyPart } from '../question-paper/question-paper.records';
import {
  examClassTable,
  examLifecycleTable,
  examPlanTable,
  examResultTable,
  examStudentAssessmentTable,
  examStudentRemarkTable,
  examTimetableTable,
} from '@campuspilot/db/schema/exam';
import { examQuestionPaperTable } from '@campuspilot/db/schema/exam-question-paper';
import type { TimetableConfig } from '@campuspilot/db/schema/jsonb/exam-config';
import { studentTable } from '@campuspilot/db/schema/student';
import { and, eq, inArray } from 'drizzle-orm';
import type { z } from 'zod';

import { rpcError } from '../../../errors';
import { deleteQuestionPapersOfPlan } from '../question-paper/question-paper.service';
import type { updateExamClassesInputSchema } from './exam.dto';
import { requireNotReleasedToCadet } from './exam-cadet.service';
import { prepareExamPlan, selectExamClassPlans, selectSubjectPlanChanges, type ExamSubjectSelection } from './exam-plan-generation';
import { assessmentWhere, examClassWhere, examWhere, lifecycleWhere } from './exam.scope';
import type { ExamScope } from './exam.service';

type UpdateExamClassesInput = z.infer<typeof updateExamClassesInputSchema>;

/** IDs of the classes taking part in the examination (its `exam_class` rows). */
export async function examClassIds(db: DatabaseExecutor, scope: ExamScope): Promise<string[]> {
  const rows = await db.select({ classId: examClassTable.classId }).from(examClassTable).where(examClassWhere(scope));
  return rows.map((row) => row.classId);
}

/**
 * Records that a class takes part, if it does not already. Used when a legacy
 * single subject plan is created for a class (`createExamPlan`): creating the
 * plan is the explicit act of including the class, so it is held to the same
 * lifecycle rule as adding a class with {@link updateExamClasses}: a class
 * that does not take part yet cannot be added once the examination has ended.
 * A class already taking part may still get further plans, as before. The
 * caller has already refused an examination released to the Cadet Portal.
 */
export async function includeExamClass(tx: DatabaseTransaction, scope: ExamScope, classId: string) {
  const [existing] = await tx
    .select({ classId: examClassTable.classId })
    .from(examClassTable)
    .where(and(examClassWhere(scope), eq(examClassTable.classId, classId)))
    .limit(1);
  if (existing) return;
  await refuseClassChangeWhenCompleted(tx, scope);
  await tx
    .insert(examClassTable)
    .values({ schoolId: scope.schoolId, sessionId: scope.sessionId, examSlug: scope.examSlug, classId })
    .onConflictDoNothing();
}

/**
 * Refuses to change which classes take part once the examination has ended
 * (`exam_lifecycle.status = 'completed'`). Shared by every path that adds or
 * removes a class so the rule cannot drift between them.
 */
async function refuseClassChangeWhenCompleted(tx: DatabaseTransaction, scope: ExamScope) {
  const [lifecycle] = await tx.select({ status: examLifecycleTable.status }).from(examLifecycleTable).where(lifecycleWhere(scope)).limit(1);
  if (lifecycle?.status === 'completed')
    throw rpcError.badRequest('This examination has ended, so the classes taking part can no longer change. Reopen it first.');
  return lifecycle;
}

/**
 * Records the classes chosen when the plan is generated as exactly the classes
 * taking part. Generating is the explicit choice of classes, so a class still
 * recorded from before (for example after its last single subject plan was
 * deleted) that is not chosen now stops taking part, under the same refusals
 * as removing it later ({@link updateExamClasses}); a chosen class already
 * recorded is kept. The caller has already refused an examination with plans.
 */
export async function recordGeneratedExamClasses(
  tx: DatabaseTransaction,
  scope: ExamScope,
  classIds: string[],
  labels: Map<string, string>,
) {
  const stale = (await examClassIds(tx, scope)).filter((classId) => !classIds.includes(classId));
  if (stale.length) await removeExamClasses(tx, scope, stale, labels);
  await tx
    .insert(examClassTable)
    .values(classIds.map((classId) => ({ schoolId: scope.schoolId, sessionId: scope.sessionId, examSlug: scope.examSlug, classId })))
    .onConflictDoNothing();
}

/**
 * Whether the caller may create and delete exam plans in the input's school,
 * resolved before the handler. `updateExamClasses` requires each only when
 * the change does it.
 */
export type ExamPlanChangePermission = { canCreate: boolean; canDelete: boolean };

/** The entries of `subjects` whose class ID is in `classIds`. */
function choiceFor(subjects: ExamSubjectSelection, classIds: readonly string[]): ExamSubjectSelection {
  return Object.fromEntries(Object.entries(subjects).filter(([classId]) => classIds.includes(classId)));
}

/**
 * Changes which classes take part in an examination whose plan already exists,
 * to exactly `input.classIds`, and optionally which subjects of the classes
 * that keep taking part have plans, atomically.
 *
 * - The examination must not have ended or be released to the Cadet Portal,
 *   and the review (`configurationVersion` from `getExamPlanPreview`, which
 *   covers participation and each subject's `planned` too) must be current.
 * - An **added** class gets its subject plans from its class settings exactly
 *   as at generation (100 marks, configured modes), for its subjects offered
 *   in this examination or only those chosen in `input.subjects`. They open for result entry
 *   at once when the examination has started (`active`), as starting does for
 *   every plan; otherwise they are drafts.
 * - A **kept** class in `input.subjects` gets a plan for each chosen subject
 *   without one (same rules as an added class) and loses the plan of each
 *   planned subject left out, under {@link removeExamSubjectPlans}. A kept
 *   class left out of `input.subjects` keeps its plans unchanged.
 * - A **removed** class is refused while anything recorded for it in this
 *   examination would be lost or left behind: saved results, shared
 *   attendance/activity assessments or remarks of its students, question
 *   papers, a published timetable that includes it, or a draft timetable that
 *   schedules papers for it. A draft timetable column with nothing scheduled
 *   is dropped with the class. Its plans and participation are then deleted.
 *
 * Returns the stored objects of deleted question paper rows (always none
 * today, because papers block removal) for removal after the commit.
 */
export async function updateExamClasses(tx: DatabaseTransaction, input: UpdateExamClassesInput, permission: ExamPlanChangePermission) {
  // Locks the session exclusively (serialising result saves, timetable writes
  // and generation) and the school's class rows for share.
  const prepared = await prepareExamPlan(tx, input, true);
  const labels = new Map(prepared.preview.classes.map((entry) => [entry.classId, entry.label]));
  const current = prepared.preview.classes.filter((entry) => entry.participating).map((entry) => entry.classId);
  if (!current.length) throw rpcError.badRequest('Create the exam plan before changing which classes take part.');
  await requireNotReleasedToCadet(tx, input);
  const lifecycle = await refuseClassChangeWhenCompleted(tx, input);
  if (prepared.preview.configurationVersion !== input.configurationVersion)
    throw rpcError.conflict('Classes, subjects or the classes taking part have changed. Review the updated list before saving.');

  const wanted = new Set(input.classIds);
  const added = input.classIds.filter((classId) => !current.includes(classId));
  const removed = current.filter((classId) => !wanted.has(classId));
  const kept = current.filter((classId) => wanted.has(classId));
  const subjects = input.subjects ?? {};
  if (Object.keys(subjects).some((classId) => !wanted.has(classId)))
    throw rpcError.badRequest('Subjects were chosen for a class that does not take part after this change.');
  const status = lifecycle?.status === 'active' ? ('active' as const) : ('draft' as const);
  const subjectChanges = selectSubjectPlanChanges(prepared, choiceFor(subjects, kept));
  const plans = [...selectExamClassPlans(prepared, added, choiceFor(subjects, added)), ...subjectChanges.add].map((plan) => ({
    ...plan,
    status,
  }));
  // Creating and deleting plans need their own grants, checked once the
  // change is known and before anything is written.
  if (plans.length && !permission.canCreate)
    throw rpcError.forbidden('This change adds exam plans, which needs permission to create exam plans.');
  if (!permission.canDelete) {
    const [removedPlan] = removed.length
      ? await tx.select({ id: examPlanTable.id }).from(examPlanTable).where(and(examWhere(input), inArray(examPlanTable.classId, removed))).limit(1)
      : [];
    if (removedPlan || subjectChanges.remove.length)
      throw rpcError.forbidden('This change removes exam plans, which needs permission to delete exam plans.');
  }
  const classRemoval = removed.length ? await removeExamClasses(tx, input, removed, labels) : { objects: [], deletedPlanCount: 0 };
  const subjectRemoval = await removeExamSubjectPlans(tx, input, subjectChanges.remove);

  if (added.length)
    await tx
      .insert(examClassTable)
      .values(added.map((classId) => ({ schoolId: input.schoolId, sessionId: input.sessionId, examSlug: input.examSlug, classId })));
  for (let offset = 0; offset < plans.length; offset += 100) await tx.insert(examPlanTable).values(plans.slice(offset, offset + 100));
  return {
    result: {
      addedClassIds: added,
      removedClassIds: removed,
      createdPlanCount: plans.length,
      deletedPlanCount: classRemoval.deletedPlanCount + subjectRemoval.deletedPlanCount,
    },
    questionPaperObjects: [...classRemoval.objects, ...subjectRemoval.objects],
  };
}

/**
 * Removes the plans of subjects left out of a class that keeps taking part
 * (see {@link updateExamClasses}), with the guards of removing a class
 * applied per subject: refused while the subject's plan has saved results,
 * while the class has question papers for the subject, or while a timetable
 * schedules the subject for the class (published or draft; the schedule is
 * the user's work, so it is never dropped silently). Shared
 * attendance/activity assessments and remarks belong to the student and the
 * examination, not to a subject, so removing one subject's plan loses none
 * of them and they do not block it. Chat conversations shared to the
 * subject's papers are unshared, as `deleteExamPlan` does.
 */
async function removeExamSubjectPlans(
  tx: DatabaseTransaction,
  scope: ExamScope,
  subjects: ReadonlyArray<{ classId: string; subjectSlug: string; label: string; name: string }>,
) {
  if (!subjects.length) return { objects: [] as string[], deletedPlanCount: 0 };
  const plans = await tx
    .select()
    .from(examPlanTable)
    .where(
      and(
        examWhere(scope),
        inArray(examPlanTable.classId, [...new Set(subjects.map((entry) => entry.classId))]),
        inArray(examPlanTable.subjectSlug, [...new Set(subjects.map((entry) => entry.subjectSlug))]),
      ),
    )
    .orderBy(examPlanTable.id)
    .for('update');
  const leaving = plans.filter((plan) => subjects.some((entry) => entry.classId === plan.classId && entry.subjectSlug === plan.subjectSlug));
  const describe = (classId: string, subjectSlug: string) => {
    const entry = subjects.find((item) => item.classId === classId && item.subjectSlug === subjectSlug);
    return entry ? `${entry.label} · ${entry.name}` : 'A subject';
  };
  if (leaving.length) {
    const [withResult] = await tx
      .select({ examPlanId: examResultTable.examPlanId })
      .from(examResultTable)
      .where(inArray(examResultTable.examPlanId, leaving.map((plan) => plan.id)))
      .limit(1);
    const resultPlan = withResult && leaving.find((plan) => plan.id === withResult.examPlanId);
    if (resultPlan)
      throw rpcError.badRequest(`${describe(resultPlan.classId, resultPlan.subjectSlug)} has saved results in this examination, so it cannot be removed.`);
  }
  for (const entry of subjects) {
    const [paper] = await tx
      .select({ id: examQuestionPaperTable.id })
      .from(examQuestionPaperTable)
      .where(
        and(
          eq(examQuestionPaperTable.schoolId, scope.schoolId),
          eq(examQuestionPaperTable.sessionId, scope.sessionId),
          eq(examQuestionPaperTable.examSlug, scope.examSlug),
          eq(examQuestionPaperTable.classId, entry.classId),
          eq(examQuestionPaperTable.subjectSlug, entry.subjectSlug),
        ),
      )
      .limit(1);
    if (paper)
      throw rpcError.badRequest(`${entry.label} · ${entry.name} has question papers in this examination. Delete them before removing the subject.`);
  }
  await refuseScheduledSubjects(tx, scope, subjects);
  const objects: string[] = [];
  for (const plan of leaving) objects.push(...(await deleteQuestionPapersOfPlan(tx, plan)));
  if (leaving.length) await tx.delete(examPlanTable).where(inArray(examPlanTable.id, leaving.map((plan) => plan.id)));
  return { objects, deletedPlanCount: leaving.length };
}

/**
 * Refuses removing a subject's plan while the exam's timetable (draft or
 * published) schedules that subject for that class: unticking it in
 * `updateExamClasses` and deleting the plan with `deleteExamPlan`. Locks the
 * timetable row FOR UPDATE; callers hold the session lock first.
 */
export async function refuseScheduledSubjects(
  tx: DatabaseTransaction,
  scope: ExamScope,
  subjects: ReadonlyArray<{ classId: string; subjectSlug: string; label: string; name: string }>,
) {
  const [timetable] = await tx
    .select()
    .from(examTimetableTable)
    .where(
      and(
        eq(examTimetableTable.schoolId, scope.schoolId),
        eq(examTimetableTable.sessionId, scope.sessionId),
        eq(examTimetableTable.examSlug, scope.examSlug),
      ),
    )
    .for('update');
  if (!timetable) return;
  for (const entry of subjects) {
    const scheduled = timetable.config.rows.some((row) => {
      const cell = row.cells[entry.classId];
      if (!cell) return false;
      return (Array.isArray(cell) ? cell : [cell]).some((paper) => paper.subjectSlug === entry.subjectSlug);
    });
    if (scheduled)
      throw rpcError.badRequest(
        `The ${timetable.publishedAt ? 'published' : 'draft'} timetable schedules ${entry.label} · ${entry.name}. Remove it from the timetable${timetable.publishedAt ? ' (withdraw the timetable to a draft first)' : ''} before removing the subject.`,
      );
  }
}

/**
 * Refuses or performs the removal of `classIds` from the examination (see
 * {@link updateExamClasses}).
 *
 * Saved results are found through their plans, so they are matched to the
 * class they were entered in. Shared assessments and remarks have no class of
 * their own and are matched through the student's **current** class
 * (`student.class_id`), an approximation: a student moved to another class
 * after their assessment or remark was saved counts for the new class, so it
 * can block removing the new class and does not block removing the old one.
 * Such a record is still kept (nothing here deletes assessments or remarks).
 */
async function removeExamClasses(tx: DatabaseTransaction, scope: ExamScope, classIds: string[], labels: Map<string, string>) {
  const label = (classId: string) => labels.get(classId) ?? 'A class';
  // The caller's FOR UPDATE lock on the session (writers of results, remarks and question papers take it FOR SHARE) keeps these checks true until commit, which is what makes deleting the plans below safe despite `exam_result.exam_plan_id ON DELETE CASCADE`.
  const [withResult] = await tx
    .select({ classId: examPlanTable.classId })
    .from(examResultTable)
    .innerJoin(examPlanTable, eq(examPlanTable.id, examResultTable.examPlanId))
    .where(and(examWhere(scope), inArray(examPlanTable.classId, classIds)))
    .limit(1);
  if (withResult)
    throw rpcError.badRequest(`${label(withResult.classId)} has saved results in this examination, so it cannot be removed.`);
  const [withAssessment] = await tx
    .select({ classId: studentTable.classId })
    .from(examStudentAssessmentTable)
    .innerJoin(studentTable, eq(studentTable.id, examStudentAssessmentTable.studentId))
    .where(and(assessmentWhere(scope), inArray(studentTable.classId, classIds)))
    .limit(1);
  const [withRemark] = await tx
    .select({ classId: studentTable.classId })
    .from(examStudentRemarkTable)
    .innerJoin(studentTable, eq(studentTable.id, examStudentRemarkTable.studentId))
    .where(
      and(
        eq(examStudentRemarkTable.schoolId, scope.schoolId),
        eq(examStudentRemarkTable.sessionId, scope.sessionId),
        eq(examStudentRemarkTable.examSlug, scope.examSlug),
        inArray(studentTable.classId, classIds),
      ),
    )
    .limit(1);
  const studentRecord = withAssessment ?? withRemark;
  if (studentRecord?.classId)
    throw rpcError.badRequest(
      `${label(studentRecord.classId)} has saved attendance, activities or remarks in this examination, so it cannot be removed.`,
    );
  const [withPaper] = await tx
    .select({ classId: examQuestionPaperTable.classId })
    .from(examQuestionPaperTable)
    .where(
      and(
        eq(examQuestionPaperTable.schoolId, scope.schoolId),
        eq(examQuestionPaperTable.sessionId, scope.sessionId),
        eq(examQuestionPaperTable.examSlug, scope.examSlug),
        inArray(examQuestionPaperTable.classId, classIds),
      ),
    )
    .limit(1);
  if (withPaper)
    throw rpcError.badRequest(`${label(examKeyPart(withPaper.classId))} has question papers in this examination. Delete them before removing the class.`);
  await dropTimetableColumns(tx, scope, classIds, label);

  const plans = await tx
    .select()
    .from(examPlanTable)
    .where(and(examWhere(scope), inArray(examPlanTable.classId, classIds)))
    .orderBy(examPlanTable.id)
    .for('update');
  const objects: string[] = [];
  // Unshares any chat conversation still pointing at the class's papers, as
  // deleting a single plan does.
  for (const plan of plans) objects.push(...(await deleteQuestionPapersOfPlan(tx, plan)));
  if (plans.length) await tx.delete(examPlanTable).where(and(examWhere(scope), inArray(examPlanTable.classId, classIds)));
  await tx.delete(examClassTable).where(and(examClassWhere(scope), inArray(examClassTable.classId, classIds)));
  return { objects, deletedPlanCount: plans.length };
}

/**
 * Keeps the timetable within the classes taking part when classes leave. A
 * published timetable is frozen, so one that includes a leaving class refuses
 * the removal; a draft that schedules papers for it refuses too (the schedule
 * is the user's work), and a draft column with nothing scheduled is dropped.
 */
async function dropTimetableColumns(tx: DatabaseTransaction, scope: ExamScope, classIds: string[], label: (classId: string) => string) {
  const [timetable] = await tx
    .select()
    .from(examTimetableTable)
    .where(
      and(
        eq(examTimetableTable.schoolId, scope.schoolId),
        eq(examTimetableTable.sessionId, scope.sessionId),
        eq(examTimetableTable.examSlug, scope.examSlug),
      ),
    )
    .for('update');
  if (!timetable) return;
  const leaving = timetable.config.columns.filter((classId) => classIds.includes(classId));
  if (!leaving.length) return;
  if (timetable.publishedAt)
    throw rpcError.badRequest(
      `The published timetable includes ${label(leaving[0]!)}. Withdraw the timetable to a draft and remove the class's column before removing the class.`,
    );
  const scheduled = leaving.find((classId) => timetable.config.rows.some((row) => hasPapers(row.cells[classId])));
  if (scheduled)
    throw rpcError.badRequest(
      `The draft timetable schedules papers for ${label(scheduled)}. Remove the class's column from the timetable before removing the class.`,
    );
  const config: TimetableConfig = {
    columns: timetable.config.columns.filter((classId) => !leaving.includes(classId)),
    rows: timetable.config.rows.map((row) => ({
      ...row,
      cells: Object.fromEntries(Object.entries(row.cells).filter(([classId]) => !leaving.includes(classId))),
    })),
  };
  await tx.update(examTimetableTable).set({ config, updatedAt: new Date() }).where(eq(examTimetableTable.id, timetable.id));
}

function hasPapers(cell: TimetableConfig['rows'][number]['cells'][string] | undefined) {
  if (!cell) return false;
  return Array.isArray(cell) ? cell.length > 0 : true;
}
