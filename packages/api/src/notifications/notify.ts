import type { DatabaseExecutor } from '@campuspilot/db';
import {
  notificationCatalogue,
  notificationPayloadSchemas,
  notificationRecipientSpecSchema,
  RECIPIENT_SPEC_KIND_BY_AUDIENCE,
  type NotificationAudienceOf,
  type NotificationPayloads,
  type NotificationRecipientSpecFor,
  type NotificationType,
} from '@campuspilot/db/notifications/catalogue';
import {
  notificationBatchKindEnum,
  notificationEventTable,
  notificationSendPriorityEnum,
} from '@campuspilot/db/schema/notification';
import { and, eq, inArray } from 'drizzle-orm';

/**
 * What an emitter states about an event: its type, its facts, the school,
 * who it concerns and an idempotency key. Nothing about channels, rows,
 * wording or links (D-23).
 */
export type NotifyInput<T extends NotificationType> = {
  type: T;
  data: NotificationPayloads[T];
  schoolId: string;
  recipients: NotificationRecipientSpecFor<NotificationAudienceOf<T>>;
  /**
   * Identifies this event within the school, derived from the business fact
   * (for example `payment:<paymentId>`). A repeated call with the same key
   * (a replayed request) returns the existing event and writes nothing.
   */
  key: string;
  /** Staff member whose action emitted it; omit for system events. */
  createdBy?: string | null;
  /**
   * How urgently remote copies are sent (D-39): `immediate` for a one-off
   * send someone waits for (receipt, manual bill, single result send,
   * resend), `bulk` for one of many (billing run, results publication).
   * Always stated: nothing infers it from the type or the batch. Staff
   * types have no remote copies; they state `immediate`.
   */
  sendPriority: NotificationSendPriority;
  /**
   * The bulk action this event is one of (billing run, results
   * publication); failure alerts are grouped per batch (D-38). Omit for a
   * one-off event.
   */
  batch?: { kind: NotificationBatchKind; id: string } | null;
  /**
   * True when `createdBy` asked for this very send (a single result send, a
   * resend): they are told if its WhatsApp copy fails (D-38). Default false.
   */
  alertCreatorOnFailure?: boolean;
  /**
   * Only for a staff resend (`./redelivery.ts`): the failed delivery to
   * send again. The event then writes no inbox row.
   */
  redeliveryOfDeliveryId?: string | null;
};

export type NotificationSendPriority = (typeof notificationSendPriorityEnum.enumValues)[number];
export type NotificationBatchKind = (typeof notificationBatchKindEnum.enumValues)[number];

/** One emit of any type, correlated (`data` and `recipients` match `type`). */
export type AnyNotifyInput = { [T in NotificationType]: NotifyInput<T> }[NotificationType];

/** Refused emit: a programming error in the caller, never a user error. */
export class NotifyError extends Error {
  override name = 'NotifyError';
}

/**
 * Records one notification event in the caller's transaction: exactly one
 * `notification_event` outbox row (D-23, D-24). Commit or roll back together
 * with the business change, so a notification exists if and only if the fact
 * it reports does. The worker fans it out later; nothing here resolves
 * recipients or touches channels.
 *
 * After the caller's transaction commits it should call
 * `handOffNotificationEvent(eventId)` (fire and forget) for prompt delivery;
 * if it does not, or the hand-over fails, the API's 30 s sweep sends it.
 *
 * Payload and recipients are validated here, so the worker and readers can
 * trust stored rows. Recipient IDs are de-duplicated.
 */
export async function notify<T extends NotificationType>(
  tx: DatabaseExecutor,
  input: NotifyInput<T>,
): Promise<{ eventId: string; created: boolean }> {
  const [result] = await notifyMany(tx, [input as AnyNotifyInput]);
  return result!;
}

/** Validates one emit and returns the row to insert (see {@link notify}). */
function toEventRow(input: AnyNotifyInput) {
  const entry = notificationCatalogue[input.type];
  if (!entry) throw new NotifyError(`Unknown notification type ${String(input.type)}.`);
  const data = notificationPayloadSchemas[input.type].safeParse(input.data);
  if (!data.success) throw new NotifyError(`Invalid ${input.type} notification facts.`);
  const parsedRecipients = notificationRecipientSpecSchema.safeParse(input.recipients);
  if (!parsedRecipients.success) throw new NotifyError(`Invalid ${input.type} notification recipients.`);
  const recipients = parsedRecipients.data;
  if (recipients.kind !== RECIPIENT_SPEC_KIND_BY_AUDIENCE[entry.audience]) {
    throw new NotifyError(`${input.type} is addressed to ${entry.audience}, not ${recipients.kind}.`);
  }
  if (!input.key || input.key.length > 300) throw new NotifyError('A notification key of 1 to 300 characters is required.');
  if (!(notificationSendPriorityEnum.enumValues as readonly string[]).includes(input.sendPriority)) {
    throw new NotifyError('A notification send priority is required.');
  }
  if (input.alertCreatorOnFailure && !input.createdBy) throw new NotifyError('Alerting the creator on failure needs a creator.');
  if (input.batch && (!input.batch.id || input.batch.id.length > 200)) throw new NotifyError('A notification batch needs an ID of 1 to 200 characters.');
  const deduplicated = recipients.kind === 'staff_users'
    ? { kind: recipients.kind, userIds: [...new Set(recipients.userIds)] }
    : { kind: recipients.kind, admissionIds: [...new Set(recipients.admissionIds)] };
  return {
    schoolId: input.schoolId,
    key: input.key,
    type: input.type,
    data: data.data as Record<string, unknown>,
    recipients: deduplicated,
    createdBy: input.createdBy ?? null,
    sendPriority: input.sendPriority,
    batchKind: input.batch?.kind ?? null,
    batchId: input.batch?.id ?? null,
    alertCreatorOnFailure: input.alertCreatorOnFailure ?? false,
    redeliveryOfDeliveryId: input.redeliveryOfDeliveryId ?? null,
  };
}

/** Events written per statement by {@link notifyMany}. */
const NOTIFY_INSERT_CHUNK = 300;

/**
 * {@link notify} for many events of one school at once (for example one
 * `bill.issued` per bill of a billing run), in bounded multi-row inserts
 * instead of one round trip per event. Same rules as `notify`: every input
 * is validated, keys are idempotent within the school (an existing key
 * returns its event with `created: false`), and the rows commit or roll
 * back with the caller's transaction. Results are in input order. Keys must
 * be distinct within one call.
 */
export async function notifyMany(
  tx: DatabaseExecutor,
  inputs: readonly AnyNotifyInput[],
): Promise<{ eventId: string; created: boolean }[]> {
  if (inputs.length === 0) return [];
  const rows = inputs.map((input) => toEventRow(input));
  const schoolId = rows[0]!.schoolId;
  if (rows.some((row) => row.schoolId !== schoolId)) throw new NotifyError('notifyMany emits events of one school per call.');
  if (new Set(rows.map((row) => row.key)).size !== rows.length) throw new NotifyError('notifyMany keys must be distinct.');

  const idByKey = new Map<string, { eventId: string; created: boolean }>();
  for (let start = 0; start < rows.length; start += NOTIFY_INSERT_CHUNK) {
    const chunk = rows.slice(start, start + NOTIFY_INSERT_CHUNK);
    const inserted = await tx
      .insert(notificationEventTable)
      .values(chunk)
      .onConflictDoNothing({ target: [notificationEventTable.schoolId, notificationEventTable.key] })
      .returning({ id: notificationEventTable.id, key: notificationEventTable.key });
    for (const row of inserted) idByKey.set(row.key, { eventId: row.id, created: true });
    const missing = chunk.map((row) => row.key).filter((key) => !idByKey.has(key));
    if (missing.length === 0) continue;
    const existing = await tx
      .select({ id: notificationEventTable.id, key: notificationEventTable.key })
      .from(notificationEventTable)
      .where(and(eq(notificationEventTable.schoolId, schoolId), inArray(notificationEventTable.key, missing)));
    for (const row of existing) idByKey.set(row.key, { eventId: row.id, created: false });
  }
  return rows.map((row) => {
    const result = idByKey.get(row.key);
    if (!result) throw new NotifyError('The notification event conflicted but could not be read back.');
    return result;
  });
}
