import { z } from 'zod';

import { toRpcError } from '../../../errors';
import { assertSchoolMember } from '../../../permissions/school-member';
import { o, protectedProcedure } from '../../../index';
import {
  countUnreadNotifications,
  decodeNotificationCursor,
  dismissNotifications,
  listNotifications,
  markAllNotificationsRead,
  markNotificationsRead,
  type NotificationViewer,
} from '../../../notifications/inbox';
import {
  notificationChangedOutputSchema,
  notificationIdsInputShape,
  notificationListInputShape,
  notificationListOutputSchema,
  notificationMarkAllReadInputShape,
  notificationUnreadCountOutputSchema,
  toNotificationDto,
} from '../../../notifications/notification.dto';

const schoolScope = { schoolId: z.string().min(1) };

/**
 * The staff inbox needs no permission: a staff member reads and changes only
 * their own rows (D-20, plan Phase 2). It still requires current membership
 * of the school, because a notification is itself a disclosure and a removed
 * member must not keep reading the school's inbox. The viewer is the session
 * user and the input school, both matched explicitly in every query.
 */
const requireSchoolMember = o.middleware<{ viewer: NotificationViewer }, { schoolId: string }>(
  async ({ context, next }, input) => {
    const userId = await assertSchoolMember(context, input.schoolId);
    return next({ context: { viewer: { kind: 'staff_user', userId, schoolId: input.schoolId } } });
  },
);

/** Inbox chrome: hidden from MCP (no agent value), served over RPC/OpenAPI. */
const hiddenRead = { mcp: { exposure: 'hidden', access: 'read', destructive: false, module: 'account' } } as const;
/** Changing read state changes existing rows, so writes are `destructive`. */
const hiddenWrite = { mcp: { exposure: 'hidden', access: 'write', destructive: true, module: 'account' } } as const;

export const schoolNotificationRouter = {
  listNotifications: protectedProcedure
    .route({
      summary: 'List my notifications',
      description:
        "List the signed-in staff member's own notifications in a school, newest first, with keyset paging. Notifications of retired types are left out.",
      tags: ['School', 'Notifications'],
    })
    .meta(hiddenRead)
    .input(z.object({ ...schoolScope, ...notificationListInputShape }))
    .use(requireSchoolMember)
    .output(notificationListOutputSchema)
    .handler(async ({ context, input }) => {
      try {
        const page = await listNotifications(context.db, context.viewer, {
          limit: input.limit,
          cursor: input.cursor ? decodeNotificationCursor(input.cursor) : null,
          filter: input.filter,
        });
        return { items: page.items.map(toNotificationDto), nextCursor: page.nextCursor };
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  getUnreadNotificationCount: protectedProcedure
    .route({
      summary: 'Count my unread notifications',
      description: "Count the signed-in staff member's unread notifications in a school.",
      tags: ['School', 'Notifications'],
    })
    .meta(hiddenRead)
    .input(z.object(schoolScope))
    .use(requireSchoolMember)
    .output(notificationUnreadCountOutputSchema)
    .handler(async ({ context }) => {
      try {
        return { count: await countUnreadNotifications(context.db, context.viewer) };
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  markNotificationsRead: protectedProcedure
    .route({
      summary: 'Mark notifications read',
      description:
        "Mark some of the signed-in staff member's notifications in a school as read. IDs of other people's notifications change nothing.",
      tags: ['School', 'Notifications'],
    })
    .meta(hiddenWrite)
    .input(z.object({ ...schoolScope, ...notificationIdsInputShape }))
    .use(requireSchoolMember)
    .output(notificationChangedOutputSchema)
    .handler(async ({ context, input }) => {
      try {
        return { changed: await markNotificationsRead(context.db, context.viewer, input.ids) };
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  markAllNotificationsRead: protectedProcedure
    .route({
      summary: 'Mark all notifications read',
      description:
        "Mark every unread notification of the signed-in staff member in a school read, up to the given instant or the server's current time.",
      tags: ['School', 'Notifications'],
    })
    .meta(hiddenWrite)
    .input(z.object({ ...schoolScope, ...notificationMarkAllReadInputShape }))
    .use(requireSchoolMember)
    .output(notificationChangedOutputSchema)
    .handler(async ({ context, input }) => {
      try {
        const before = input.before ? new Date(input.before) : undefined;
        return { changed: await markAllNotificationsRead(context.db, context.viewer, before) };
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  dismissNotifications: protectedProcedure
    .route({
      summary: 'Dismiss read notifications',
      description:
        "Remove read notifications from the signed-in staff member's inbox in a school. Unread notifications are not dismissed.",
      tags: ['School', 'Notifications'],
    })
    .meta(hiddenWrite)
    .input(z.object({ ...schoolScope, ...notificationIdsInputShape }))
    .use(requireSchoolMember)
    .output(notificationChangedOutputSchema)
    .handler(async ({ context, input }) => {
      try {
        return { changed: await dismissNotifications(context.db, context.viewer, input.ids) };
      } catch (error) {
        throw toRpcError(error);
      }
    }),
};
