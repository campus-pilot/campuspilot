import { z } from 'zod';

import { cadetProcedure } from '../../cadet/procedure';
import { toRpcError } from '../../errors';
import { isAllowedPushEndpoint } from '../../notifications/channels/web-push/endpoints';
import {
  isPushSubscriptionActive,
  revokePushSubscription,
  upsertPushSubscription,
} from '../../notifications/channels/web-push/subscriptions';

const base64url = z.string().regex(/^[A-Za-z0-9_-]+={0,2}$/);

/** A push service URL; only known push services are accepted (see `isAllowedPushEndpoint`). */
const pushEndpointSchema = z
  .url()
  .max(2048)
  .refine(isAllowedPushEndpoint, 'This browser’s push service is not supported.');

const subscribePushInputSchema = z.object({
  endpoint: pushEndpointSchema,
  keys: z.object({
    p256dh: base64url.min(80).max(100),
    auth: base64url.min(16).max(32),
  }),
});

const pushEndpointInputSchema = z.object({ endpoint: z.string().min(1).max(2048) });

/**
 * Web push on the student's devices (plan §3b, Phase 3). Each procedure is
 * bound to the signed-in Cadet login; a device is identified by the push
 * endpoint its browser issued. Writes are `access: 'write'`, so the
 * read-only cadet MCP cannot call them; all are hidden from MCP (device
 * plumbing, no agent value).
 */
export const cadetPushRouter = {
  subscribePush: cadetProcedure
    .route({
      summary: 'Turn on notifications on this device',
      description:
        "Store this browser's push subscription for the signed-in student, so new notifications also appear as device notifications. Subscribing again on the same device refreshes it.",
      tags: ['Cadet', 'Notifications'],
    })
    .meta({ mcp: { exposure: 'hidden', access: 'write', destructive: false, module: 'account' } })
    .input(subscribePushInputSchema)
    .output(z.object({ active: z.literal(true) }))
    .handler(async ({ context, input }) => {
      try {
        const userAgent = context.headers.get('user-agent')?.slice(0, 500) ?? null;
        await upsertPushSubscription(context.db, context.cadet.userId, input, userAgent);
        return { active: true as const };
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  unsubscribePush: cadetProcedure
    .route({
      summary: 'Turn off notifications on this device',
      description:
        "Stop device notifications for the signed-in student on one browser. Other students' subscriptions on the same device are untouched.",
      tags: ['Cadet', 'Notifications'],
    })
    .meta({ mcp: { exposure: 'hidden', access: 'write', destructive: true, module: 'account' } })
    .input(pushEndpointInputSchema)
    .output(z.object({ changed: z.boolean() }))
    .handler(async ({ context, input }) => {
      try {
        return { changed: await revokePushSubscription(context.db, context.cadet.userId, input.endpoint) };
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  getPushSubscription: cadetProcedure
    .route({
      summary: 'Get notification state of this device',
      description: "Whether the signed-in student's notifications are on for this browser's push subscription.",
      tags: ['Cadet', 'Notifications'],
    })
    .meta({ mcp: { exposure: 'hidden', access: 'read', destructive: false, module: 'account' } })
    .input(pushEndpointInputSchema)
    .output(z.object({ active: z.boolean() }))
    .handler(async ({ context, input }) => {
      try {
        return { active: await isPushSubscriptionActive(context.db, context.cadet.userId, input.endpoint) };
      } catch (error) {
        throw toRpcError(error);
      }
    }),
};
