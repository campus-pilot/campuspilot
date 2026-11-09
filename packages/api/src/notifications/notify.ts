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
import { notificationEventTable } from '@campuspilot/db/schema/notification';
import { and, eq } from 'drizzle-orm';

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
};

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
  const deduplicated = recipients.kind === 'staff_users'
    ? { kind: recipients.kind, userIds: [...new Set(recipients.userIds)] }
    : { kind: recipients.kind, admissionIds: [...new Set(recipients.admissionIds)] };

  const [inserted] = await tx
    .insert(notificationEventTable)
    .values({
      schoolId: input.schoolId,
      key: input.key,
      type: input.type,
      data: data.data as Record<string, unknown>,
      recipients: deduplicated,
      createdBy: input.createdBy ?? null,
    })
    .onConflictDoNothing({ target: [notificationEventTable.schoolId, notificationEventTable.key] })
    .returning({ id: notificationEventTable.id });
  if (inserted) return { eventId: inserted.id, created: true };

  const [existing] = await tx
    .select({ id: notificationEventTable.id })
    .from(notificationEventTable)
    .where(and(eq(notificationEventTable.schoolId, input.schoolId), eq(notificationEventTable.key, input.key)))
    .limit(1);
  if (!existing) throw new NotifyError('The notification event conflicted but could not be read back.');
  return { eventId: existing.id, created: false };
}
