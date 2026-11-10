import { z } from 'zod';

import { cadetProcedure } from '../../cadet/procedure';
import { toRpcError } from '../../errors';
import {
  countUnreadNotifications,
  decodeNotificationCursor,
  dismissNotifications,
  listNotifications,
  markAllNotificationsRead,
  markNotificationsRead,
  type NotificationViewer,
} from '../../notifications/inbox';
import {
  notificationChangedOutputSchema,
  notificationIdsInputShape,
  notificationListInputShape,
  notificationListOutputSchema,
  notificationMarkAllReadInputShape,
  notificationUnreadCountOutputSchema,
  toNotificationDto,
} from '../../notifications/notification.dto';

/** The student's inbox viewer, bound from the cadet session (never from input). */
function viewerOf(cadet: { admissionId: string; schoolId: string }): NotificationViewer {
  return { kind: 'admission', admissionId: cadet.admissionId, schoolId: cadet.schoolId };
}

/**
 * The Cadet Portal inbox (D-20): the same queries as the staff inbox, bound
 * to the signed-in admission and its school. No delivery status is ever
 * returned. Writes are `access: 'write'`, so the read-only cadet MCP cannot
 * call them.
 */
export const cadetNotificationRouter = {
  listNotifications: cadetProcedure
    .route({
      summary: 'List my notifications',
      description:
        "List the signed-in student's notifications (bills, receipts, results), newest first, with keyset paging. Takes no student or school input.",
      tags: ['Cadet', 'Notifications'],
    })
    .meta({ mcp: { exposure: 'hidden', access: 'read', destructive: false, module: 'account' } })
    .input(z.object(notificationListInputShape))
    .output(notificationListOutputSchema)
    .handler(async ({ context, input }) => {
      try {
        const page = await listNotifications(context.db, viewerOf(context.cadet), {
          limit: input.limit,
          cursor: input.cursor ? decodeNotificationCursor(input.cursor) : null,
          filter: input.filter,
        });
        return { items: page.items.map(toNotificationDto), nextCursor: page.nextCursor };
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  getUnreadNotificationCount: cadetProcedure
    .route({
      summary: 'Count my unread notifications',
      description: "Count the signed-in student's unread notifications.",
      tags: ['Cadet', 'Notifications'],
    })
    .meta({ mcp: { exposure: 'hidden', access: 'read', destructive: false, module: 'account' } })
    .output(notificationUnreadCountOutputSchema)
    .handler(async ({ context }) => {
      try {
        return { count: await countUnreadNotifications(context.db, viewerOf(context.cadet)) };
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  markNotificationsRead: cadetProcedure
    .route({
      summary: 'Mark notifications read',
      description: "Mark some of the signed-in student's notifications read. Other IDs change nothing.",
      tags: ['Cadet', 'Notifications'],
    })
    .meta({ mcp: { exposure: 'hidden', access: 'write', destructive: true, module: 'account' } })
    .input(z.object(notificationIdsInputShape))
    .output(notificationChangedOutputSchema)
    .handler(async ({ context, input }) => {
      try {
        return { changed: await markNotificationsRead(context.db, viewerOf(context.cadet), input.ids) };
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  markAllNotificationsRead: cadetProcedure
    .route({
      summary: 'Mark all notifications read',
      description:
        "Mark every unread notification of the signed-in student read, up to the given instant or the server's current time.",
      tags: ['Cadet', 'Notifications'],
    })
    .meta({ mcp: { exposure: 'hidden', access: 'write', destructive: true, module: 'account' } })
    .input(z.object(notificationMarkAllReadInputShape))
    .output(notificationChangedOutputSchema)
    .handler(async ({ context, input }) => {
      try {
        const before = input.before ? new Date(input.before) : undefined;
        return { changed: await markAllNotificationsRead(context.db, viewerOf(context.cadet), before) };
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  dismissNotifications: cadetProcedure
    .route({
      summary: 'Dismiss read notifications',
      description: "Remove read notifications from the signed-in student's inbox. Unread notifications are not dismissed.",
      tags: ['Cadet', 'Notifications'],
    })
    .meta({ mcp: { exposure: 'hidden', access: 'write', destructive: true, module: 'account' } })
    .input(z.object(notificationIdsInputShape))
    .output(notificationChangedOutputSchema)
    .handler(async ({ context, input }) => {
      try {
        return { changed: await dismissNotifications(context.db, viewerOf(context.cadet), input.ids) };
      } catch (error) {
        throw toRpcError(error);
      }
    }),
};
