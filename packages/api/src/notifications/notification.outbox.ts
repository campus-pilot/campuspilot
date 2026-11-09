import { db as defaultDb, type DatabaseExecutor } from '@campuspilot/db';
import { notificationEventTable } from '@campuspilot/db/schema/notification';
import { and, asc, eq, isNull, lt, sql, type SQL } from 'drizzle-orm';

import {
  cancelRestateInvocation,
  getRestateInvocation,
  type RestateInvocationStatus,
} from '../workflows/restate-admin';
import { MAX_NOTIFICATION_DISPATCH_ATTEMPTS } from '../workflows/notification/constants';
import { log } from '../workflows/notification/log';
import { sendNotificationDispatch } from './notification.restate';

/**
 * The notification outbox: `notification_event` rows are the durable record
 * of fan-outs the API owes Restate. `notify()` writes the row in the
 * business transaction; the caller hands it over after commit
 * ({@link handOffNotificationEvent}); the sweep
 * ({@link sweepNotificationOutbox}, on the API server's 30 s loop) re-sends
 * events Restate has not accepted and fails events that can no longer
 * progress:
 * - a pending, unsubmitted event is re-sent indefinitely, showing its last
 *   hand-over error;
 * - an accepted event whose invocation Restate paused is marked failed
 *   (retryable) and its invocation cancelled;
 * - an accepted event whose invocation ended (or that Restate no longer
 *   knows) without dispatching is marked failed (retryable);
 * - a retryable failed event is dispatched again as its next attempt
 *   (a new workflow key), after {@link retryDelayMs}, up to
 *   `MAX_NOTIFICATION_DISPATCH_ATTEMPTS` attempts in all
 *   ({@link retryFailedEvents}). Re-running a fan-out is safe: rows have
 *   derived IDs and are inserted `ON CONFLICT DO NOTHING`, sent deliveries
 *   are no longer owed, and a delivery stuck in `sending` is never claimed
 *   again. Deterministic or cancelled failures are never retried; all
 *   failures stay visible to staff in the delivery log (Phase 7).
 */

/** Rows handled per sweep; the next sweep continues with the rest. */
const SWEEP_LIMIT = 50;
/** Accepted events are checked against Restate only after this long, to let them start. */
const STALE_CHECK_AFTER_MS = 2 * 60 * 1000;

const MESSAGES = {
  paused: 'The workflow engine paused this dispatch after repeated failures (is the worker running?).',
  ended: 'The dispatch ended without delivering the notification.',
} as const;

/** Safe one-line description of a hand-over failure (no URLs or secrets). */
function describeHandoverError(error: unknown) {
  if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) return 'Restate did not answer in time.';
  if (error instanceof Error && /WORKER_CONTROL_SECRET/.test(error.message)) return error.message;
  return 'Restate is unreachable.';
}

/**
 * Sends a pending event that Restate has not accepted yet. Every write is
 * conditional on the event still being unsubmitted, so a send racing another
 * replica changes nothing twice.
 */
export async function dispatchNotificationEvent(db: DatabaseExecutor, eventId: string): Promise<boolean> {
  const unsubmitted = and(
    eq(notificationEventTable.id, eventId),
    eq(notificationEventTable.status, 'pending'),
    isNull(notificationEventTable.submittedAt),
  );
  const [event] = await db
    .select({ id: notificationEventTable.id, attempt: notificationEventTable.dispatchAttempt })
    .from(notificationEventTable)
    .where(unsubmitted)
    .limit(1);
  if (!event) return false;
  try {
    const { invocationId } = await sendNotificationDispatch(eventId, event.attempt);
    await db
      .update(notificationEventTable)
      .set({
        submittedAt: new Date(),
        submitInvocationId: invocationId,
        submitAttempts: sql`${notificationEventTable.submitAttempts} + 1`,
        lastSubmitError: null,
        updatedAt: new Date(),
      })
      .where(unsubmitted);
    return true;
  } catch (error) {
    await db
      .update(notificationEventTable)
      .set({ submitAttempts: sql`${notificationEventTable.submitAttempts} + 1`, lastSubmitError: describeHandoverError(error), updatedAt: new Date() })
      .where(unsubmitted);
    log.warn({ eventId, reason: describeHandoverError(error) }, 'notification.handover.failed');
    return false;
  }
}

/**
 * Starts the hand-over of an event after the emitting transaction committed.
 * Not awaited by the caller; a failure is logged and left to the sweep.
 */
export function handOffNotificationEvent(eventId: string, db: DatabaseExecutor = defaultDb) {
  void dispatchNotificationEvent(db, eventId).catch((error: unknown) => {
    log.error({ eventId, err: error instanceof Error ? { name: error.name, message: error.message } : String(error) }, 'notification.handover.error');
  });
}

/** Claims unsubmitted pending events (`FOR UPDATE SKIP LOCKED`, so replicas take disjoint rows). */
async function claimPendingEvents(db: DatabaseExecutor): Promise<string[]> {
  return db.transaction(async (transaction) => {
    const rows = await transaction
      .select({ id: notificationEventTable.id })
      .from(notificationEventTable)
      .where(and(eq(notificationEventTable.status, 'pending'), isNull(notificationEventTable.submittedAt)))
      .orderBy(asc(notificationEventTable.createdAt))
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

/** Fails accepted events whose invocation Restate paused or that ended without dispatching. */
async function failStaleEvents(db: DatabaseExecutor): Promise<number> {
  const cutoff = new Date(Date.now() - STALE_CHECK_AFTER_MS);
  const events = await db
    .select({
      id: notificationEventTable.id,
      invocationId: notificationEventTable.invocationId,
      submitInvocationId: notificationEventTable.submitInvocationId,
    })
    .from(notificationEventTable)
    .where(and(eq(notificationEventTable.status, 'pending'), lt(notificationEventTable.submittedAt, cutoff)))
    .orderBy(asc(notificationEventTable.submittedAt))
    .limit(SWEEP_LIMIT);
  let failed = 0;
  for (const event of events) {
    // The workflow run once the control service recorded it, else the control call itself.
    const checked = event.invocationId ?? event.submitInvocationId;
    if (!checked) continue;
    const verdict = staleVerdict((await getRestateInvocation(checked))?.status ?? null);
    if (!verdict) continue;
    // Fenced by the invocation that was checked: if the control service
    // recorded the workflow run meanwhile, this changes nothing. Failed
    // first, then cancelled, so the cancelled run's own failure write (a
    // non-retryable "cancelled") finds the event no longer pending.
    const sameInvocation: SQL = event.invocationId
      ? eq(notificationEventTable.invocationId, event.invocationId)
      : isNull(notificationEventTable.invocationId);
    const [row] = await db
      .update(notificationEventTable)
      .set({ status: 'failed', error: MESSAGES[verdict], failureRetryable: true, updatedAt: new Date() })
      .where(and(eq(notificationEventTable.id, event.id), eq(notificationEventTable.status, 'pending'), sameInvocation))
      .returning({ id: notificationEventTable.id });
    if (row) {
      if (verdict === 'paused') await cancelRestateInvocation(checked);
      failed += 1;
      log.warn({ eventId: event.id, verdict }, 'notification.event.stale');
    }
  }
  return failed;
}

/** Wait before fan-out attempt `attempt + 1`: 10 minutes after the first failure, 30 after the second. */
export function retryDelayMs(failedAttempt: number): number {
  return (failedAttempt === 1 ? 10 : 30) * 60 * 1000;
}

/**
 * Puts retryable failed events back to pending as their next attempt, once
 * their retry delay has passed. Each update is conditional on the event
 * still being failed at that attempt, so replicas never retry twice.
 */
export async function retryFailedEvents(db: DatabaseExecutor, now: Date = new Date()): Promise<number> {
  const candidates = await db
    .select({ id: notificationEventTable.id, attempt: notificationEventTable.dispatchAttempt, updatedAt: notificationEventTable.updatedAt })
    .from(notificationEventTable)
    .where(
      and(
        eq(notificationEventTable.status, 'failed'),
        eq(notificationEventTable.failureRetryable, true),
        lt(notificationEventTable.dispatchAttempt, MAX_NOTIFICATION_DISPATCH_ATTEMPTS),
      ),
    )
    .orderBy(asc(notificationEventTable.updatedAt))
    .limit(SWEEP_LIMIT);
  let retried = 0;
  for (const event of candidates) {
    if (now.getTime() - event.updatedAt.getTime() < retryDelayMs(event.attempt)) continue;
    const [row] = await db
      .update(notificationEventTable)
      .set({
        status: 'pending',
        dispatchAttempt: event.attempt + 1,
        failureRetryable: null,
        error: null,
        submittedAt: null,
        submitInvocationId: null,
        invocationId: null,
        lastSubmitError: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(notificationEventTable.id, event.id),
          eq(notificationEventTable.status, 'failed'),
          eq(notificationEventTable.failureRetryable, true),
          eq(notificationEventTable.dispatchAttempt, event.attempt),
        ),
      )
      .returning({ id: notificationEventTable.id });
    if (row) {
      retried += 1;
      log.info({ eventId: event.id, attempt: event.attempt + 1 }, 'notification.event.retry');
    }
  }
  return retried;
}

/**
 * One sweep, safe across API replicas and bounded. Sends run after the
 * claiming transaction commits, so the control service sees the rows.
 */
export async function sweepNotificationOutbox(db: DatabaseExecutor = defaultDb) {
  const retried = await retryFailedEvents(db);
  const pending = await claimPendingEvents(db);
  let sent = 0;
  for (const eventId of pending) if (await dispatchNotificationEvent(db, eventId)) sent += 1;
  const stale = await failStaleEvents(db);
  return { retried, pending: pending.length, sent, stale };
}
