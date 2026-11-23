import { db as defaultDb, type DatabaseExecutor } from '@campuspilot/db';
import { documentGenerationJobTable } from '@campuspilot/db/schema/document-generation-job';
import { and, asc, eq, inArray, isNotNull, isNull, lt, sql } from 'drizzle-orm';

import {
  DOCUMENT_GENERATION_CLEANUP_GRACE_MS,
  DOCUMENT_GENERATION_HANDOVER_DEADLINE_MS,
  DOCUMENT_GENERATION_JOB_FAILURES,
  DOCUMENT_GENERATION_RUN_DEADLINE_MS,
  DOCUMENT_GENERATION_START_DEADLINE_MS,
} from './constants';
import { log } from './log';
import { sendDocumentGenerationStart } from './restate';
import { deleteObject, deletePrefix, documentJobPrefix, documentPdfKey } from './storage';
import { artifactTable } from '@campuspilot/db/schema/artifact';

/**
 * The generation outbox. `document_generation_job` is the durable record of
 * work the API owes Restate: `generateDocument` writes a `queued` row and
 * commits, hands it over in the background ({@link handOffDocumentJob}) and
 * returns at once. The sweep ({@link sweepDocumentGenerationOutbox}, every
 * 30 s in the API process) re-sends what Restate has not accepted, makes work
 * that can no longer progress fail visibly, and removes the temporary objects
 * of ended jobs the worker did not clean up. A job is therefore never
 * `queued` or `running` without either progressing or ending in a failure
 * the user can read.
 *
 * The job's own progress (running, batches, succeeded, failed by the worker)
 * is written by the worker; this file only guards the hand-over, the
 * deadlines and the cleanup backstop.
 */

/** Rows handled per kind and sweep; the next sweep continues with the rest. */
const SWEEP_LIMIT = 20;

/** Codes this file writes; the worker writes the rest of `DOCUMENT_GENERATION_JOB_FAILURES`. */
type SweepErrorCode = 'dispatch_failed' | 'not_started' | 'not_finished';

/** Safe one-line description of a hand-over failure (no URLs or secrets). */
function describeHandoverError(error: unknown) {
  if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) return 'Restate did not answer in time.';
  if (error instanceof Error && /WORKER_CONTROL_SECRET/.test(error.message)) return error.message;
  return 'Restate is unreachable.';
}

/**
 * Hands a job over after the response is decided. The promise is not
 * awaited by the request; failures are logged and left to the sweep.
 */
export function handOffDocumentJob(db: DatabaseExecutor, jobId: string) {
  void dispatchDocumentGenerationJob(db, jobId).catch((error: unknown) => {
    log.error({ jobId, err: error instanceof Error ? { name: error.name, message: error.message } : String(error) }, 'document-generation.dispatch.error');
  });
}

/**
 * Sends a queued job to Restate. Only a job that is still queued and not yet
 * accepted is sent; every write is fenced on that, so a send racing a
 * failure changes nothing.
 */
export async function dispatchDocumentGenerationJob(db: DatabaseExecutor, jobId: string): Promise<boolean> {
  const fence = and(
    eq(documentGenerationJobTable.id, jobId),
    eq(documentGenerationJobTable.status, 'queued'),
    isNull(documentGenerationJobTable.handedOverAt),
  );
  const [job] = await db.select({ id: documentGenerationJobTable.id }).from(documentGenerationJobTable).where(fence).limit(1);
  if (!job) return false;
  try {
    await sendDocumentGenerationStart(jobId);
    await db
      .update(documentGenerationJobTable)
      .set({ handedOverAt: new Date(), handoverAttempts: sql`${documentGenerationJobTable.handoverAttempts} + 1`, lastHandoverError: null })
      .where(fence);
    return true;
  } catch (error) {
    await db
      .update(documentGenerationJobTable)
      .set({ handoverAttempts: sql`${documentGenerationJobTable.handoverAttempts} + 1`, lastHandoverError: describeHandoverError(error) })
      .where(fence);
    log.warn({ jobId, reason: describeHandoverError(error) }, 'document-generation.handover.failed');
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
    .update(documentGenerationJobTable)
    .set({ status: 'failed', errorCode: code, errorMessage: DOCUMENT_GENERATION_JOB_FAILURES[code], completedAt: new Date() })
    .where(and(inArray(documentGenerationJobTable.id, ids), inArray(documentGenerationJobTable.status, from)))
    .returning({ id: documentGenerationJobTable.id });
  if (rows.length > 0) log.warn({ jobIds: rows.map((row) => row.id), code }, 'document-generation.job.swept');
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
      .select({ id: documentGenerationJobTable.id, createdAt: documentGenerationJobTable.createdAt })
      .from(documentGenerationJobTable)
      .where(and(eq(documentGenerationJobTable.status, 'queued'), isNull(documentGenerationJobTable.handedOverAt)))
      .orderBy(asc(documentGenerationJobTable.createdAt))
      .limit(SWEEP_LIMIT)
      .for('update', { skipLocked: true });
    const deadline = Date.now() - DOCUMENT_GENERATION_HANDOVER_DEADLINE_MS;
    const expired = rows.filter((row) => row.createdAt.getTime() < deadline).map((row) => row.id);
    const failed = await failJobs(transaction, expired, 'dispatch_failed', ['queued']);
    return { toSend: rows.filter((row) => !expired.includes(row.id)).map((row) => row.id), expired: failed };
  });
}

/** Fails jobs Restate accepted but the worker never started, and running jobs past the deadline. */
async function failStale(db: DatabaseExecutor) {
  const notStarted = await db
    .select({ id: documentGenerationJobTable.id })
    .from(documentGenerationJobTable)
    .where(
      and(
        eq(documentGenerationJobTable.status, 'queued'),
        isNotNull(documentGenerationJobTable.handedOverAt),
        isNull(documentGenerationJobTable.startedAt),
        lt(documentGenerationJobTable.handedOverAt, new Date(Date.now() - DOCUMENT_GENERATION_START_DEADLINE_MS)),
      ),
    )
    .orderBy(asc(documentGenerationJobTable.handedOverAt))
    .limit(SWEEP_LIMIT);
  const unfinished = await db
    .select({ id: documentGenerationJobTable.id })
    .from(documentGenerationJobTable)
    .where(
      and(
        eq(documentGenerationJobTable.status, 'running'),
        lt(documentGenerationJobTable.startedAt, new Date(Date.now() - DOCUMENT_GENERATION_RUN_DEADLINE_MS)),
      ),
    )
    .orderBy(asc(documentGenerationJobTable.startedAt))
    .limit(SWEEP_LIMIT);
  return {
    notStarted: await failJobs(db, notStarted.map((row) => row.id), 'not_started', ['queued']),
    notFinished: await failJobs(db, unfinished.map((row) => row.id), 'not_finished', ['running']),
  };
}

/**
 * The cleanup backstop: removes the temporary objects of jobs that ended at
 * least {@link DOCUMENT_GENERATION_CLEANUP_GRACE_MS} ago and still have them
 * (the worker removes them itself when it ends a job; this catches a worker
 * that died, and jobs the sweep failed), plus the final PDF of a job that did
 * not succeed when no artifact holds it. One failing job does not stop the
 * others.
 */
async function cleanupEnded(db: DatabaseExecutor) {
  const rows = await db
    .select({
      id: documentGenerationJobTable.id,
      schoolId: documentGenerationJobTable.schoolId,
      artifactId: documentGenerationJobTable.artifactId,
      status: documentGenerationJobTable.status,
    })
    .from(documentGenerationJobTable)
    .where(
      and(
        inArray(documentGenerationJobTable.status, ['succeeded', 'failed']),
        isNull(documentGenerationJobTable.temporaryObjectsDeletedAt),
        lt(documentGenerationJobTable.completedAt, new Date(Date.now() - DOCUMENT_GENERATION_CLEANUP_GRACE_MS)),
      ),
    )
    .orderBy(asc(documentGenerationJobTable.completedAt))
    .limit(SWEEP_LIMIT);
  let cleaned = 0;
  for (const row of rows) {
    try {
      await deletePrefix(documentJobPrefix(row.schoolId, row.id));
      if (row.status === 'failed') {
        const [artifact] = await db.select({ id: artifactTable.id }).from(artifactTable).where(eq(artifactTable.id, row.artifactId)).limit(1);
        if (!artifact) await deleteObject(documentPdfKey(row.schoolId, row.artifactId));
      }
      await db
        .update(documentGenerationJobTable)
        .set({ temporaryObjectsDeletedAt: new Date() })
        .where(eq(documentGenerationJobTable.id, row.id));
      cleaned += 1;
    } catch (error) {
      log.warn({ jobId: row.id, err: error instanceof Error ? error.name : 'unknown' }, 'document-generation.cleanup.failed');
    }
  }
  return cleaned;
}

/**
 * One outbox sweep, safe across API replicas and bounded per kind. Sends run
 * after the claiming transaction commits, so the control service sees the
 * rows; a replica sending the same job again joins one invocation.
 */
export async function sweepDocumentGenerationOutbox(db: DatabaseExecutor = defaultDb) {
  const { toSend, expired } = await claimUnsent(db);
  let handedOver = 0;
  for (const jobId of toSend) if (await dispatchDocumentGenerationJob(db, jobId)) handedOver += 1;
  const stale = await failStale(db);
  const cleaned = await cleanupEnded(db);
  return { unsent: toSend.length, handedOver, expired, ...stale, cleaned };
}
