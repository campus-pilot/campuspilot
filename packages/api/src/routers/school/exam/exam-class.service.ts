import type { DatabaseExecutor, DatabaseTransaction } from '@campuspilot/db';
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
import { prepareExamPlan, selectExamClassPlans } from './exam-plan-generation';
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
 * Changes which classes take part in an examination whose plan already exists,
 * to exactly `input.classIds`, atomically.
 *
 * - The examination must not have ended or be released to the Cadet Portal,
 *   and the review (`configurationVersion` from `getExamPlanPreview`, which
 *   covers participation too) must be current.
 * - An **added** class gets its subject plans from its class settings exactly
 *   as at generation (100 marks, configured modes). They open for result entry
 *   at once when the examination has started (`active`), as starting does for
 *   every plan; otherwise they are drafts.
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
export async function updateExamClasses(tx: DatabaseTransaction, input: UpdateExamClassesInput) {
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
  const plans = selectExamClassPlans(prepared, added).map((plan) => ({
    ...plan,
    status: lifecycle?.status === 'active' ? ('active' as const) : ('draft' as const),
  }));
  const questionPaperObjects = removed.length ? await removeExamClasses(tx, input, removed, labels) : { objects: [], deletedPlanCount: 0 };

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
      deletedPlanCount: questionPaperObjects.deletedPlanCount,
    },
    questionPaperObjects: questionPaperObjects.objects,
  };
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
    throw rpcError.badRequest(`${label(withPaper.classId)} has question papers in this examination. Delete them before removing the class.`);
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
