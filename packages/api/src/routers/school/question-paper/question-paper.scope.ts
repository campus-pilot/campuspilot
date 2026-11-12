import type { DatabaseExecutor, DatabaseTransaction } from '@campuspilot/db';
import { classTable } from '@campuspilot/db/schema/class';
import { examLifecycleTable, examPlanTable } from '@campuspilot/db/schema/exam';
import { ORPCError } from '@orpc/server';
import { and, eq } from 'drizzle-orm';

import { rpcError } from '../../../errors';
import { lifecycleWhere } from '../exam/exam.scope';
import { getExamSession } from '../exam/exam.service';
import type { PaperKey } from './question-paper.dto';

/**
 * What a paper key means today: the names and numbers of the exam plan it
 * belongs to. Read at each call and never stored on the paper, because plans
 * can be deleted and regenerated (the paper has no foreign key to the plan).
 */
export type PaperScope = {
  key: PaperKey;
  sessionStartYear: number;
  sessionEndYear: number;
  sessionIsActive: boolean;
  examName: string;
  examOrder: number;
  className: string;
  subjectName: string;
  modeName: string;
  /** The mode's maximum marks in the plan. */
  planMaxMarks: number;
  /** The exam's lifecycle: a completed exam's papers are read-only (D43). */
  examCompleted: boolean;
};

/**
 * Validates, in one place and independently, everything a paper key claims:
 * the session belongs to the school, the exam exists in the session
 * configuration, the class belongs to the school, the exam has a plan for the
 * subject in that class, and the plan has the mode. Each failure is its own
 * NOT_FOUND or BAD_REQUEST message.
 */
export async function resolvePaperScope(db: DatabaseExecutor, key: PaperKey): Promise<PaperScope> {
  const session = await getExamSession(db, key);
  const exam = Object.hasOwn(session.config.examConfig, key.examSlug) ? session.config.examConfig[key.examSlug] : undefined;
  if (!exam) throw rpcError.notFound('Exam');
  const [schoolClass] = await db
    .select({ label: classTable.label, config: classTable.config })
    .from(classTable)
    .where(and(eq(classTable.id, key.classId), eq(classTable.schoolId, key.schoolId)))
    .limit(1);
  if (!schoolClass) throw rpcError.notFound('Class');
  const [plan] = await db
    .select({ modeConfig: examPlanTable.modeConfig })
    .from(examPlanTable)
    .where(
      and(
        eq(examPlanTable.schoolId, key.schoolId),
        eq(examPlanTable.sessionId, key.sessionId),
        eq(examPlanTable.examSlug, key.examSlug),
        eq(examPlanTable.classId, key.classId),
        eq(examPlanTable.subjectSlug, key.subjectSlug),
      ),
    )
    .limit(1);
  if (!plan) throw rpcError.notFound('Exam plan for this subject');
  if (!Object.hasOwn(plan.modeConfig, key.modeSlug)) {
    throw rpcError.badRequest(`The exam plan for this subject has no "${key.modeSlug}" mode.`);
  }
  const subject = schoolClass.config?.subjects?.[key.subjectSlug];
  const [lifecycle] = await db
    .select({ status: examLifecycleTable.status })
    .from(examLifecycleTable)
    .where(lifecycleWhere(key))
    .limit(1);
  return {
    key,
    sessionStartYear: session.sessionStartYear,
    sessionEndYear: session.sessionEndYear,
    sessionIsActive: session.isActive,
    examName: exam.name,
    examOrder: exam.order,
    className: schoolClass.label,
    subjectName: subject?.name ?? key.subjectSlug,
    modeName: subject?.examModes?.[key.modeSlug]?.name ?? key.modeSlug,
    planMaxMarks: plan.modeConfig[key.modeSlug]!.maxMarks,
    examCompleted: lifecycle?.status === 'completed',
  };
}

/** `data.reason` of the BAD_REQUEST that says a paper can no longer be changed (not a validation or print failure). */
export const PAPER_LOCKED_REASON = 'paper_locked';

const paperLockedError = (message: string) => new ORPCError('BAD_REQUEST', { message, data: { reason: PAPER_LOCKED_REASON } });

/** Whether an error is the refusal of {@link assertPaperWritable} or {@link assertPaperWritableLocked}. */
export const isPaperLockedError = (error: unknown): boolean =>
  error instanceof ORPCError && error.code === 'BAD_REQUEST' && (error.data as { reason?: unknown } | undefined)?.reason === PAPER_LOCKED_REASON;

/**
 * Writes need the active session and an exam that has not ended; the exam's own lifecycle is the fact, not the plan status.
 * This reads the scope resolved before the transaction, so it is a fast early refusal only; every write transaction
 * repeats the check with {@link assertPaperWritableLocked}.
 */
export function assertPaperWritable(scope: PaperScope): void {
  if (!scope.sessionIsActive) throw paperLockedError('Only the active academic session can be modified.');
  if (scope.examCompleted) {
    throw paperLockedError('This examination has ended, so its question papers can no longer be changed.');
  }
}

/**
 * The authoritative writable check, for the first statements of a write
 * transaction (before the paper row is locked, which is also the order
 * `deleteExamPlan` uses). It takes the school session row `FOR SHARE`, the
 * same lock the exam services take, and `transitionExam` (which completes an
 * exam) takes it `FOR UPDATE`: a completion therefore either commits before
 * this read, and the write is refused, or waits until this transaction ends.
 * The session's `isActive` is checked by the lock read itself.
 */
export async function assertPaperWritableLocked(tx: DatabaseTransaction, key: PaperKey): Promise<void> {
  try {
    await getExamSession(tx, key, 'share');
  } catch (error) {
    if (error instanceof ORPCError && error.code === 'BAD_REQUEST') throw paperLockedError(error.message);
    throw error;
  }
  const [lifecycle] = await tx.select({ status: examLifecycleTable.status }).from(examLifecycleTable).where(lifecycleWhere(key)).limit(1);
  if (lifecycle?.status === 'completed') {
    throw paperLockedError('This examination has ended, so its question papers can no longer be changed.');
  }
}
