import type { DatabaseExecutor } from '@campuspilot/db';
import { classTable } from '@campuspilot/db/schema/class';
import { examLifecycleTable, examPlanTable } from '@campuspilot/db/schema/exam';
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

/** Writes need the active session and an exam that has not ended; the exam's own lifecycle is the fact, not the plan status. */
export function assertPaperWritable(scope: PaperScope): void {
  if (!scope.sessionIsActive) throw rpcError.badRequest('Only the active academic session can be modified.');
  if (scope.examCompleted) {
    throw rpcError.badRequest('This examination has ended, so its question papers can no longer be changed.');
  }
}
