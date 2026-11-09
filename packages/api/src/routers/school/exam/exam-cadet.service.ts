import type { DatabaseExecutor, DatabaseTransaction } from '@campuspilot/db';
import { user } from '@campuspilot/db/schema/auth';
import {
  examLifecycleTable,
  examPlanTable,
  examStudentRemarkTable,
} from '@campuspilot/db/schema/exam';
import { and, eq, sql } from 'drizzle-orm';
import type { z } from 'zod';

import { rpcError } from '../../../errors';
import type * as dto from './exam.dto';
import { examOverview } from './exam-lifecycle.service';
import { getExam, requireRegisteredExamStudents } from './exam.service';
import { studentWhere } from './exam-student.service';
import { examWhere, lifecycleWhere } from './exam.scope';
import { studentTable } from '@campuspilot/db/schema/student';
import { admissionTable } from '@campuspilot/db/schema/admission';
import type { ExamScope } from './exam.service';

type StudentScope = z.infer<typeof dto.examStudentScopeSchema>;

/**
 * Refuses any change to the plans of an examination whose results are
 * released to the Cadet Portal: what students see must not change under
 * them. Locks the lifecycle row like `transitionExam` and
 * `setExamCadetRelease`, so a concurrent release and plan change serialize.
 */
export async function requireNotReleasedToCadet(tx: DatabaseTransaction, scope: ExamScope) {
  const [lifecycle] = await tx
    .select({ cadetReleasedAt: examLifecycleTable.cadetReleasedAt })
    .from(examLifecycleTable)
    .where(lifecycleWhere(scope))
    .for('update');
  if (lifecycle?.cadetReleasedAt)
    throw rpcError.badRequest(
      'These results are released to the Cadet Portal. Withdraw them from the Cadet Portal before changing the examination plans.',
    );
}

/**
 * Releases or withdraws an examination's results in the Cadet Portal.
 *
 * Release requires the examination to be completed: completion is the point
 * at which every registered student's results are approved and become
 * read-only, so students never see marks that can still change. Release is
 * still its own recorded act (`cadetReleasedAt`), never implied by
 * completion, and reopening is refused while released (see `transitionExam`).
 * Historical sessions may be released too, because the portal shows earlier
 * years in Growth; releasing changes no academic data.
 *
 * Release freezes marks and remarks only (they cannot be edited while
 * released). It takes no snapshot: the portal reads exam names, subject and
 * mode names, co-scholastic area names and the grading scale live from the
 * session and class configuration, so later configuration edits change how a
 * released result is labelled and graded. The lifecycle row is
 * locked so a concurrent reopen and release serialize.
 */
export async function setExamCadetRelease(
  tx: DatabaseTransaction,
  scope: ExamScope,
  release: { userId: string } | null,
) {
  await getExam(tx, scope);
  const [lifecycle] = await tx
    .select()
    .from(examLifecycleTable)
    .where(lifecycleWhere(scope))
    .for('update');
  if (release) {
    if (lifecycle?.status !== 'completed')
      throw rpcError.badRequest(
        'Complete the examination before releasing its results to the Cadet Portal.',
      );
    if (lifecycle.cadetReleasedAt)
      throw rpcError.badRequest(
        'These results are already released to the Cadet Portal.',
      );
  } else if (!lifecycle?.cadetReleasedAt) {
    throw rpcError.badRequest(
      'These results are not released to the Cadet Portal.',
    );
  }
  await tx
    .update(examLifecycleTable)
    .set({
      cadetReleasedAt: release ? new Date() : null,
      cadetReleasedBy: release ? release.userId : null,
    })
    .where(lifecycleWhere(scope));
  return examOverview(tx, scope);
}

const remarkWhere = (scope: StudentScope) =>
  and(
    eq(examStudentRemarkTable.schoolId, scope.schoolId),
    eq(examStudentRemarkTable.sessionId, scope.sessionId),
    eq(examStudentRemarkTable.examSlug, scope.examSlug),
    eq(examStudentRemarkTable.studentId, scope.studentId),
  );

async function readRemark(db: DatabaseExecutor, scope: StudentScope) {
  const [remark] = await db
    .select({
      text: examStudentRemarkTable.text,
      authorId: examStudentRemarkTable.authorId,
      authorName: user.name,
      createdAt: examStudentRemarkTable.createdAt,
      updatedAt: examStudentRemarkTable.updatedAt,
    })
    .from(examStudentRemarkTable)
    .leftJoin(user, eq(user.id, examStudentRemarkTable.authorId))
    .where(remarkWhere(scope))
    .limit(1);
  return remark ? { ...remark, authorName: remark.authorName ?? null } : null;
}

/** The same student/class/plan checks as the student result workspace. */
async function requireExamStudent(db: DatabaseExecutor, scope: StudentScope) {
  const [plan] = await db
    .select({ id: examPlanTable.id })
    .from(examPlanTable)
    .where(and(examWhere(scope), eq(examPlanTable.classId, scope.classId)))
    .limit(1);
  if (!plan) throw rpcError.notFound('Exam plan for this class');
  const [student] = await db
    .select({ id: studentTable.id })
    .from(studentTable)
    .innerJoin(admissionTable, eq(admissionTable.id, studentTable.admissionId))
    .where(and(studentWhere(scope), eq(studentTable.id, scope.studentId)))
    .limit(1);
  if (!student)
    throw rpcError.notFound('Registered student in this class and session');
}

export async function getStudentExamRemark(
  db: DatabaseExecutor,
  scope: StudentScope,
) {
  await getExam(db, scope);
  await requireExamStudent(db, scope);
  return readRemark(db, scope);
}

/**
 * Saves (or, for blank text, removes) one student's remark. Remarks can be
 * written once the examination has started, including after completion,
 * because teachers usually write them after marks are final. They are frozen
 * while the results are released to the Cadet Portal so what students read
 * cannot change under them; withdraw first to edit. The session must be the
 * active one, like every other exam write.
 */
export async function saveStudentExamRemark(
  tx: DatabaseTransaction,
  input: z.infer<typeof dto.saveStudentExamRemarkInputSchema>,
  authorId: string,
) {
  await getExam(tx, input, 'share');
  const [lifecycle] = await tx
    .select()
    .from(examLifecycleTable)
    .where(lifecycleWhere(input))
    .for('share');
  if (lifecycle?.status !== 'active' && lifecycle?.status !== 'completed')
    throw rpcError.badRequest(
      'Start the examination before writing remarks.',
    );
  if (lifecycle.cadetReleasedAt)
    throw rpcError.badRequest(
      'These results are released to the Cadet Portal. Withdraw them before changing remarks.',
    );
  await requireExamStudent(tx, input);
  await requireRegisteredExamStudents(tx, input, [input.studentId]);
  const text = input.text?.trim() ?? '';
  if (!text) {
    await tx.delete(examStudentRemarkTable).where(remarkWhere(input));
    return null;
  }
  const now = new Date();
  await tx
    .insert(examStudentRemarkTable)
    .values({
      schoolId: input.schoolId,
      sessionId: input.sessionId,
      examSlug: input.examSlug,
      studentId: input.studentId,
      text,
      authorId,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        examStudentRemarkTable.sessionId,
        examStudentRemarkTable.examSlug,
        examStudentRemarkTable.studentId,
      ],
      set: { text, authorId, updatedAt: now },
      // Saving identical text keeps the original author and time.
      setWhere: sql`${examStudentRemarkTable.text} is distinct from excluded.text`,
    });
  return readRemark(tx, input);
}
