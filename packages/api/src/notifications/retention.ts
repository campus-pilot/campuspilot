import type { DatabaseExecutor } from '@campuspilot/db';
import { notificationEventTable, notificationTable } from '@campuspilot/db/schema/notification';
import { and, inArray, isNotNull, isNull, lt, or } from 'drizzle-orm';

/**
 * Retention (D-27), two explicit windows as in gos1:
 * - read notifications (dismissed included) are kept 90 days after creation;
 * - unread notifications are kept 180 days, since the recipient never saw them.
 * Deleting a notification deletes its delivery rows (cascade), so the staff
 * delivery log reaches back as far as the inbox does.
 * Outbox events that finished (dispatched or failed) are kept as long as the
 * longest notification window, then deleted; their remaining notifications
 * would be past retention too (a notification is written seconds after its
 * event). Pending events are never deleted here.
 */
export const NOTIFICATION_READ_RETENTION_DAYS = 90;
export const NOTIFICATION_UNREAD_RETENTION_DAYS = 180;
export const NOTIFICATION_EVENT_RETENTION_DAYS = NOTIFICATION_UNREAD_RETENTION_DAYS;

const DAY_MS = 24 * 60 * 60 * 1000;

/** One retention pass; idempotent, safe on concurrent replicas. */
export async function sweepNotificationRetention(db: DatabaseExecutor, now: Date = new Date()) {
  const readCutoff = new Date(now.getTime() - NOTIFICATION_READ_RETENTION_DAYS * DAY_MS);
  const unreadCutoff = new Date(now.getTime() - NOTIFICATION_UNREAD_RETENTION_DAYS * DAY_MS);
  const eventCutoff = new Date(now.getTime() - NOTIFICATION_EVENT_RETENTION_DAYS * DAY_MS);
  const notifications = await db
    .delete(notificationTable)
    .where(
      or(
        and(isNotNull(notificationTable.readAt), lt(notificationTable.createdAt, readCutoff)),
        and(isNull(notificationTable.readAt), lt(notificationTable.createdAt, unreadCutoff)),
      ),
    )
    .returning({ id: notificationTable.id });
  const events = await db
    .delete(notificationEventTable)
    .where(and(inArray(notificationEventTable.status, ['dispatched', 'failed']), lt(notificationEventTable.createdAt, eventCutoff)))
    .returning({ id: notificationEventTable.id });
  return { notifications: notifications.length, events: events.length };
}
