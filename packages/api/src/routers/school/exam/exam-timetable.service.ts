import type { DatabaseExecutor, DatabaseTransaction } from '@campuspilot/db';
import { examLifecycleTable, examTimetableTable } from '@campuspilot/db/schema/exam';
import { and, eq } from 'drizzle-orm';
import type { z } from 'zod';

import { rpcError } from '../../../errors';
import { notifyTimetablePublished } from '../../../notifications/emitters/exam-timetable';
import type { examScopeSchema } from './exam.dto';
import { lifecycleWhere } from './exam.scope';
import { getExam, type ExamScope } from './exam.service';

type Scope = z.infer<typeof examScopeSchema>;

export const timetableWhere = (scope: ExamScope) =>
  and(
    eq(examTimetableTable.schoolId, scope.schoolId),
    eq(examTimetableTable.sessionId, scope.sessionId),
    eq(examTimetableTable.examSlug, scope.examSlug),
  );

/**
 * A timetable is drafted, published and withdrawn only while its examination
 * has not ended (`ready` or `active`); a completed examination's schedule is
 * history. Reads the lifecycle row, so it is its own fact and never inferred
 * from plans or the timetable.
 */
export async function requireExamNotEnded(db: DatabaseExecutor, scope: ExamScope) {
  const [lifecycle] = await db
    .select({ status: examLifecycleTable.status })
    .from(examLifecycleTable)
    .where(lifecycleWhere(scope))
    .limit(1);
  if (lifecycle?.status === 'completed')
    throw rpcError.badRequest('This examination has ended, so its timetable can no longer be changed, published or withdrawn.');
}

/** Refuses a change to a timetable that students and staff can currently see. */
export function requireTimetableDraft(timetable: { publishedAt: Date | null } | undefined) {
  if (timetable?.publishedAt)
    throw rpcError.badRequest('This timetable is published. Withdraw it to a draft before changing or deleting it.');
}

/** Locks the exam's timetable row, or NOT_FOUND. */
async function lockTimetable(tx: DatabaseTransaction, scope: ExamScope) {
  const [timetable] = await tx.select().from(examTimetableTable).where(timetableWhere(scope)).for('update');
  if (!timetable) throw rpcError.notFound('Exam timetable');
  return timetable;
}

/**
 * Publishes a draft timetable to the staff and, where the school has the Cadet
 * Portal, to all its students, notifying them in the same transaction (see
 * `notifications/emitters/exam-timetable.ts`). The examination must not have
 * ended and the timetable must hold at least one slot. The caller hands the
 * returned event IDs over after commit.
 */
export async function publishExamTimetable(tx: DatabaseTransaction, scope: Scope, userId: string) {
  const { exam } = await getExam(tx, scope, 'update');
  await requireExamNotEnded(tx, scope);
  const timetable = await lockTimetable(tx, scope);
  if (timetable.publishedAt) throw rpcError.badRequest('This timetable is already published.');
  if (timetable.config.rows.length === 0) throw rpcError.badRequest('Add at least one exam slot before publishing the timetable.');
  const publicationNumber = timetable.publicationCount + 1;
  const [published] = await tx
    .update(examTimetableTable)
    .set({ publishedAt: new Date(), publishedBy: userId, publicationCount: publicationNumber })
    .where(eq(examTimetableTable.id, timetable.id))
    .returning();
  const eventIds = await notifyTimetablePublished(
    tx,
    { id: timetable.id, schoolId: scope.schoolId, sessionId: scope.sessionId, examSlug: scope.examSlug, examName: exam.name, publicationNumber },
    userId,
  );
  return { timetable: published!, eventIds };
}

/**
 * Withdraws a published timetable back to a draft: students stop seeing it
 * (staff still read drafts) and nobody is notified. The notifications already sent
 * stay in their inboxes and open a timetable that is no longer available
 * until it is published again.
 */
export async function withdrawExamTimetable(tx: DatabaseTransaction, scope: Scope) {
  await getExam(tx, scope, 'update');
  await requireExamNotEnded(tx, scope);
  const timetable = await lockTimetable(tx, scope);
  if (!timetable.publishedAt) throw rpcError.badRequest('This timetable is not published.');
  const [draft] = await tx
    .update(examTimetableTable)
    .set({ publishedAt: null, publishedBy: null })
    .where(eq(examTimetableTable.id, timetable.id))
    .returning();
  return draft!;
}
