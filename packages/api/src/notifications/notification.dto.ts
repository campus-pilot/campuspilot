import { NOTIFICATION_TYPES, type NotificationType } from '@campuspilot/db/notifications/catalogue';
import { z } from 'zod';

import {
  decodeNotificationCursor,
  NOTIFICATION_MAX_IDS,
  NOTIFICATION_MAX_PAGE_SIZE,
  NOTIFICATION_PAGE_SIZE,
  type NotificationInboxRow,
} from './inbox';

/**
 * Inbox DTOs shared by the staff (`school.*`) and cadet procedures. They
 * carry the type and its facts only: no delivery status (D-20) and no text
 * or links (D-21). `data` is checked only as an object; the catalogue
 * validated it when the event was emitted, and a second authority on its
 * shape here would make an old row of a changed type fail the whole page.
 */
export const notificationDtoSchema = z.object({
  id: z.string(),
  type: z.enum(NOTIFICATION_TYPES as [NotificationType, ...NotificationType[]]),
  data: z.record(z.string(), z.unknown()),
  createdAt: z.date(),
  readAt: z.date().nullable(),
});
export type NotificationDto = z.infer<typeof notificationDtoSchema>;

/** Rows come from the visibility predicate, which filters to known types. */
export function toNotificationDto(row: NotificationInboxRow): NotificationDto {
  return {
    id: row.id,
    type: row.type as NotificationType,
    data: row.data,
    createdAt: row.createdAt,
    readAt: row.readAt,
  };
}

/** Keyset paging inputs (D-27): an opaque cursor from the previous page. */
export const notificationListInputShape = {
  cursor: z
    .string()
    .max(100)
    .refine((value) => decodeNotificationCursor(value) !== null, 'Invalid notification cursor.')
    .optional()
    .describe('nextCursor from the previous page.'),
  limit: z.number().int().positive().max(NOTIFICATION_MAX_PAGE_SIZE).default(NOTIFICATION_PAGE_SIZE),
  filter: z.enum(['all', 'unread']).default('all').describe('`unread` lists only unread notifications.'),
};

export const notificationListOutputSchema = z.object({
  items: z.array(notificationDtoSchema),
  nextCursor: z.string().nullable(),
});

export const notificationUnreadCountOutputSchema = z.object({ count: z.number().int().nonnegative() });

export const notificationIdsInputShape = {
  ids: z.array(z.string().regex(/^ntf_[a-z0-9]{21}$/)).min(1).max(NOTIFICATION_MAX_IDS),
};

export const notificationMarkAllReadInputShape = {
  before: z.iso
    .datetime({ offset: true })
    .optional()
    .describe('Mark only notifications created before this instant; defaults to the server time, which is also the upper bound.'),
};

export const notificationChangedOutputSchema = z.object({ changed: z.number().int().nonnegative() });
