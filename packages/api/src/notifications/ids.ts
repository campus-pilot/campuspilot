import { createHash } from 'node:crypto';
import { PREFIX_MAP } from '@campuspilot/db/id';
import type { NotificationAudience, RemoteNotificationChannel } from '@campuspilot/db/notifications/catalogue';

/**
 * Derived row IDs (D-25). Fan-out runs at least once: a Restate step can
 * commit its inserts and then be replayed before the journal records it. IDs
 * computed from the inputs, together with `ON CONFLICT DO NOTHING`, make a
 * replay insert nothing new. The format matches `generateId` (prefix + 21
 * lowercase hex characters), so ID validators accept them.
 */
function derive(prefix: string, parts: readonly string[]) {
  // A separator that never occurs in IDs keeps ("a b", "c") distinct from ("a", "b c").
  const digest = createHash('sha256').update(parts.join('\u0000')).digest('hex');
  return `${prefix}_${digest.slice(0, 21)}`;
}

/** Inbox row of one recipient of one event. */
export function notificationRowId(eventId: string, recipient: { kind: NotificationAudience; id: string }) {
  return derive(PREFIX_MAP.notification, [eventId, recipient.kind, recipient.id]);
}

/**
 * Delivery row of one notification on one channel. `destination` is the
 * channel-specific address (push subscription ID); null for a channel with at
 * most one copy per notification (WhatsApp, or a skip without a destination).
 */
export function notificationDeliveryId(
  notificationId: string,
  channel: RemoteNotificationChannel,
  destination: string | null,
) {
  return derive(PREFIX_MAP.notificationDelivery, [notificationId, channel, destination ?? '']);
}
