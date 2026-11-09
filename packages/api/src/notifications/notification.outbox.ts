import { db as defaultDb, type DatabaseExecutor } from '@campuspilot/db';
import { notificationEventTable } from '@campuspilot/db/schema/notification';
import { and, asc, eq, isNull, lt, or, sql, type SQL } from 'drizzle-orm';

import {
  cancelRestateInvocation,
  getRestateInvocation,
  killRestateInvocation,
  listLiveRestateInvocations,
  type LiveRestateInvocation,
  type RestateInvocationStatus,
} from '../workflows/restate-admin';
import { MAX_NOTIFICATION_DISPATCH_ATTEMPTS, NOTIFICATION_SENDER_OBJECT_NAME } from '../workflows/notification/constants';
import { log } from '../workflows/notification/log';
import { sendNotificationDispatch, sendNotificationSenderPoke } from './notification.restate';
import { senderKey } from './sender/lanes';
import { dueSenderTargets } from './sender/queue';
import { failStuckSendingDeliveries } from './stuck-sending';

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

/** Rows handled per sweep by the stale check and the retry pass; the next sweep continues with the rest. */
const SWEEP_LIMIT = 50;
/** Unsubmitted events picked per hand-over round of a sweep. */
const HANDOVER_BATCH = 200;
/**
 * Time a sweep spends starting hand-over rounds; it keeps picking rounds
 * while full ones come back. With {@link HANDOFF_CONCURRENCY} in flight a
 * Restate answer of ~10 ms hands over several thousand events per sweep, so
 * a lost in-process hand-off of a 5,000-bill run catches up in a sweep or
 * two instead of 50 minutes at 50 events per 30 s. Bounded so the other
 * sweeps of the 30 s loop still run.
 */
const HANDOVER_BUDGET_MS = 15_000;
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

/** Hand-overs kept in flight at once by {@link handOverEvents}. */
const HANDOFF_CONCURRENCY = 4;

/**
 * Hands over many events, at most {@link HANDOFF_CONCURRENCY} at a time so a
 * large batch does not open thousands of Restate requests at once. After
 * the first hand-over Restate did not accept every worker stops (Restate is
 * down: the rest would only wait for timeouts); whatever is not handed over
 * stays pending for the sweep. An error of one hand-over (database) is
 * logged and the others continue.
 */
async function handOverEvents(db: DatabaseExecutor, eventIds: readonly string[]): Promise<{ sent: number; unreachable: boolean }> {
  const queue = [...new Set(eventIds)];
  let unreachable = false;
  let sent = 0;
  const worker = async () => {
    for (let eventId = queue.shift(); eventId && !unreachable; eventId = queue.shift()) {
      try {
        const result = await handOverNotificationEvent(db, eventId);
        if (result === 'failed') unreachable = true;
        if (result === 'sent') sent += 1;
      } catch (error) {
        log.error({ eventId, err: error instanceof Error ? { name: error.name, message: error.message } : String(error) }, 'notification.handover.error');
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(HANDOFF_CONCURRENCY, queue.length) }, () => worker()));
  return { sent, unreachable };
}

/**
 * Hands over many events after their emitting transaction committed (for
 * example one per bill of a billing run) through {@link handOverEvents}.
 * Not awaited by the caller.
 */
export function handOffNotificationEvents(eventIds: readonly string[], db: DatabaseExecutor = defaultDb) {
  if (eventIds.length === 0) return;
  void handOverEvents(db, eventIds);
}

/**
 * Picks unsubmitted pending events, oldest first. The `FOR UPDATE SKIP
 * LOCKED` only keeps two replicas from picking the same rows at the same
 * instant: the lock ends when this transaction commits, before any send, so
 * it is not a claim. Concurrent sends of one event are harmless (same
 * idempotency key, writes conditional on still being unsubmitted).
 */
async function claimPendingEvents(db: DatabaseExecutor, limit: number): Promise<string[]> {
  return db.transaction(async (transaction) => {
    const rows = await transaction
      .select({ id: notificationEventTable.id })
      .from(notificationEventTable)
      .where(and(eq(notificationEventTable.status, 'pending'), isNull(notificationEventTable.submittedAt)))
      .orderBy(asc(notificationEventTable.createdAt))
      .limit(limit)
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

/** What one {@link pokeDueSenders} pass did. */
export type SenderPokeResult = {
  /** Lanes poked. */
  poked: number;
  /** Due lanes left alone because a drain is already inboxed, running or waiting there. */
  busy: number;
  /** Paused drains killed (each blocked its lane). */
  killed: number;
};

/** Safe one-line description of an admin API failure. */
function describeAdminError(error: unknown) {
  return error instanceof Error ? { name: error.name, message: error.message } : String(error);
}

/**
 * Pokes every sender lane that has a delivery due (D-39): the safety net
 * behind the fan-out's own pokes, and what wakes a lane whose next retry
 * was further away than its drain waits.
 *
 * It first asks Restate which `NotificationSender` drains have not
 * completed:
 * - a **paused** drain (Restate gave up retrying it, e.g. the worker kept
 *   failing) holds its lane's lock, so every later drain would queue behind
 *   it forever. It is logged as an error and killed (kill, not cancel: a
 *   cancel only takes effect once the paused invocation resumes). A row it
 *   had claimed stays `sending` and is failed as `outcome_unknown` after
 *   `STUCK_SENDING_MS`. The lane is then poked like any other, unless a
 *   drain queued behind the killed one takes over.
 * - a lane with a drain inboxed, scheduled, running, backing off or
 *   suspended is **not** poked: that drain picks every due row before it
 *   ends, so a poke would only add another drain to the object's inbox
 *   (one per sweep per replica, piling up while the drain runs).
 * If Restate's admin API does not answer, every due lane is poked as
 * before (a poke is harmless, only wasteful). Pokes stop at the first one
 * Restate does not accept.
 */
export async function pokeDueSenders(db: DatabaseExecutor, now: Date = new Date()): Promise<SenderPokeResult> {
  const result: SenderPokeResult = { poked: 0, busy: 0, killed: 0 };
  const due = await dueSenderTargets(db, now);
  let live: LiveRestateInvocation[] | null;
  try {
    live = await listLiveRestateInvocations(NOTIFICATION_SENDER_OBJECT_NAME);
  } catch (error) {
    log.warn({ err: describeAdminError(error) }, 'notification.sender.status.failed');
    live = null;
  }
  /** Lanes whose lock is held by a drain that is progressing, or by a paused one that could not be killed. */
  const blocked = new Set<string>();
  for (const invocation of live ?? []) {
    if (!invocation.key) continue;
    if (invocation.status !== 'paused') {
      blocked.add(invocation.key);
      continue;
    }
    log.error({ sender: invocation.key, invocationId: invocation.id }, 'notification.sender.paused');
    try {
      await killRestateInvocation(invocation.id);
      result.killed += 1;
    } catch (error) {
      log.warn({ sender: invocation.key, invocationId: invocation.id, err: describeAdminError(error) }, 'notification.sender.kill.failed');
      blocked.add(invocation.key);
    }
  }
  for (const target of due) {
    if (blocked.has(senderKey(target))) {
      result.busy += 1;
      continue;
    }
    try {
      await sendNotificationSenderPoke(target, now);
      result.poked += 1;
    } catch (error) {
      log.warn({ channel: target.channel, lane: target.lane, reason: describeHandoverError(error) }, 'notification.sender.poke.failed');
      break;
    }
  }
  return result;
}

/**
 * One sweep, safe across API replicas and bounded. Hand-overs run in rounds
 * of {@link HANDOVER_BATCH} for up to {@link HANDOVER_BUDGET_MS}, each after
 * the picking transaction commits, so the control service sees the rows.
 * They stop at the first hand-over Restate did not accept (it is down; the
 * rest would each wait for a timeout and hold up the server's sweep loop).
 * The stale check runs even then: it uses the Restate admin API, which may
 * still answer, and it bounds itself the same way. Deliveries stranded in
 * `sending` are failed as `outcome_unknown` (see `./stuck-sending.ts`).
 */
export async function sweepNotificationOutbox(db: DatabaseExecutor = defaultDb) {
  const retried = await retryFailedEvents(db);
  let pending = 0;
  let sent = 0;
  const deadline = Date.now() + HANDOVER_BUDGET_MS;
  do {
    const batch = await claimPendingEvents(db, HANDOVER_BATCH);
    pending += batch.length;
    const round = await handOverEvents(db, batch);
    sent += round.sent;
    if (round.unreachable || batch.length < HANDOVER_BATCH) break;
  } while (Date.now() < deadline);
  const stale = await failStaleEvents(db);
  const interrupted = await failStuckSendingDeliveries(db);
  if (interrupted > 0) log.warn({ interrupted }, 'notification.delivery.interrupted');
  const senders = await pokeDueSenders(db);
  return { retried, pending, sent, stale, interrupted, ...senders };
}
