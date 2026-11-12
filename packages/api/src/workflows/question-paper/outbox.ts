import { db as defaultDb, type DatabaseExecutor } from '@campuspilot/db';
import { examQuestionPaperJobTable } from '@campuspilot/db/schema/exam-question-paper';
import { env } from '@campuspilot/env/assistant';
import { and, asc, eq, inArray, isNotNull, isNull, lt, sql } from 'drizzle-orm';

import { QUESTION_PAPER_JOB_FAILURES } from './constants';
import { log } from './log';
import { sendQuestionPaperStart } from './restate';

/**
 * The generation outbox. `exam_question_paper_job` is the durable record of
 * work the API owes Restate: the start procedure writes a `queued` row and
 * commits, hands it over in the background ({@link handOff}) and returns at
 * once. The sweep ({@link sweepQuestionPaperOutbox}, every 30 s in the API
 * process) re-sends what Restate has not accepted and makes work that can no
 * longer progress fail visibly, so a job is never `queued` or `running`
 * without either progressing or ending in a failure the user can read.
 *
 * The job's own progress (running, succeeded, failed by the model) is written
 * by the worker's workflow; this file only guards the hand-over and the
 * deadlines.
 */

/** Rows handled per kind and sweep; the next sweep continues with the rest. */
const SWEEP_LIMIT = 20;
/** A start Restate has not accepted after this long fails with `dispatch_failed`. */
export const QUESTION_PAPER_HANDOVER_DEADLINE_MS = 10 * 60 * 1000;
/** Accepted by Restate but never started by the worker after this long fails with `not_started`. */
export const QUESTION_PAPER_START_DEADLINE_MS = 5 * 60 * 1000;

/** Codes this file writes; the workflow writes the rest of `QUESTION_PAPER_JOB_FAILURES`. */
type SweepErrorCode = 'dispatch_failed' | 'not_started' | 'not_finished';

/** Safe one-line description of a hand-over failure (no URLs or secrets). */
function describeHandoverError(error: unknown) {
  if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) return 'Restate did not answer in time.';
  if (error instanceof Error && /WORKER_CONTROL_SECRET/.test(error.message)) return error.message;
  return 'Restate is unreachable.';
}

/**
 * Starts background work after the response is decided. The promise is not
 * awaited by the request; failures are logged and left to the sweep.
 */
export function handOff(name: string, work: () => Promise<unknown>) {
  void work().catch((error: unknown) => {
    log.error({ err: error instanceof Error ? { name: error.name, message: error.message } : String(error) }, `question-paper.${name}.error`);
  });
}

/**
 * Sends the current attempt of a queued job to Restate. Only a job that is
 * still queued and not yet accepted is sent; every write is fenced by the
 * attempt, so a send racing a retry or a failure changes nothing.
 */
export async function dispatchQuestionPaperJob(db: DatabaseExecutor, jobId: string): Promise<boolean> {
  const [job] = await db
    .select({ attempt: examQuestionPaperJobTable.attempt })
    .from(examQuestionPaperJobTable)
    .where(and(eq(examQuestionPaperJobTable.id, jobId), eq(examQuestionPaperJobTable.status, 'queued'), isNull(examQuestionPaperJobTable.handedOverAt)))
    .limit(1);
  if (!job) return false;
  const fence = and(
    eq(examQuestionPaperJobTable.id, jobId),
    eq(examQuestionPaperJobTable.attempt, job.attempt),
    eq(examQuestionPaperJobTable.status, 'queued'),
    isNull(examQuestionPaperJobTable.handedOverAt),
  );
  try {
    await sendQuestionPaperStart(jobId, job.attempt);
    await db
      .update(examQuestionPaperJobTable)
      .set({ handedOverAt: new Date(), handoverAttempts: sql`${examQuestionPaperJobTable.handoverAttempts} + 1`, lastHandoverError: null })
      .where(fence);
    return true;
  } catch (error) {
    await db
      .update(examQuestionPaperJobTable)
      .set({ handoverAttempts: sql`${examQuestionPaperJobTable.handoverAttempts} + 1`, lastHandoverError: describeHandoverError(error) })
      .where(fence);
    log.warn({ jobId, attempt: job.attempt, reason: describeHandoverError(error) }, 'question-paper.handover.failed');
    return false;
  }
}

/**
 * Fails jobs in `from` statuses with a user-readable message. The conditional
 * update is the fence: a job that finished meanwhile is left alone.
 */
async function failJobs(db: DatabaseExecutor, ids: string[], code: SweepErrorCode, from: Array<'queued' | 'running'>) {
  if (ids.length === 0) return 0;
  const rows = await db
    .update(examQuestionPaperJobTable)
    .set({ status: 'failed', errorCode: code, errorMessage: QUESTION_PAPER_JOB_FAILURES[code], completedAt: new Date() })
    .where(and(inArray(examQuestionPaperJobTable.id, ids), inArray(examQuestionPaperJobTable.status, from)))
    .returning({ id: examQuestionPaperJobTable.id });
  if (rows.length > 0) log.warn({ jobIds: rows.map((row) => row.id), code }, 'question-paper.job.swept');
  return rows.length;
}

/**
 * Claims queued jobs Restate has not accepted (`FOR UPDATE SKIP LOCKED`, so
 * replicas take disjoint rows) and fails those past the deadline in the same
 * short transaction. Returns the rest to send after commit.
 */
async function claimUnsent(db: DatabaseExecutor): Promise<{ toSend: string[]; expired: number }> {
  return db.transaction(async (transaction) => {
    const rows = await transaction
      .select({ id: examQuestionPaperJobTable.id, createdAt: examQuestionPaperJobTable.createdAt })
      .from(examQuestionPaperJobTable)
      .where(and(eq(examQuestionPaperJobTable.status, 'queued'), isNull(examQuestionPaperJobTable.handedOverAt)))
      .orderBy(asc(examQuestionPaperJobTable.createdAt))
      .limit(SWEEP_LIMIT)
      .for('update', { skipLocked: true });
    const deadline = Date.now() - QUESTION_PAPER_HANDOVER_DEADLINE_MS;
    const expired = rows.filter((row) => row.createdAt.getTime() < deadline).map((row) => row.id);
    const failed = await failJobs(transaction, expired, 'dispatch_failed', ['queued']);
    return { toSend: rows.filter((row) => !expired.includes(row.id)).map((row) => row.id), expired: failed };
  });
}

/** Fails jobs Restate accepted but the worker never started, and running jobs past the timeout. */
async function failStale(db: DatabaseExecutor) {
  const notStarted = await db
    .select({ id: examQuestionPaperJobTable.id })
    .from(examQuestionPaperJobTable)
    .where(
      and(
        eq(examQuestionPaperJobTable.status, 'queued'),
        isNotNull(examQuestionPaperJobTable.handedOverAt),
        isNull(examQuestionPaperJobTable.startedAt),
        lt(examQuestionPaperJobTable.handedOverAt, new Date(Date.now() - QUESTION_PAPER_START_DEADLINE_MS)),
      ),
    )
    .orderBy(asc(examQuestionPaperJobTable.handedOverAt))
    .limit(SWEEP_LIMIT);
  const unfinished = await db
    .select({ id: examQuestionPaperJobTable.id })
    .from(examQuestionPaperJobTable)
    .where(
      and(
        eq(examQuestionPaperJobTable.status, 'running'),
        lt(examQuestionPaperJobTable.startedAt, new Date(Date.now() - env.QUESTION_PAPER_JOB_TIMEOUT_MINUTES * 60 * 1000)),
      ),
    )
    .orderBy(asc(examQuestionPaperJobTable.startedAt))
    .limit(SWEEP_LIMIT);
  return {
    notStarted: await failJobs(db, notStarted.map((row) => row.id), 'not_started', ['queued']),
    notFinished: await failJobs(db, unfinished.map((row) => row.id), 'not_finished', ['running']),
  };
}

/**
 * One outbox sweep, safe across API replicas and bounded per kind. Sends run
 * after the claiming transaction commits, so the control service sees the
 * rows; a replica sending the same attempt again joins one invocation.
 */
export async function sweepQuestionPaperOutbox(db: DatabaseExecutor = defaultDb) {
  const { toSend, expired } = await claimUnsent(db);
  let handedOver = 0;
  for (const jobId of toSend) if (await dispatchQuestionPaperJob(db, jobId)) handedOver += 1;
  const stale = await failStale(db);
  return { unsent: toSend.length, handedOver, expired, ...stale };
}
