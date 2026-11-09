import { db as defaultDb, type DatabaseExecutor } from '@campuspilot/db';
import { notificationEventTable } from '@campuspilot/db/schema/notification';
import { and, asc, eq, isNull, lt, or, sql, type SQL } from 'drizzle-orm';

import {
  cancelRestateInvocation,
  getRestateInvocation,
  type RestateInvocationStatus,
} from '../workflows/restate-admin';
import { MAX_NOTIFICATION_DISPATCH_ATTEMPTS } from '../workflows/notification/constants';
import { log } from '../workflows/notification/log';
import { sendNotificationDispatch, sendNotificationSenderPoke } from './notification.restate';
import { dueSenderTargets } from './sender/queue';

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

/** What one hand-over did: Restate accepted it, it was not owed, or Restate could not be reached. */
export type NotificationHandoverResult = 'sent' | 'not_pending' | 'failed';

/**
 * Sends a pending event that Restate has not accepted yet; true when
 * Restate accepted it. See {@link handOverNotificationEvent}.
 */
export async function dispatchNotificationEvent(db: DatabaseExecutor, eventId: string): Promise<boolean> {
  return (await handOverNotificationEvent(db, eventId)) === 'sent';
}

/**
 * Sends a pending event that Restate has not accepted yet. Every write is
 * conditional on the event still being unsubmitted, so a send racing another
 * replica changes nothing twice (both sends carry the same idempotency key,
 * so Restate runs one invocation). `failed` means Restate did not accept it
 * (unreachable, timed out); callers handing over many events stop at the
 * first one, since the rest would fail the same way.
 */
export async function handOverNotificationEvent(db: DatabaseExecutor, eventId: string): Promise<NotificationHandoverResult> {
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
  if (!event) return 'not_pending';
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
    return 'sent';
  } catch (error) {
    await db
      .update(notificationEventTable)
      .set({ submitAttempts: sql`${notificationEventTable.submitAttempts} + 1`, lastSubmitError: describeHandoverError(error), updatedAt: new Date() })
      .where(unsubmitted);
    log.warn({ eventId, reason: describeHandoverError(error) }, 'notification.handover.failed');
    return 'failed';
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

/** Hand-overs one {@link handOffNotificationEvents} call keeps in flight at once. */
const HANDOFF_CONCURRENCY = 4;

/**
 * Hands over many events after their emitting transaction committed (for
 * example one per bill of a billing run), at most {@link HANDOFF_CONCURRENCY}
 * at a time so a large run does not open thousands of Restate requests at
 * once. Not awaited by the caller. After the first failed hand-over every
 * worker stops (Restate is down: the rest would only wait for timeouts);
 * whatever is not handed over is left pending for the sweep.
 */
export function handOffNotificationEvents(eventIds: readonly string[], db: DatabaseExecutor = defaultDb) {
  if (eventIds.length === 0) return;
  const queue = [...new Set(eventIds)];
  let unreachable = false;
  const worker = async () => {
    for (let eventId = queue.shift(); eventId && !unreachable; eventId = queue.shift()) {
      try {
        if ((await handOverNotificationEvent(db, eventId)) === 'failed') unreachable = true;
      } catch (error) {
        log.error({ eventId, err: error instanceof Error ? { name: error.name, message: error.message } : String(error) }, 'notification.handover.error');
      }
    }
  };
  for (let index = 0; index < Math.min(HANDOFF_CONCURRENCY, queue.length); index += 1) void worker();
}

/**
 * Picks unsubmitted pending events, oldest first. The `FOR UPDATE SKIP
 * LOCKED` only keeps two replicas from picking the same rows at the same
 * instant: the lock ends when this transaction commits, before any send, so
 * it is not a claim. Concurrent sends of one event are harmless (same
 * idempotency key, writes conditional on still being unsubmitted).
 */
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

/**
 * Fails accepted events whose invocation Restate paused or that ended
 * without dispatching. Checks the least recently checked events first
 * (`stale_checked_at`, set on every check whatever its result), so fan-outs
 * that legitimately run for hours rotate to the back instead of filling
 * every sweep. A failed Restate admin call is logged and ends this pass (an
 * admin outage would fail every other check too, each after a timeout); the
 * event it was checking has rotated back, and the next sweep continues.
 */
export async function failStaleEvents(db: DatabaseExecutor, now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - STALE_CHECK_AFTER_MS);
  const events = await db
    .select({
      id: notificationEventTable.id,
      invocationId: notificationEventTable.invocationId,
      submitInvocationId: notificationEventTable.submitInvocationId,
    })
    .from(notificationEventTable)
    .where(and(eq(notificationEventTable.status, 'pending'), lt(notificationEventTable.submittedAt, cutoff)))
    .orderBy(sql`${notificationEventTable.staleCheckedAt} asc nulls first`, asc(notificationEventTable.submittedAt))
    .limit(SWEEP_LIMIT);
  let failed = 0;
  for (const event of events) {
    // The workflow run once the control service recorded it, else the control call itself.
    const checked = event.invocationId ?? event.submitInvocationId;
    await db.update(notificationEventTable).set({ staleCheckedAt: now }).where(eq(notificationEventTable.id, event.id));
    if (!checked) continue;
    let verdict: keyof typeof MESSAGES | null;
    try {
      verdict = staleVerdict((await getRestateInvocation(checked))?.status ?? null);
    } catch (error) {
      log.warn({ eventId: event.id, err: error instanceof Error ? { name: error.name, message: error.message } : String(error) }, 'notification.event.stale-check.failed');
      break;
    }
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
      failed += 1;
      log.warn({ eventId: event.id, verdict }, 'notification.event.stale');
      // The event is already failed (and retried as a new attempt); a cancel
      // that fails leaves only a paused invocation behind, so it never stops the pass.
      if (verdict === 'paused') {
        try {
          await cancelRestateInvocation(checked);
        } catch (error) {
          log.warn({ eventId: event.id, err: error instanceof Error ? { name: error.name, message: error.message } : String(error) }, 'notification.event.cancel.failed');
        }
      }
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
  // Only events already due are selected, so events still waiting never fill the batch.
  const dueAfterFirst = new Date(now.getTime() - retryDelayMs(1));
  const dueAfterLater = new Date(now.getTime() - retryDelayMs(2));
  const candidates = await db
    .select({ id: notificationEventTable.id, attempt: notificationEventTable.dispatchAttempt, updatedAt: notificationEventTable.updatedAt })
    .from(notificationEventTable)
    .where(
      and(
        eq(notificationEventTable.status, 'failed'),
        eq(notificationEventTable.failureRetryable, true),
        lt(notificationEventTable.dispatchAttempt, MAX_NOTIFICATION_DISPATCH_ATTEMPTS),
        or(
          and(eq(notificationEventTable.dispatchAttempt, 1), lt(notificationEventTable.updatedAt, dueAfterFirst)),
          and(sql`${notificationEventTable.dispatchAttempt} > 1`, lt(notificationEventTable.updatedAt, dueAfterLater)),
        ),
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
        staleCheckedAt: null,
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
 * Pokes every sender lane that has a delivery due (D-39): the safety net
 * behind the fan-out's own pokes, and what wakes a lane whose next retry
 * was further away than its drain waits. A lane already draining queues
 * one more drain, which finds what is left. Stops at the first poke
 * Restate does not accept.
 */
export async function pokeDueSenders(db: DatabaseExecutor, now: Date = new Date()): Promise<number> {
  let poked = 0;
  for (const target of await dueSenderTargets(db, now)) {
    try {
      await sendNotificationSenderPoke(target, now);
      poked += 1;
    } catch (error) {
      log.warn({ channel: target.channel, lane: target.lane, reason: describeHandoverError(error) }, 'notification.sender.poke.failed');
      break;
    }
  }
  return poked;
}

/**
 * One sweep, safe across API replicas and bounded. Sends run after the
 * picking transaction commits, so the control service sees the rows. The
 * sends stop at the first hand-over Restate did not accept (it is down; the
 * rest would each wait for a timeout and hold up the server's sweep loop).
 * The stale check runs even then: it uses the Restate admin API, which may
 * still answer, and it bounds itself the same way.
 */
export async function sweepNotificationOutbox(db: DatabaseExecutor = defaultDb) {
  const retried = await retryFailedEvents(db);
  const pending = await claimPendingEvents(db);
  let sent = 0;
  for (const eventId of pending) {
    const result = await handOverNotificationEvent(db, eventId);
    if (result === 'failed') break;
    if (result === 'sent') sent += 1;
  }
  const stale = await failStaleEvents(db);
  const poked = await pokeDueSenders(db);
  return { retried, pending: pending.length, sent, stale, poked };
}
