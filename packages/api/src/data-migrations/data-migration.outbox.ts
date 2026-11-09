import { db as defaultDb, type DatabaseExecutor } from '@campuspilot/db';
import { dataMigrationRunTable } from '@campuspilot/db/schema/data-migration';
import { and, asc, eq, inArray, isNull, lt, sql, type SQL } from 'drizzle-orm';

import {
  cancelRestateInvocation,
  getRestateInvocation,
  type RestateInvocationStatus,
} from '../workflows/restate-admin';
import { log } from '../workflows/data-migration/log';
import { sendDataMigrationStart } from './data-migration.restate';
import { registerPendingDataMigrations } from './run-store';

/**
 * The data migration outbox: `data_migration_run` rows are the durable record
 * of runs the API owes Restate. A requested run is handed over in the
 * background ({@link handOffDataMigrationRun}); the sweep
 * ({@link sweepDataMigrationOutbox}, on the API server's 30 s loop) re-sends
 * runs Restate has not accepted and fails runs that can no longer progress:
 * - a pending run is re-sent indefinitely (no deadline), showing its last
 *   hand-over error, because nothing else waits on it;
 * - an accepted run whose invocation Restate paused (its retry policy pauses
 *   after many failed attempts) is cancelled and marked failed;
 * - an accepted run whose invocation ended (or that Restate no longer knows)
 *   without finishing the run is marked failed.
 */

/** Rows handled per sweep; the next sweep continues with the rest. */
const SWEEP_LIMIT = 20;
/** Accepted runs are checked against Restate only after this long, to let them start. */
const STALE_CHECK_AFTER_MS = 60 * 1000;

const MESSAGES = {
  paused: 'The workflow engine paused this run after repeated failures (is the worker running?). Request a new run.',
  ended: 'The run ended without finishing. Request a new run.',
} as const;

/** Safe one-line description of a hand-over failure (no URLs or secrets). */
function describeHandoverError(error: unknown) {
  if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) return 'Restate did not answer in time.';
  if (error instanceof Error && /WORKER_CONTROL_SECRET/.test(error.message)) return error.message;
  return 'Restate is unreachable.';
}

/**
 * Sends a pending run that Restate has not accepted yet; true when Restate
 * accepted it. See {@link handOverDataMigrationRun}.
 */
export async function dispatchDataMigrationRun(db: DatabaseExecutor, runId: string): Promise<boolean> {
  return (await handOverDataMigrationRun(db, runId)) === 'sent';
}

/**
 * Sends a pending run that Restate has not accepted yet. Every write is
 * conditional on the run still being unsubmitted, so a send racing another
 * replica changes nothing twice (both carry the same idempotency key).
 * `failed` means Restate did not accept it (unreachable, timed out).
 */
async function handOverDataMigrationRun(db: DatabaseExecutor, runId: string): Promise<'sent' | 'not_pending' | 'failed'> {
  const unsubmitted = and(
    eq(dataMigrationRunTable.id, runId),
    eq(dataMigrationRunTable.status, 'pending'),
    isNull(dataMigrationRunTable.submittedAt),
  );
  const [run] = await db.select({ id: dataMigrationRunTable.id }).from(dataMigrationRunTable).where(unsubmitted).limit(1);
  if (!run) return 'not_pending';
  try {
    const { invocationId } = await sendDataMigrationStart(runId);
    await db
      .update(dataMigrationRunTable)
      .set({
        submittedAt: new Date(),
        submitInvocationId: invocationId,
        submitAttempts: sql`${dataMigrationRunTable.submitAttempts} + 1`,
        lastSubmitError: null,
        updatedAt: new Date(),
      })
      .where(unsubmitted);
    return 'sent';
  } catch (error) {
    await db
      .update(dataMigrationRunTable)
      .set({ submitAttempts: sql`${dataMigrationRunTable.submitAttempts} + 1`, lastSubmitError: describeHandoverError(error), updatedAt: new Date() })
      .where(unsubmitted);
    log.warn({ runId, reason: describeHandoverError(error) }, 'data-migration.handover.failed');
    return 'failed';
  }
}

/**
 * Starts the hand-over of a run after the response is decided. Not awaited
 * by the caller; a failure is logged and left to the sweep.
 */
export function handOffDataMigrationRun(runId: string, db: DatabaseExecutor = defaultDb) {
  void dispatchDataMigrationRun(db, runId).catch((error: unknown) => {
    log.error({ runId, err: error instanceof Error ? { name: error.name, message: error.message } : String(error) }, 'data-migration.handover.error');
  });
}

/**
 * Picks unsubmitted pending runs, oldest first. The `FOR UPDATE SKIP LOCKED`
 * only keeps two replicas from picking the same rows at the same instant:
 * the lock ends when this transaction commits, before any send, so it is not
 * a claim. Concurrent sends of one run are harmless (same idempotency key,
 * writes conditional on still being unsubmitted).
 */
async function claimPendingRuns(db: DatabaseExecutor): Promise<string[]> {
  return db.transaction(async (transaction) => {
    const rows = await transaction
      .select({ id: dataMigrationRunTable.id })
      .from(dataMigrationRunTable)
      .where(and(eq(dataMigrationRunTable.status, 'pending'), isNull(dataMigrationRunTable.submittedAt)))
      .orderBy(asc(dataMigrationRunTable.requestedAt))
      .limit(SWEEP_LIMIT)
      .for('update', { skipLocked: true });
    return rows.map((row) => row.id);
  });
}

/** `paused` or ended (completed, or unknown to Restate) is a failure; anything else is progressing. */
function staleVerdict(status: RestateInvocationStatus | null): keyof typeof MESSAGES | null {
  if (status === 'paused') return 'paused';
  if (status === null || status === 'completed') return 'ended';
  return null;
}

/**
 * Fails accepted runs whose invocation Restate paused or that ended without
 * finishing. A failed Restate admin call is logged and ends this pass (an
 * admin outage would fail every other check too, each after a timeout); the
 * next sweep checks again. No rotation is needed: at most one run per
 * migration is pending or running (partial unique index), so every active
 * run fits in one pass.
 */
async function failStaleRuns(db: DatabaseExecutor): Promise<number> {
  const cutoff = new Date(Date.now() - STALE_CHECK_AFTER_MS);
  const runs = await db
    .select({
      id: dataMigrationRunTable.id,
      invocationId: dataMigrationRunTable.invocationId,
      submitInvocationId: dataMigrationRunTable.submitInvocationId,
    })
    .from(dataMigrationRunTable)
    .where(and(inArray(dataMigrationRunTable.status, ['pending', 'running']), lt(dataMigrationRunTable.submittedAt, cutoff)))
    .orderBy(asc(dataMigrationRunTable.submittedAt))
    .limit(SWEEP_LIMIT);
  let failed = 0;
  for (const run of runs) {
    // The workflow run once the control service recorded it, else the control call itself.
    const checked = run.invocationId ?? run.submitInvocationId;
    if (!checked) continue;
    let verdict: keyof typeof MESSAGES | null;
    try {
      verdict = staleVerdict((await getRestateInvocation(checked))?.status ?? null);
      if (verdict === 'paused') await cancelRestateInvocation(checked);
    } catch (error) {
      log.warn({ runId: run.id, err: error instanceof Error ? { name: error.name, message: error.message } : String(error) }, 'data-migration.run.stale-check.failed');
      break;
    }
    if (!verdict) continue;
    // Fenced by the invocation that was checked: if the control service
    // recorded the workflow run meanwhile, this changes nothing.
    const sameInvocation: SQL = run.invocationId
      ? eq(dataMigrationRunTable.invocationId, run.invocationId)
      : isNull(dataMigrationRunTable.invocationId);
    const [row] = await db
      .update(dataMigrationRunTable)
      .set({ status: 'failed', error: MESSAGES[verdict], finishedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(dataMigrationRunTable.id, run.id), inArray(dataMigrationRunTable.status, ['pending', 'running']), sameInvocation))
      .returning({ id: dataMigrationRunTable.id });
    if (row) {
      failed += 1;
      log.warn({ runId: run.id, verdict }, 'data-migration.run.stale');
    }
  }
  return failed;
}

/**
 * One sweep, safe across API replicas and bounded. With `register` (the
 * first sweep after boot) it first registers an apply run for every
 * migration that needs one (see `registerPendingDataMigrations`). Sends run
 * after the picking transaction commits, so the control service sees the
 * rows, and stop at the first hand-over Restate did not accept (the rest
 * would each wait for a timeout and hold up the server's sweep loop).
 */
export async function sweepDataMigrationOutbox(options: { register: boolean }, db: DatabaseExecutor = defaultDb) {
  const registered = options.register ? (await registerPendingDataMigrations(db)).length : 0;
  const pending = await claimPendingRuns(db);
  let sent = 0;
  for (const runId of pending) {
    const result = await handOverDataMigrationRun(db, runId);
    if (result === 'failed') break;
    if (result === 'sent') sent += 1;
  }
  const stale = await failStaleRuns(db);
  return { registered, pending: pending.length, sent, stale };
}
