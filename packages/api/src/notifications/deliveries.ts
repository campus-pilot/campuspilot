import type { DatabaseExecutor } from '@campuspilot/db';
import { notificationDeliveryTable, notificationTable } from '@campuspilot/db/schema/notification';
import type { NotificationType } from '@campuspilot/db/notifications/catalogue';
import { and, eq, sql } from 'drizzle-orm';

import type { ClaimedDelivery, DeliverySendOutcome } from './channels';

/**
 * The claim-before-send protocol (D-25). A delivery is moved `owed →
 * sending` by a conditional update immediately before the provider call, so
 * at most one worker attempt ever calls the provider for it. The outcome
 * moves it on:
 * - `sent` → `sent` (+ provider message ID);
 * - `retry` → back to `owed` (rate limit / transient), the caller retries
 *   after a durable backoff; on the caller's last attempt (`final`) it is
 *   `failed` instead, keeping the provider's error code (D-7);
 * - `failed` → `failed`;
 * - `skipped` → `skipped` with its reason (send-time re-check).
 * A delivery left in `sending` (the worker died between claim and outcome)
 * is never claimed again: it may have been sent. It is surfaced to staff.
 * Every update is conditional on `status = 'sending'`, so a late or repeated
 * outcome never overwrites a newer state.
 */

/** Claims one owed delivery; null when it is not owed any more. */
export async function claimDelivery(db: DatabaseExecutor, deliveryId: string): Promise<ClaimedDelivery | null> {
  const [claimed] = await db
    .update(notificationDeliveryTable)
    .set({
      status: 'sending',
      claimedAt: new Date(),
      attempts: sql`${notificationDeliveryTable.attempts} + 1`,
      updatedAt: new Date(),
    })
    .where(and(eq(notificationDeliveryTable.id, deliveryId), eq(notificationDeliveryTable.status, 'owed')))
    .returning({
      id: notificationDeliveryTable.id,
      notificationId: notificationDeliveryTable.notificationId,
      schoolId: notificationDeliveryTable.schoolId,
      destination: notificationDeliveryTable.destination,
    });
  if (!claimed) return null;
  const [notification] = await db
    .select({ type: notificationTable.type, data: notificationTable.data, admissionId: notificationTable.admissionId })
    .from(notificationTable)
    .where(eq(notificationTable.id, claimed.notificationId))
    .limit(1);
  if (!notification) return null;
  return { ...claimed, admissionId: notification.admissionId, type: notification.type as NotificationType, data: notification.data };
}

/** Shown on a delivery that was still being rate limited or failing transiently after its last attempt. */
export const RETRIES_EXHAUSTED_MESSAGE = 'Gave up after the last retry.';

/** Records the provider's outcome for a claimed delivery. */
export async function recordDeliveryOutcome(
  db: DatabaseExecutor,
  deliveryId: string,
  outcome: DeliverySendOutcome,
  options: { final?: boolean } = {},
) {
  const sending = and(eq(notificationDeliveryTable.id, deliveryId), eq(notificationDeliveryTable.status, 'sending'));
  const now = new Date();
  switch (outcome.kind) {
    case 'sent':
      await db
        .update(notificationDeliveryTable)
        .set({ status: 'sent', sentAt: now, providerMessageId: outcome.providerMessageId, errorCode: null, updatedAt: now })
        .where(sending);
      return;
    case 'retry':
      if (options.final) {
        await db
          .update(notificationDeliveryTable)
          .set({ status: 'failed', failedAt: now, errorCode: outcome.errorCode, errorMessage: RETRIES_EXHAUSTED_MESSAGE, updatedAt: now })
          .where(sending);
        return;
      }
      await db
        .update(notificationDeliveryTable)
        .set({ status: 'owed', claimedAt: null, errorCode: outcome.errorCode, updatedAt: now })
        .where(sending);
      return;
    case 'skipped':
      await db
        .update(notificationDeliveryTable)
        .set({ status: 'skipped', skipReason: outcome.reason, claimedAt: null, updatedAt: now })
        .where(sending);
      return;
    case 'failed':
      await db
        .update(notificationDeliveryTable)
        .set({ status: 'failed', failedAt: now, errorCode: outcome.errorCode, updatedAt: now })
        .where(sending);
      return;
    default: {
      const unhandled: never = outcome;
      throw new Error(`Unhandled delivery outcome ${JSON.stringify(unhandled)}.`);
    }
  }
}
