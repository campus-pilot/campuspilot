import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  index,
  integer,
  smallint,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { generateId } from "../id";
import {
  NOTIFICATION_AUDIENCES,
  REMOTE_NOTIFICATION_CHANNELS,
  type NotificationRecipientSpec,
} from "../notifications/catalogue";
import { admissionTable } from "./admission";
import { user } from "./auth";
import { cadetSession, cadetUser } from "./cadet";
import { schoolTable } from "./school";

/**
 * Notification tables (plan §4, D-20 … D-29). Three explicit layers:
 * `notification_event` (one outbox row per emitted event, written in the
 * caller's transaction), `notification` (one inbox row per recipient, written
 * by the worker) and `notification_delivery` (one row per remote channel copy
 * of a notification). Type and payload come from the code catalogue
 * (`@campuspilot/db/notifications/catalogue`); `type` is stored as text, so a
 * retired type never breaks a read (reads filter to known types).
 */

/**
 * Fan-out state of an event:
 * - `pending`: written, not yet fanned out by the worker;
 * - `dispatched`: every inbox row and delivery row was written;
 * - `failed`: the worker gave up (`error` says why); its rows may be partial.
 */
export const notificationEventStatusEnum = pgEnum("notification_event_status", [
  "pending",
  "dispatched",
  "failed",
]);

export const notificationRecipientKindEnum = pgEnum(
  "notification_recipient_kind",
  NOTIFICATION_AUDIENCES,
);

export const notificationDeliveryChannelEnum = pgEnum(
  "notification_delivery_channel",
  REMOTE_NOTIFICATION_CHANNELS,
);

/**
 * Status of one remote copy (D-25, D-29):
 * - `owed`: decided to send, not yet claimed;
 * - `sending`: claimed by a worker immediately before the provider call. A
 *   row stuck here means the worker died mid-send; it is surfaced to staff,
 *   never retried automatically (it may have been sent);
 * - `sent`: the provider accepted it;
 * - `delivered` / `read`: provider receipts (WhatsApp webhooks), monotonic;
 * - `failed`: given up after bounded retries or a permanent provider error;
 * - `skipped`: deliberately not sent; `skip_reason` says why.
 */
export const notificationDeliveryStatusEnum = pgEnum(
  "notification_delivery_status",
  ["owed", "sending", "sent", "delivered", "read", "failed", "skipped"],
);

/**
 * Why a delivery was skipped (D-26, plus `not_verified` from D-4):
 * - `no_number`: the admission has no WhatsApp number;
 * - `not_verified`: the WhatsApp number is not verified by staff;
 * - `no_consent`: the guardian has not consented to WhatsApp;
 * - `opted_out`: the recipient opted out (later: Cadet preferences, STOP);
 * - `no_subscription`: no active web push subscription;
 * - `demo_school`: demo schools never send outside the inbox;
 * - `disabled`: the channel is switched off or not available on this
 *   platform (kill switch, or no adapter in this release);
 * - `feature_disabled`: the school does not have a platform feature the
 *   notification belongs to (`notificationRequiredFeatures`), for example a
 *   notice copy that was still owed when `notices` was switched off. It is
 *   about the school, not the channel, so it is its own reason.
 */
export const notificationSkipReasonEnum = pgEnum("notification_skip_reason", [
  "no_number",
  "not_verified",
  "no_consent",
  "opted_out",
  "no_subscription",
  "demo_school",
  "disabled",
  "feature_disabled",
]);

/**
 * How urgently an event's remote copies are sent (D-39). The channel
 * senders pick `immediate` copies before `bulk` ones (declaration order is
 * the sort order):
 * - `immediate`: one-off sends a person is waiting for (a payment receipt,
 *   a manual bill, a single result send, a staff resend);
 * - `bulk`: one copy of many (a billing run's bills, a results
 *   publication).
 * Stated by the emitter on every event, never derived from its type or batch.
 */
export const notificationSendPriorityEnum = pgEnum("notification_send_priority", [
  "immediate",
  "bulk",
]);

/**
 * The bulk action an event belongs to (D-38): failure alerts of one batch
 * are grouped into one staff notification.
 * - `billing_run`: one `bill.issued` per bill of a posted billing run;
 * - `result_publication`: one `exam.results_published` per student of a
 *   results publication;
 * - `notice`: one `notice.published` per student a published notice is
 *   addressed to (the batch ID is the notice ID).
 */
export const notificationBatchKindEnum = pgEnum("notification_batch_kind", [
  "billing_run",
  "result_publication",
  "notice",
]);

/**
 * The notification outbox: one row per emitted event, written by `notify()`
 * in the business transaction (D-23, D-24), then handed to the signed
 * `NotificationControl` Restate service; the API's 30 s sweep re-sends events
 * Restate has not accepted. The `NotificationDispatch` workflow (keyed by the
 * event ID) fans it out to `notification` and `notification_delivery` rows.
 */
export const notificationEventTable = pgTable(
  "notification_event",
  {
    id: text("id")
      .primaryKey()
      .$default(() => generateId("notificationEvent")),
    schoolId: text("school_id")
      .notNull()
      .references(() => schoolTable.id),
    /**
     * The emitter's idempotency key for this event within the school (for
     * example `payment:<paymentId>`). A second `notify()` with the same key
     * returns the existing event instead of writing another.
     */
    key: text("key").notNull(),
    /** Catalogue type; text so retired types stay readable. */
    type: text("type").notNull(),
    /** Catalogue facts, validated against the type's schema when written. */
    data: jsonb("data").$type<Record<string, unknown>>().notNull(),
    /** Who it is addressed to, as stated by the emitter; resolved by the worker. */
    recipients: jsonb("recipients").$type<NotificationRecipientSpec>().notNull(),
    /** Staff member whose action emitted it; null for system events or a deleted account. */
    createdBy: text("created_by").references(() => user.id, {
      onDelete: "set null",
    }),
    /** Send priority of the event's remote copies, stated by the emitter (D-39). */
    sendPriority: notificationSendPriorityEnum("send_priority").notNull(),
    /**
     * The bulk action this event is one of (D-38), with {@link batchId};
     * both null for a one-off event. Failure alerts are grouped per batch.
     */
    batchKind: notificationBatchKindEnum("batch_kind"),
    /** The billing run, results publication or notice ID (see `batch_kind`). */
    batchId: text("batch_id"),
    /**
     * Whether `created_by` asked for this very send (a single result send,
     * a resend) and is told when its WhatsApp copy fails, besides the
     * staff granted failure alerts (D-38). False when the creator's action
     * only caused the notification (recording a payment, posting a run).
     */
    alertCreatorOnFailure: boolean("alert_creator_on_failure").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    status: notificationEventStatusEnum("status").notNull().default("pending"),
    /** When Restate durably accepted the hand-over to `NotificationControl.dispatch`. */
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    submitInvocationId: text("submit_invocation_id"),
    submitAttempts: integer("submit_attempts").notNull().default(0),
    /** Safe summary of the last failed hand-over. */
    lastSubmitError: text("last_submit_error"),
    /** Restate invocation of the `NotificationDispatch` workflow. */
    invocationId: text("invocation_id"),
    /**
     * When the outbox sweep last checked this accepted event's invocation
     * against Restate. The sweep checks the least recently checked events
     * first, so fan-outs that legitimately run for hours (durable send
     * backoff) cannot keep newer events from ever being checked.
     */
    staleCheckedAt: timestamp("stale_checked_at", { withTimezone: true }),
    /** Inbox rows the fan-out created (set when dispatched). */
    notificationCount: integer("notification_count"),
    dispatchedAt: timestamp("dispatched_at", { withTimezone: true }),
    /** Safe failure summary (status `failed`); never SQL or personal data. */
    error: text("error"),
    /**
     * Set when staff resend one failed delivery (Phase 7): this event then
     * owns no inbox row; its fan-out writes one new delivery for the same
     * notification and channel (recipient facts re-read) and sends it.
     * Deleted with the delivery it resends.
     */
    redeliveryOfDeliveryId: text("redelivery_of_delivery_id").references(
      (): AnyPgColumn => notificationDeliveryTable.id,
      { onDelete: "cascade" },
    ),
    /**
     * Which fan-out attempt this is (1-based). A retryable failure is
     * dispatched again as the next attempt under a new workflow key, up to
     * a bounded number of attempts (see the API's notification outbox).
     */
    dispatchAttempt: integer("dispatch_attempt").notNull().default(1),
    /**
     * Set with status `failed`: whether the failure was transient (worker
     * or database unavailable, Restate paused the run) and may be retried
     * automatically, or deterministic / deliberate (unknown type, recipient
     * mismatch, cancelled) and must not be. Null while not failed.
     */
    failureRetryable: boolean("failure_retryable"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("notification_event_school_key_unique").on(
      table.schoolId,
      table.key,
    ),
    index("notification_event_status_idx").on(table.status, table.createdAt),
    index("notification_event_created_idx").on(table.createdAt),
    index("notification_event_redelivery_idx")
      .on(table.redeliveryOfDeliveryId)
      .where(sql`${table.redeliveryOfDeliveryId} is not null`),
    check(
      "notification_event_failure_retryable_check",
      sql`(${table.status} = 'failed') = (${table.failureRetryable} is not null)`,
    ),
    check(
      "notification_event_batch_check",
      sql`(${table.batchKind} is null) = (${table.batchId} is null)`,
    ),
    index("notification_event_batch_idx")
      .on(table.schoolId, table.batchKind, table.batchId)
      .where(sql`${table.batchKind} is not null`),
    // The delivery log's "still being prepared" counts read one school's
    // pending and failed events (polled every two seconds while a bulk
    // action fans out). Without this they scanned every school's.
    index("notification_event_school_unsettled_idx")
      .on(table.schoolId, table.status)
      .where(sql`${table.status} in ('pending', 'failed')`),
  ],
);

/**
 * One inbox row per recipient (D-20, D-21). The ID is derived from (event,
 * recipient), so a replayed fan-out inserts nothing new. The audience is
 * `recipient_kind`, never inferred from which ID column is set; the CHECK
 * keeps exactly the matching column filled. `school_id` is explicit and is
 * part of every read predicate. No titles, bodies or links are stored.
 */
export const notificationTable = pgTable(
  "notification",
  {
    id: text("id").primaryKey(),
    eventId: text("event_id")
      .notNull()
      .references(() => notificationEventTable.id, { onDelete: "cascade" }),
    schoolId: text("school_id")
      .notNull()
      .references(() => schoolTable.id),
    recipientKind: notificationRecipientKindEnum("recipient_kind").notNull(),
    /** Staff recipient (`recipient_kind = 'staff_user'`). */
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    /** Student recipient (`recipient_kind = 'admission'`). */
    admissionId: text("admission_id").references(() => admissionTable.id, {
      onDelete: "cascade",
    }),
    type: text("type").notNull(),
    data: jsonb("data").$type<Record<string, unknown>>().notNull(),
    /** When the row was written (seconds after the event); the inbox order. */
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** Null while unread. */
    readAt: timestamp("read_at", { withTimezone: true }),
    /**
     * Hidden from the recipient's inbox (only read rows can be dismissed).
     * The row stays so its delivery log survives until retention removes it.
     */
    dismissedAt: timestamp("dismissed_at", { withTimezone: true }),
  },
  (table) => [
    check(
      "notification_recipient_check",
      sql`(${table.recipientKind} = 'staff_user' and ${table.userId} is not null and ${table.admissionId} is null) or (${table.recipientKind} = 'admission' and ${table.admissionId} is not null and ${table.userId} is null)`,
    ),
    check(
      "notification_dismiss_read_check",
      sql`${table.dismissedAt} is null or ${table.readAt} is not null`,
    ),
    index("notification_staff_list_idx")
      .on(table.userId, table.schoolId, table.createdAt.desc(), table.id.desc())
      .where(sql`${table.recipientKind} = 'staff_user'`),
    index("notification_admission_list_idx")
      .on(table.admissionId, table.createdAt.desc(), table.id.desc())
      .where(sql`${table.recipientKind} = 'admission'`),
    index("notification_staff_unread_idx")
      .on(table.userId, table.schoolId)
      .where(sql`${table.recipientKind} = 'staff_user' and ${table.readAt} is null`),
    index("notification_admission_unread_idx")
      .on(table.admissionId)
      .where(sql`${table.recipientKind} = 'admission' and ${table.readAt} is null`),
    index("notification_event_idx").on(table.eventId),
    index("notification_school_idx").on(table.schoolId),
    index("notification_created_idx").on(table.createdAt),
  ],
);

/**
 * One remote copy of a notification per channel and destination (D-29). The
 * ID is derived from (notification, channel, destination), so a replayed
 * fan-out inserts nothing new. Students never see these rows (D-20).
 *
 * The table is also the send queue (D-39): an `owed` row is due at
 * `next_attempt_at`; the channel's sender (a Restate virtual object per
 * channel and `send_lane`) picks due rows by `send_priority`, then round
 * robin across schools, claims each (`owed → sending`) and sends it under
 * the channel's rate limit. A transient failure puts the row back to
 * `owed` with a later `next_attempt_at`, counted in the retry counters
 * below, until the channel's retry policy gives up (`failed`).
 */
export const notificationDeliveryTable = pgTable(
  "notification_delivery",
  {
    id: text("id").primaryKey(),
    notificationId: text("notification_id")
      .notNull()
      .references(() => notificationTable.id, { onDelete: "cascade" }),
    schoolId: text("school_id")
      .notNull()
      .references(() => schoolTable.id),
    channel: notificationDeliveryChannelEnum("channel").notNull(),
    /**
     * Destination snapshot at decision time: an E.164 number (WhatsApp) or a
     * push subscription ID. Null when skipped before a destination existed.
     */
    destination: text("destination"),
    status: notificationDeliveryStatusEnum("status").notNull(),
    skipReason: notificationSkipReasonEnum("skip_reason"),
    /** Provider message ID (WhatsApp `wamid`) for webhook lookups. */
    providerMessageId: text("provider_message_id"),
    /** Provider error code, never provider prose with personal data. */
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    /** The failed delivery this one resends (staff "Resend"); null for a first delivery. */
    resendOfDeliveryId: text("resend_of_delivery_id").references(
      (): AnyPgColumn => notificationDeliveryTable.id,
      { onDelete: "cascade" },
    ),
    /**
     * When staff were told about this delivery's failure
     * (`notification.whatsapp_failed`, or grouped per batch in
     * `notification.whatsapp_batch_failed`; D-38). Null while not failed or
     * not yet reported; the API sweep reports each failed WhatsApp delivery
     * once.
     */
    failureAlertedAt: timestamp("failure_alerted_at", { withTimezone: true }),
    /**
     * Template revision (`artifact.id`) of the PDF attached to the message,
     * when one was rendered through the document system (WhatsApp
     * `school_document`). The PDF itself is not stored; this records which
     * revision produced it. Not a foreign key: provenance outlives
     * revisions, as on generated artifacts.
     */
    documentTemplateRevisionId: text("document_template_revision_id"),
    attempts: integer("attempts").notNull().default(0),
    /** Copied from the event: `immediate` rows are sent before `bulk` ones. */
    sendPriority: notificationSendPriorityEnum("send_priority").notNull(),
    /**
     * Which sender of the channel sends this row: always 0 for WhatsApp
     * (one sender for the one number); for web push the school's shard
     * (see the API's `notifications/sender/lanes.ts`), written once at
     * fan-out so a later change of the lane count never strands rows.
     */
    sendLane: smallint("send_lane").notNull().default(0),
    /** When an `owed` row is due to be sent; null in every other status. */
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    /** Quick retries (minutes apart) used after transient failures (D-41). */
    quickRetries: integer("quick_retries").notNull().default(0),
    /** Retries a day later used after the quick retries ran out (D-41). */
    deferredRetries: integer("deferred_retries").notNull().default(0),
    /** Retries a day later used because the provider's daily messaging limit was reached (D-41). */
    dailyLimitRetries: integer("daily_limit_retries").notNull().default(0),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    readAt: timestamp("read_at", { withTimezone: true }),
    failedAt: timestamp("failed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      "notification_delivery_skip_reason_check",
      sql`(${table.status} = 'skipped') = (${table.skipReason} is not null)`,
    ),
    uniqueIndex("notification_delivery_provider_message_unique")
      .on(table.channel, table.providerMessageId)
      .where(sql`${table.providerMessageId} is not null`),
    index("notification_delivery_notification_idx").on(table.notificationId),
    index("notification_delivery_school_idx").on(table.schoolId),
    index("notification_delivery_pending_idx")
      .on(table.status, table.createdAt)
      .where(sql`${table.status} in ('owed', 'sending')`),
    index("notification_delivery_queue_idx")
      .on(table.channel, table.sendLane, table.nextAttemptAt)
      .where(sql`${table.status} = 'owed'`),
    /**
     * The sender's pick (API `notifications/sender/queue.ts`,
     * `pickDueDeliveries`): skips from one (priority, school) of a lane to
     * the next and reads each one's first due rows in send order, so a pick
     * reads at most `limit` rows per school instead of every due row.
     */
    index("notification_delivery_queue_school_idx")
      .on(table.channel, table.sendLane, table.sendPriority, table.schoolId, table.nextAttemptAt, table.id)
      .where(sql`${table.status} = 'owed'`),
    check(
      "notification_delivery_next_attempt_check",
      sql`(${table.status} = 'owed') = (${table.nextAttemptAt} is not null)`,
    ),
    index("notification_delivery_unalerted_failure_idx")
      .on(table.failedAt)
      .where(sql`${table.channel} = 'whatsapp' and ${table.status} = 'failed' and ${table.failureAlertedAt} is null`),
    index("notification_delivery_resend_idx").on(table.resendOfDeliveryId),
  ],
);

/**
 * One browser push subscription of one Cadet Portal login (plan §3b, D-33).
 * A browser profile has one push endpoint per site, so siblings who sign in
 * on the same phone share an endpoint and each get their own row: unique on
 * (login, endpoint). Rows are never reused across logins and go with the
 * login (cascade).
 *
 * `revoked_at` is set when the student turns notifications off on the
 * device, signs out there, or the push service reports the endpoint gone
 * (404/410). A revoked row is never sent to; subscribing again on the same
 * device clears it and stores the browser's current keys.
 */
export const cadetPushSubscriptionTable = pgTable(
  "cadet_push_subscription",
  {
    id: text("id")
      .primaryKey()
      .$default(() => generateId("cadetPushSubscription")),
    cadetUserId: text("cadet_user_id")
      .notNull()
      .references(() => cadetUser.id, { onDelete: "cascade" }),
    /** The push service URL the browser issued; secret-ish, never logged. */
    endpoint: text("endpoint").notNull(),
    /** Browser's P-256 ECDH public key (base64url) for payload encryption. */
    p256dh: text("p256dh").notNull(),
    /** Browser's auth secret (base64url) for payload encryption. */
    auth: text("auth").notNull(),
    /**
     * The Cadet Portal session that last turned notifications on for this
     * device. Signing that session out revokes the subscription on the
     * server (`revokePushSubscriptionsOfSession`, run by the cadet auth
     * instance's sign-out hook), so a signed-out device stops receiving the
     * student's notifications even when the app's own "turn off" call
     * never arrives. Null for subscriptions stored before this column
     * existed and once the session row is gone (expired sessions keep their
     * device subscribed, as before); such a row is still revoked by the
     * app's `unsubscribePush` call and by `revokeCadetLoginAccess`.
     */
    cadetSessionId: text("cadet_session_id").references(() => cadetSession.id, {
      onDelete: "set null",
    }),
    /** User-Agent of the subscribing request, for staff support only. */
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** When a push service last accepted a message for it. */
    lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("cadet_push_subscription_user_endpoint_unique").on(
      table.cadetUserId,
      table.endpoint,
    ),
    index("cadet_push_subscription_active_idx")
      .on(table.cadetUserId)
      .where(sql`${table.revokedAt} is null`),
    index("cadet_push_subscription_session_idx")
      .on(table.cadetSessionId)
      .where(sql`${table.revokedAt} is null`),
  ],
);

export type CadetPushSubscriptionRow = typeof cadetPushSubscriptionTable.$inferSelect;
export type NotificationEventRow = typeof notificationEventTable.$inferSelect;
export type NotificationRow = typeof notificationTable.$inferSelect;
export type NotificationDeliveryRow = typeof notificationDeliveryTable.$inferSelect;
