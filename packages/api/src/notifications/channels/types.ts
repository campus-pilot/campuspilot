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
      /** Active (not revoked) push subscriptions of the admission's Cadet login, oldest first. */
      pushSubscriptionIds: string[];
    };

/** One remote copy a channel decided for one recipient. */
export type DeliveryDecision =
  | { status: 'owed'; destination: string | null }
  | { status: 'skipped'; reason: NotificationSkipReason; destination: string | null };

/**
 * What a provider call reported for one claimed delivery.
 * - `sent`: accepted by the provider.
 * - `retry`: transient (rate limit, 5xx, network) and certainly not sent.
 *   The delivery goes back to the queue (`owed`) with a later
 *   `next_attempt_at` by the channel's retry policy, a bounded number of
 *   times (D-7, D-41). `scope` says what the limit applies to: `recipient`
 *   (only this destination, e.g. WhatsApp's pair rate limit) or `channel`
 *   (every send on the channel, e.g. throughput limits or a provider
 *   outage), in which case the sender pauses the whole channel.
 *   `retryAfterMs` is the provider's own hint, if it gave one. An answer
 *   that leaves open whether the message went out is never `retry` but
 *   `failed` (see the WhatsApp client).
 * - `failed`: permanent; the delivery is `failed`.
 * - `skipped`: the channel re-checked the recipient at send time and must
 *   not send any more (e.g. WhatsApp consent was withdrawn by a STOP reply
 *   after the fan-out); the delivery is `skipped` with the reason.
 */
export type DeliverySendOutcome =
  | {
      kind: 'sent';
      providerMessageId: string | null;
      /** Template revision of an attached document (provenance of what was sent). */
      documentTemplateRevisionId?: string | null;
    }
  | { kind: 'skipped'; reason: NotificationSkipReason }
  | {
      kind: 'retry';
      errorCode: string;
      scope: 'recipient' | 'channel';
      retryAfterMs?: number;
      /**
       * Set when the provider said its daily messaging limit is reached
       * (WhatsApp): retried a day later instead of within minutes (D-41).
       */
      limit?: 'daily_messaging_limit';
    }
  | {
      kind: 'failed';
      errorCode: string;
      /** A safe explanation for staff (never provider prose with personal data). */
      errorMessage?: string;
    };

/** A delivery handed to a channel's sender after it was claimed. */
export type ClaimedDelivery = {
  id: string;
  notificationId: string;
  schoolId: string;
  /** The notification's admission (student types); null for staff recipients. */
  admissionId: string | null;
  type: NotificationType;
  data: Record<string, unknown>;
  destination: string | null;
};

/**
 * One remote channel (web push, WhatsApp). The in-app channel has no adapter:
 * the notification row is the in-app copy.
 * - `available: false` means this platform cannot send on the channel at all
 *   (switched off by its platform kill switch); every copy is then recorded
 *   as `skipped: disabled`, never faked as sent.
 * - `decide` is consulted only when the channel is available and the school
 *   is not a demo; it returns one decision per destination.
 * - `send` performs one provider call for a claimed delivery. It must not
 *   throw for provider answers; it classifies them as an outcome. A thrown
 *   error is treated like a transient failure of that one delivery
 *   (recipient scope: its own bounded retries, the lane keeps sending).
 */
export type NotificationChannelAdapter =
  | { channel: RemoteNotificationChannel; available: false; unavailableReason: string }
  | {
      channel: RemoteNotificationChannel;
      available: true;
      decide: (recipient: ResolvedRecipient) => DeliveryDecision[];
      send: (delivery: ClaimedDelivery) => Promise<DeliverySendOutcome>;
    };

/** `fetch` as the channels use it; injected in tests. */
export type ChannelFetch = (input: string, init: RequestInit) => Promise<Response>;
