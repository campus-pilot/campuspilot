import type { NotificationType, RemoteNotificationChannel } from '@campuspilot/db/notifications/catalogue';
import type { notificationSkipReasonEnum } from '@campuspilot/db/schema/notification';

export type NotificationSkipReason = (typeof notificationSkipReasonEnum.enumValues)[number];

/**
 * A recipient as the dispatcher resolved it, with the facts a channel needs
 * to decide. Contact facts are snapshots read at fan-out time.
 */
export type ResolvedRecipient =
  | { kind: 'staff_user'; id: string }
  | {
      kind: 'admission';
      id: string;
      whatsappNo: string | null;
      whatsappVerified: boolean;
      whatsappConsent: boolean;
    };

/** One remote copy a channel decided for one recipient. */
export type DeliveryDecision =
  | { status: 'owed'; destination: string | null }
  | { status: 'skipped'; reason: NotificationSkipReason; destination: string | null };

/** What a provider call reported for one claimed delivery. */
export type DeliverySendOutcome =
  /** Accepted by the provider. */
  | { kind: 'sent'; providerMessageId: string | null }
  /** Transient (rate limit, 5xx): released back to `owed` and retried later. */
  | { kind: 'retry'; errorCode: string }
  /** Permanent: the delivery is `failed`. */
  | { kind: 'failed'; errorCode: string };

/** A delivery handed to a channel's sender after it was claimed. */
export type ClaimedDelivery = {
  id: string;
  notificationId: string;
  schoolId: string;
  type: NotificationType;
  data: Record<string, unknown>;
  destination: string | null;
};

/**
 * One remote channel (web push, WhatsApp). The in-app channel has no adapter:
 * the notification row is the in-app copy.
 * - `available: false` means this platform cannot send on the channel at all
 *   (not built in this release, or switched off by a platform kill switch);
 *   every copy is then recorded as `skipped: disabled`, never faked as sent.
 * - `decide` is consulted only when the channel is available and the school
 *   is not a demo; it returns one decision per destination.
 * - `send` performs one provider call for a claimed delivery.
 */
export type NotificationChannelAdapter =
  | { channel: RemoteNotificationChannel; available: false; unavailableReason: string }
  | {
      channel: RemoteNotificationChannel;
      available: true;
      decide: (recipient: ResolvedRecipient) => DeliveryDecision[];
      send: (delivery: ClaimedDelivery) => Promise<DeliverySendOutcome>;
    };

/**
 * The adapter of every remote channel. Exhaustive by type: a new remote
 * channel fails the build until it has an adapter.
 *
 * Phase 2 ships the notification core and the inbox only. Web push arrives
 * in Phase 3 and WhatsApp in Phase 4 (each behind its own env kill switch),
 * so both are unavailable here and every student copy is recorded as
 * `skipped: disabled`.
 */
export const notificationChannelAdapters: Record<RemoteNotificationChannel, NotificationChannelAdapter> = {
  web_push: { channel: 'web_push', available: false, unavailableReason: 'Web push is not built yet (plan Phase 3).' },
  whatsapp: { channel: 'whatsapp', available: false, unavailableReason: 'WhatsApp is not built yet (plan Phase 4).' },
};

/**
 * Decides a recipient's copies on one channel. Precedence, first match wins:
 * 1. the channel is unavailable on this platform → `skipped: disabled`;
 * 2. the school is a demo school → `skipped: demo_school` (demos never send
 *    outside the inbox);
 * 3. the channel's own decision for the recipient (number, verification,
 *    consent, subscriptions, opt-out).
 */
export function decideDeliveries(
  adapter: NotificationChannelAdapter,
  context: { isDemoSchool: boolean; recipient: ResolvedRecipient },
): DeliveryDecision[] {
  if (!adapter.available) return [{ status: 'skipped', reason: 'disabled', destination: null }];
  if (context.isDemoSchool) return [{ status: 'skipped', reason: 'demo_school', destination: null }];
  return adapter.decide(context.recipient);
}
