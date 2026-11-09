import type { DatabaseExecutor } from '@campuspilot/db';
import { notificationDeliveryTable, notificationTable } from '@campuspilot/db/schema/notification';
import type { NotificationType, RemoteNotificationChannel } from '@campuspilot/db/notifications/catalogue';
import { and, eq, lte, sql } from 'drizzle-orm';

import type { ClaimedDelivery, DeliverySendOutcome, NotificationSkipReason } from './channels';
import { decideRetry, type RetryCounters } from './sender/retry-policy';

/**
 * The claim-before-send protocol (D-25). A delivery is moved `owed →
 * sending` by a conditional update immediately before the provider call, so
 * at most one worker attempt ever calls the provider for it. The outcome
 * moves it on:
 * - `sent` → `sent` (+ provider message ID);
 * - `retry` → back to `owed` with a later `next_attempt_at` decided by the
 *   channel's retry policy (`./sender/retry-policy.ts`), so the channel's
 *   sender picks it up again then; once the policy gives up it is `failed`
 *   instead, keeping the provider's error code (D-7, D-41);
 * - `failed` → `failed`;
 * - `skipped` → `skipped` with its reason (send-time re-check).
 * A delivery left in `sending` (the worker died between claim and outcome)
 * is never claimed again: it may have been sent. The outbox sweep fails it
 * as `outcome_unknown` after `STUCK_SENDING_MS` (`./stuck-sending.ts`), so
 * it is alerted and staff may resend it; nothing resends it automatically.
 * Every update is conditional on `status = 'sending'`, so a late or repeated
 * outcome never overwrites a newer state.
 */

/** A claimed delivery with what recording its outcome needs. */
export type ClaimedQueueDelivery = ClaimedDelivery & { channel: RemoteNotificationChannel; retries: RetryCounters };

/**
 * Claims one owed delivery that is due at `now`; null when it is not owed
 * (any more) or not due yet. The claim and the read of its notification are
 * one statement (`UPDATE … FROM notification … RETURNING`), so a claim
 * always comes back with what sending needs: no failure between two
 * statements can leave a delivery `sending` that nobody holds.
 */
export async function claimDelivery(db: DatabaseExecutor, deliveryId: string, now: Date = new Date()): Promise<ClaimedQueueDelivery | null> {
  const [claimed] = await db
    .update(notificationDeliveryTable)
    .set({
      status: 'sending',
      claimedAt: now,
      nextAttemptAt: null,
      attempts: sql`${notificationDeliveryTable.attempts} + 1`,
      updatedAt: now,
    })
    .from(notificationTable)
    .where(
      and(
        eq(notificationDeliveryTable.id, deliveryId),
        eq(notificationDeliveryTable.status, 'owed'),
        lte(notificationDeliveryTable.nextAttemptAt, now),
        eq(notificationTable.id, notificationDeliveryTable.notificationId),
      ),
    )
    .returning({
      id: notificationDeliveryTable.id,
      notificationId: notificationDeliveryTable.notificationId,
      schoolId: notificationDeliveryTable.schoolId,
      channel: notificationDeliveryTable.channel,
      destination: notificationDeliveryTable.destination,
      quickRetries: notificationDeliveryTable.quickRetries,
      deferredRetries: notificationDeliveryTable.deferredRetries,
      dailyLimitRetries: notificationDeliveryTable.dailyLimitRetries,
      type: notificationTable.type,
      data: notificationTable.data,
      admissionId: notificationTable.admissionId,
    });
  if (!claimed) return null;
  const { quickRetries, deferredRetries, dailyLimitRetries, type, ...delivery } = claimed;
  return {
    ...delivery,
    retries: { quickRetries, deferredRetries, dailyLimitRetries },
    type: type as NotificationType,
  };
}

/** Shown on a delivery that was still being rate limited or failing transiently after its last attempt. */
export const RETRIES_EXHAUSTED_MESSAGE = 'Gave up after the last retry.';

/** What recording an outcome did; `retry` carries when the delivery is due again. */
export type RecordedOutcome =
  | { kind: 'sent' | 'failed' | 'skipped' }
  | { kind: 'retry'; nextAttemptAt: Date };

/**
 * Records the provider's outcome for a claimed delivery. A transient outcome
 * is rescheduled or given up by the channel's retry policy; `random` feeds
 * its jitter (injected so tests can pin it).
 */
export async function recordDeliveryOutcome(
  db: DatabaseExecutor,
  delivery: Pick<ClaimedQueueDelivery, 'id' | 'channel' | 'retries'>,
  outcome: DeliverySendOutcome,
  options: { now?: Date; random?: () => number } = {},
): Promise<RecordedOutcome> {
  const sending = and(eq(notificationDeliveryTable.id, delivery.id), eq(notificationDeliveryTable.status, 'sending'));
  const now = options.now ?? new Date();
  switch (outcome.kind) {
    case 'sent':
      await db
        .update(notificationDeliveryTable)
        .set({
          status: 'sent',
          sentAt: now,
          providerMessageId: outcome.providerMessageId,
          documentTemplateRevisionId: outcome.documentTemplateRevisionId ?? null,
          errorCode: null,
          errorMessage: null,
          updatedAt: now,
        })
        .where(sending);
      return { kind: 'sent' };
    case 'retry': {
      const decision = decideRetry(delivery.channel, outcome, delivery.retries, now, (options.random ?? Math.random)());
      if (decision.kind === 'give_up') {
        await db
          .update(notificationDeliveryTable)
          .set({ status: 'failed', failedAt: now, errorCode: outcome.errorCode, errorMessage: RETRIES_EXHAUSTED_MESSAGE, updatedAt: now })
          .where(sending);
        return { kind: 'failed' };
      }
      await db
        .update(notificationDeliveryTable)
        .set({
          status: 'owed',
          claimedAt: null,
          nextAttemptAt: decision.nextAttemptAt,
          errorCode: outcome.errorCode,
          ...decision.counters,
          updatedAt: now,
        })
        .where(sending);
      return { kind: 'retry', nextAttemptAt: decision.nextAttemptAt };
    }
    case 'skipped':
      await db
        .update(notificationDeliveryTable)
        .set({ status: 'skipped', skipReason: outcome.reason, claimedAt: null, updatedAt: now })
        .where(sending);
      return { kind: 'skipped' };
    case 'failed':
      await db
        .update(notificationDeliveryTable)
        .set({ status: 'failed', failedAt: now, errorCode: outcome.errorCode, errorMessage: outcome.errorMessage ?? null, updatedAt: now })
        .where(sending);
      return { kind: 'failed' };
    default: {
      const unhandled: never = outcome;
      throw new Error(`Unhandled delivery outcome ${JSON.stringify(unhandled)}.`);
    }
  }
}

/**
 * Records an owed delivery as skipped without claiming it (no provider call
 * happens, so no attempt is counted). Used when its channel was switched off
 * after the delivery was planned. False when it was not owed any more.
 */
export async function skipOwedDelivery(db: DatabaseExecutor, deliveryId: string, reason: NotificationSkipReason): Promise<boolean> {
  const skipped = await db
    .update(notificationDeliveryTable)
    .set({ status: 'skipped', skipReason: reason, nextAttemptAt: null, updatedAt: new Date() })
    .where(and(eq(notificationDeliveryTable.id, deliveryId), eq(notificationDeliveryTable.status, 'owed')))
    .returning({ id: notificationDeliveryTable.id });
  return skipped.length > 0;
}
