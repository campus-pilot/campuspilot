import { z } from "zod";

import type { SchoolFeatureKey } from "../feature-flags/catalogue";

/**
 * The notification catalogue (plan §4, D-21, D-22): the single authority on
 * which notification types exist, the facts each one carries, who receives it
 * and on which channels it may be delivered. It holds no wording, no titles
 * and no URLs; every app renders text and builds links from `type` + facts at
 * render time, so wording and routes can change without touching stored rows.
 *
 * It lives in `@campuspilot/db` because it is the contract of the
 * `notification.data` jsonb column and must be importable by the API, the
 * worker and `@campuspilot/components` alike (same precedent as
 * `@campuspilot/db/phone`). It imports nothing but Zod.
 *
 * Adding a type: add its payload schema and its catalogue entry. Every
 * consumer is a `Record<NotificationType, …>` (or an audience-narrowed
 * record) or an exhaustive switch, so the build fails until each one handles
 * the new type. Payload rules:
 * - facts only: IDs plus display snapshots captured at event time (numbers,
 *   amounts, names), never sentences or links;
 * - fields added to an existing type are always optional, because rows
 *   written before the change lack them;
 * - amounts are minor units as decimal strings with an ISO 4217 currency;
 *   instants are ISO 8601 strings, dates `YYYY-MM-DD`.
 * Retiring a type: remove it from here; stored rows of the retired type are
 * filtered out by the read queries (never fatal) and age out by retention.
 */

/** Every channel a notification may use. `in_app` is the notification row itself. */
export const NOTIFICATION_CHANNELS = ["in_app", "web_push", "whatsapp"] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

/**
 * Channels that deliver a copy outside the inbox. Each gets one
 * `notification_delivery` row per notification (and destination).
 */
export const REMOTE_NOTIFICATION_CHANNELS = ["web_push", "whatsapp"] as const;
export type RemoteNotificationChannel =
  (typeof REMOTE_NOTIFICATION_CHANNELS)[number];

/**
 * Who a notification is addressed to (D-20), stored explicitly on every row
 * as `recipient_kind`:
 * - `staff_user`: a staff account (`user.id`) within one school, read in the
 *   management app;
 * - `admission`: a student's admission (`admission.id`), read in the Cadet
 *   Portal. The row belongs to the admission, not to a cadet login, so it
 *   exists before a login is issued and survives a password reset.
 */
export const NOTIFICATION_AUDIENCES = ["staff_user", "admission"] as const;
export type NotificationAudience = (typeof NOTIFICATION_AUDIENCES)[number];

/** Non-negative minor units as decimal digits; up to 19 digits (PostgreSQL bigint range). */
const minorAmount = z.string().regex(/^\d{1,19}$/);
const currency = z.string().regex(/^[A-Z]{3}$/);
const isoDate = z.iso.date();
const isoInstant = z.iso.datetime({ offset: true });
const id = z.string().min(1).max(200);
const label = z.string().min(1).max(500);
const count = z.number().int().nonnegative();

/** Payload (facts) schema of every notification type. */
export const notificationPayloadSchemas = {
  /** A bill was issued to the student (Phase 5). */
  "bill.issued": z.object({
    billId: id,
    sessionId: id,
    admissionId: id,
    billNumber: label,
    totalAmountMinor: minorAmount,
    currency,
    issueDate: isoDate,
    studentName: label,
    /**
     * Billing period key as stored on the bill (`<cadence>:YYYY-MM`, for
     * example `monthly:2026-10`); absent for manual bills.
     */
    periodKey: z.string().max(100).optional(),
    /** The billing run that posted the bill; absent for manual bills (added in Phase 5). */
    billRunId: id.optional(),
  }),
  /** A payment from the student was recorded (Phase 5). */
  "payment.received": z.object({
    paymentId: id,
    sessionId: id,
    admissionId: id,
    receiptNumber: label,
    amountMinor: minorAmount,
    currency,
    receivedAt: isoInstant,
    studentName: label,
  }),
  /** The student's results of an exam were published or sent (Phase 6). */
  "exam.results_published": z.object({
    sessionId: id,
    examSlug: id,
    examName: label,
    admissionId: id,
    /**
     * The session enrollment (`student.id`) and the class it was sent for:
     * together with the exam they name the student's result in the Cadet
     * Portal (D-44). Recorded when the event is emitted, never looked up
     * later, so a later class move does not change where it points.
     */
    studentId: id,
    classId: id,
    studentName: label,
  }),
  /** A results publication the staff member started has finished (Phase 6, D-30). */
  "exam.results_publish_finished": z.object({
    sessionId: id,
    examSlug: id,
    examName: label,
    recipientCount: count,
    /** WhatsApp copies sent, failed and skipped (one per student). */
    sentCount: count,
    failedCount: count,
    skippedCount: count,
    /**
     * Students whose in-app (Cadet Portal inbox) copy was written, whatever
     * happened on WhatsApp (added after the first release, hence optional).
     */
    inAppCount: count.optional(),
  }),
  /** A WhatsApp copy of a student notification failed (Phase 6, D-30). */
  "notification.whatsapp_failed": z.object({
    admissionId: id,
    studentName: label,
    /** The type of the notification whose WhatsApp copy failed. */
    failedType: z.string().min(1).max(100),
    /** Provider error code, never provider prose. */
    errorCode: z.string().max(100).optional(),
    /**
     * The delivery's staff-facing explanation (`notification_delivery.error_message`,
     * written by the API, never provider prose), shown as the entry's text like
     * in the delivery log. Absent when the delivery has none, and on alerts
     * created before it was recorded.
     */
    errorMessage: z.string().max(500).optional(),
  }),
  /**
   * WhatsApp copies of one bulk send failed (D-38): one alert per billing
   * run, results publication or published notice once its WhatsApp copies settled, counting
   * the failures not reported before.
   */
  "notification.whatsapp_batch_failed": z.object({
    batchKind: z.enum(["billing_run", "result_publication", "notice"]),
    /** The type of the notifications whose WhatsApp copies failed. */
    failedType: z.string().min(1).max(100),
    failedCount: count,
    sessionId: id,
    /** Billing runs: the run and its period. */
    billRunId: id.optional(),
    periodKey: z.string().max(100).optional(),
    /** Results publications: the examination. */
    examSlug: id.optional(),
    examName: label.optional(),
    /** Notices: the notice and its title when it was published. */
    noticeId: id.optional(),
    noticeTitle: label.optional(),
  }),
  /** A billing run the staff member posted has finished posting (Phase 5, D-30). */
  "billing.run_posted": z.object({
    billRunId: id,
    sessionId: id,
    periodKey: z.string().min(1).max(100),
    billCount: count,
  }),
  /**
   * A school notice addressed to the student was published. One event per
   * student, so the WhatsApp copy can name them.
   */
  "notice.published": z.object({
    noticeId: id,
    sessionId: id,
    /** The notice's title when it was published (a published notice is immutable). */
    noticeTitle: label,
    admissionId: id,
    studentName: label,
  }),
  /** A school notice addressed to the staff was published. */
  "notice.published_staff": z.object({
    noticeId: id,
    sessionId: id,
    noticeTitle: label,
  }),
  /**
   * An examination's timetable was published. One event per student, so the
   * WhatsApp copy can name them. Every student sees the whole timetable, so
   * the facts name the exam and never a class.
   */
  "exam.timetable_published": z.object({
    sessionId: id,
    examSlug: id,
    examName: label,
    admissionId: id,
    studentName: label,
  }),
  /** An examination's timetable was published; addressed to the school's staff. */
  "exam.timetable_published_staff": z.object({
    sessionId: id,
    examSlug: id,
    examName: label,
  }),
} as const;

export type NotificationType = keyof typeof notificationPayloadSchemas;

/** The facts of each type. */
export type NotificationPayloads = {
  [T in NotificationType]: z.infer<(typeof notificationPayloadSchemas)[T]>;
};

/** What the catalogue says about one type. */
export type NotificationCatalogueEntry = {
  audience: NotificationAudience;
  /** Channels this type may use; `in_app` always, since the inbox is the record. */
  channels: readonly NotificationChannel[];
};

/**
 * Audience and allowed channels per type. Student types may be copied to web
 * push and WhatsApp (D-15, D-33); staff types are in-app only.
 */
export const notificationCatalogue = {
  "bill.issued": { audience: "admission", channels: ["in_app", "web_push", "whatsapp"] },
  "payment.received": { audience: "admission", channels: ["in_app", "web_push", "whatsapp"] },
  "exam.results_published": { audience: "admission", channels: ["in_app", "web_push", "whatsapp"] },
  "exam.results_publish_finished": { audience: "staff_user", channels: ["in_app"] },
  "notification.whatsapp_failed": { audience: "staff_user", channels: ["in_app"] },
  "notification.whatsapp_batch_failed": { audience: "staff_user", channels: ["in_app"] },
  "billing.run_posted": { audience: "staff_user", channels: ["in_app"] },
  "notice.published": { audience: "admission", channels: ["in_app", "web_push", "whatsapp"] },
  "notice.published_staff": { audience: "staff_user", channels: ["in_app"] },
  "exam.timetable_published": { audience: "admission", channels: ["in_app", "web_push", "whatsapp"] },
  "exam.timetable_published_staff": { audience: "staff_user", channels: ["in_app"] },
} as const satisfies Record<NotificationType, NotificationCatalogueEntry>;

/**
 * The facts of each type that may appear in a link (for example the URL a
 * web push opens): identifiers only, never names, amounts or numbers a
 * person reads. A route builder that must also work from a link (the Cadet
 * Portal's, used by push clicks) takes exactly these facts, so a route can
 * be built from a full row and from a link alike.
 */
export const notificationLinkFactKeys = {
  "bill.issued": ["billId", "sessionId"],
  "payment.received": ["paymentId", "sessionId"],
  "exam.results_published": ["sessionId", "examSlug", "studentId", "classId"],
  "exam.results_publish_finished": ["sessionId", "examSlug"],
  "notification.whatsapp_failed": ["admissionId"],
  "notification.whatsapp_batch_failed": ["sessionId", "billRunId", "examSlug", "noticeId"],
  "billing.run_posted": ["billRunId", "sessionId"],
  "notice.published": ["noticeId"],
  "notice.published_staff": ["noticeId", "sessionId"],
  "exam.timetable_published": ["sessionId", "examSlug"],
  "exam.timetable_published_staff": ["sessionId", "examSlug"],
} as const satisfies { [T in NotificationType]: readonly (keyof NotificationPayloads[T])[] };

/** The link facts of a type. */
export type NotificationLinkFacts<T extends NotificationType> = Pick<
  NotificationPayloads[T],
  Extract<(typeof notificationLinkFactKeys)[T][number], keyof NotificationPayloads[T]>
>;

/** Picks a row's link facts (absent optional facts are left out). */
export function pickNotificationLinkFacts<T extends NotificationType>(
  type: T,
  data: Record<string, unknown>,
): Record<string, string> {
  const facts: Record<string, string> = {};
  for (const key of notificationLinkFactKeys[type] as readonly string[]) {
    const value = data[key];
    if (typeof value === "string") facts[key] = value;
  }
  return facts;
}

/**
 * The per-school platform features (`@campuspilot/db/feature-flags/catalogue`)
 * a type belongs to. While one of them is switched off for the school,
 * nothing new of that type goes out: its remote copies are recorded
 * `skipped: feature_disabled` when planned and again when sent, and a staff
 * resend is refused (`notifications/features.ts` in the API). Inbox rows
 * are still written, since the inbox is the record.
 *
 * Exhaustive, so each new type decides. Only notice types name features:
 * a student notice needs the school to have notices and the Cadet Portal.
 * Bills and receipts are not portal features and go out regardless of
 * `cadet`; results are released by a procedure that requires `cadet`
 * itself, and copies of a release already made are delivered.
 */
export const notificationRequiredFeatures = {
  "bill.issued": [],
  "payment.received": [],
  "exam.results_published": [],
  "exam.results_publish_finished": [],
  "notification.whatsapp_failed": [],
  "notification.whatsapp_batch_failed": [],
  "billing.run_posted": [],
  "notice.published": ["notices", "cadet"],
  "notice.published_staff": ["notices"],
  // Timetables belong to the examination, not to notices. The Cadet Portal
  // decides the student copies when the timetable is published: with the
  // `cadet` feature off, only the staff event is emitted.
  "exam.timetable_published": [],
  "exam.timetable_published_staff": [],
} as const satisfies Record<NotificationType, readonly SchoolFeatureKey[]>;

/** Every known type, in catalogue order. */
export const NOTIFICATION_TYPES = Object.keys(
  notificationCatalogue,
) as NotificationType[];

export type NotificationAudienceOf<T extends NotificationType> =
  (typeof notificationCatalogue)[T]["audience"];

/** Types addressed to a given audience. */
export type NotificationTypeFor<A extends NotificationAudience> = {
  [T in NotificationType]: NotificationAudienceOf<T> extends A ? T : never;
}[NotificationType];

/** Types read in the Cadet Portal. */
export type AdmissionNotificationType = NotificationTypeFor<"admission">;
/** Types read in the management app. */
export type StaffNotificationType = NotificationTypeFor<"staff_user">;

/** Known types of one audience, for SQL filters (unknown types are never shown). */
export function notificationTypesFor<A extends NotificationAudience>(
  audience: A,
): NotificationTypeFor<A>[] {
  return NOTIFICATION_TYPES.filter(
    (type) => notificationCatalogue[type].audience === audience,
  ) as NotificationTypeFor<A>[];
}

/** One notification as a correlated `{ type, data }` pair. */
export type NotificationOf<T extends NotificationType> = {
  type: T;
  data: NotificationPayloads[T];
};
export type AnyNotification = {
  [T in NotificationType]: NotificationOf<T>;
}[NotificationType];

export function isNotificationType(value: string): value is NotificationType {
  return Object.hasOwn(notificationCatalogue, value);
}

/**
 * Who an event is addressed to, as the emitter states it. The worker
 * resolves it to rows (D-24). Each kind matches one audience, so a staff type
 * can never be addressed to admissions or the reverse.
 */
export const notificationRecipientSpecSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("staff_users"),
    userIds: z.array(z.string().min(1).max(200)).min(1).max(10_000),
  }),
  z.object({
    kind: z.literal("admissions"),
    admissionIds: z.array(id).min(1).max(10_000),
  }),
]);
export type NotificationRecipientSpec = z.infer<
  typeof notificationRecipientSpecSchema
>;

/** The recipient spec kind that addresses an audience. */
export type NotificationRecipientSpecFor<A extends NotificationAudience> =
  A extends "staff_user"
    ? Extract<NotificationRecipientSpec, { kind: "staff_users" }>
    : Extract<NotificationRecipientSpec, { kind: "admissions" }>;

export const RECIPIENT_SPEC_KIND_BY_AUDIENCE = {
  staff_user: "staff_users",
  admission: "admissions",
} as const satisfies Record<NotificationAudience, NotificationRecipientSpec["kind"]>;
