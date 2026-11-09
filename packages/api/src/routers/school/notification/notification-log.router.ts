import { REMOTE_NOTIFICATION_CHANNELS } from '@campuspilot/db/notifications/catalogue';
import { notificationDeliveryStatusEnum, notificationSkipReasonEnum } from '@campuspilot/db/schema/notification';
import { SCHOOL_ACTIONS } from '@campuspilot/opa/policies/school';
import { z } from 'zod';

import { toRpcError } from '../../../errors';
import { protectedProcedure } from '../../../index';
import { listDeliveryLog } from '../../../notifications/delivery-log';
import { resendFailedDelivery } from '../../../notifications/redelivery';
import { createListInputSchema, createPaginatedOutputSchema } from '../../../paginations';
import { requireSchoolPermission } from '../../../permissions/school';

const id = z.string().min(1).max(200);

/** Exactly one scope per request: an admission, a billing run or an examination. */
const deliveryLogScopeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('admission'), admissionId: id }),
  z.object({ kind: z.literal('bill_run'), billRunId: id }),
  z.object({ kind: z.literal('exam'), sessionId: id, examSlug: z.string().trim().min(1).max(100) }),
]);

export const listNotificationDeliveriesInputSchema = createListInputSchema({
  schoolId: id,
  scope: deliveryLogScopeSchema,
  onlyFailed: z.boolean().default(false).describe('Only notifications with at least one failed delivery.'),
});

const deliverySchema = z.object({
  id: z.string(),
  channel: z.enum(REMOTE_NOTIFICATION_CHANNELS),
  status: z.enum(notificationDeliveryStatusEnum.enumValues),
  skipReason: z.enum(notificationSkipReasonEnum.enumValues).nullable(),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  attempts: z.number().int().nonnegative(),
  createdAt: z.date(),
  sentAt: z.date().nullable(),
  deliveredAt: z.date().nullable(),
  readAt: z.date().nullable(),
  failedAt: z.date().nullable(),
  interrupted: z.boolean(),
  resendOfDeliveryId: z.string().nullable(),
  resent: z.boolean(),
});

export const deliveryLogItemSchema = z.object({
  notificationId: z.string(),
  type: z.string(),
  admissionId: z.string(),
  studentName: z.string().nullable(),
  reference: z.string().nullable(),
  createdAt: z.date(),
  deliveries: z.array(deliverySchema),
});

const route = (summary: string, description: string) => ({ summary, description, tags: ['School', 'Notifications'] });

/**
 * The staff delivery log and resend (Phase 7). Reading needs
 * `school.notification.log.read`; resending a failed delivery needs
 * `school.notification.send`. Scope is always the input school.
 */
export const schoolNotificationLogRouter = {
  listNotificationDeliveries: protectedProcedure
    .route(route('List notification deliveries', 'Page through the student notifications of one admission, billing run or examination, newest first, with the status of every in-app copy sent by device notification or WhatsApp and the reason a copy was skipped or failed. Shows references (bill or receipt number, exam name), never amounts or message text.'))
    .meta({ mcp: { exposure: 'advanced', access: 'read', destructive: false, module: 'notifications' } })
    .input(listNotificationDeliveriesInputSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.READ_NOTIFICATION_LOG))
    .output(createPaginatedOutputSchema(deliveryLogItemSchema))
    .handler(async ({ context, input }) => {
      try {
        return await listDeliveryLog(context.db, input);
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  resendNotificationDelivery: protectedProcedure
    .route(route('Resend a failed notification delivery', "Send one failed device-notification or WhatsApp copy again as a new delivery, using the student's current WhatsApp number and consent. Each failed delivery can be resent once; retries of the request change nothing."))
    .meta({ mcp: { exposure: 'advanced', access: 'write', destructive: false, module: 'notifications' } })
    .input(z.object({ schoolId: id, deliveryId: id }))
    .use(requireSchoolPermission(SCHOOL_ACTIONS.READ_NOTIFICATION_LOG))
    .use(requireSchoolPermission(SCHOOL_ACTIONS.SEND_NOTIFICATIONS))
    .output(z.object({ created: z.boolean() }))
    .handler(async ({ context, input }) => {
      try {
        const result = await resendFailedDelivery({ ...input, requestedBy: context.session.user.id }, context.db);
        return { created: result.created };
      } catch (error) {
        throw toRpcError(error);
      }
    }),
};
