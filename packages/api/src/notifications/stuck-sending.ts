import type { DatabaseExecutor } from '@campuspilot/db';
import type { RemoteNotificationChannel } from '@campuspilot/db/notifications/catalogue';
import { notificationDeliveryTable } from '@campuspilot/db/schema/notification';
import { and, eq, lt } from 'drizzle-orm';

import { OUTCOME_UNKNOWN_ERROR_CODE } from './channels/whatsapp/client';

/**
 * Deliveries stranded in `sending` (D-25, refined in review round 3). A
 * delivery is claimed (`owed → sending`) immediately before its provider
 * call and moved on by the outcome in the same journaled step; one still
 * `sending` after {@link STUCK_SENDING_MS} was interrupted between the two
 * (the worker died, or a drain was killed mid-send), so it may or may not
 * have been sent.
 *
 * It is never claimed or retried automatically (a retry could message the
 * guardian twice). The outbox sweep moves it to `failed` with the same
 * `outcome_unknown` code as an ambiguous provider answer, so it flows into
 * the failure alerts (WhatsApp, D-38) and staff may resend it deliberately,
 * exactly like an ambiguous send.
 */

/**
 * How long a claim may go without an outcome before the delivery counts as
 * interrupted. One send takes seconds (a 20 s request timeout); an hour is
 * far beyond any step retry. The single value used everywhere a stale claim
 * matters: the sweep below, batch failure alerts, settling a results
 * publication and the delivery log's "interrupted" flag.
 */
export const STUCK_SENDING_MS = 60 * 60 * 1000;

/** What staff see on an interrupted delivery, per channel (no provider prose). */
export const INTERRUPTED_SEND_MESSAGE: Record<RemoteNotificationChannel, string> = {
  whatsapp: 'Sending was interrupted; WhatsApp may or may not have sent this message. Check with the guardian before resending.',
  web_push: 'Sending was interrupted; the device may or may not have received this notification.',
};

/** The claimed-before time after which a `sending` delivery is interrupted. */
export function stuckSendingCutoff(now: Date): Date {
  return new Date(now.getTime() - STUCK_SENDING_MS);
}

/**
 * Fails every delivery claimed before the cutoff that is still `sending`.
 * Conditional on `status = 'sending'` and the claim time, so an outcome
 * recorded meanwhile wins and replicas never fail a row twice. Returns how
 * many rows it failed.
 */
export async function failStuckSendingDeliveries(db: DatabaseExecutor, now: Date = new Date()): Promise<number> {
  let failed = 0;
  for (const channel of Object.keys(INTERRUPTED_SEND_MESSAGE) as RemoteNotificationChannel[]) {
    const rows = await db
      .update(notificationDeliveryTable)
      .set({ status: 'failed', failedAt: now, errorCode: OUTCOME_UNKNOWN_ERROR_CODE, errorMessage: INTERRUPTED_SEND_MESSAGE[channel], updatedAt: now })
      .where(
        and(
          eq(notificationDeliveryTable.channel, channel),
          eq(notificationDeliveryTable.status, 'sending'),
          lt(notificationDeliveryTable.claimedAt, stuckSendingCutoff(now)),
        ),
      )
      .returning({ id: notificationDeliveryTable.id });
    failed += rows.length;
  }
  return failed;
}
