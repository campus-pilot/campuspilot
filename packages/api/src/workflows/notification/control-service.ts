import { db } from '@campuspilot/db';
import { notificationEventTable } from '@campuspilot/db/schema/notification';
import * as restate from '@restatedev/restate-sdk';
import { and, eq } from 'drizzle-orm';

import { authenticateControlCall } from '../control-service-auth';
import { NOTIFICATION_CONTROL_SERVICE_NAME, notificationDispatchWorkflowKey } from './constants';
import {
  notificationDispatchInputSchema,
  notificationSenderPokeInputSchema,
  type NotificationDispatchInput,
  type NotificationSenderPokeInput,
} from './input';
import { log } from './log';
import { notificationSenderObject } from './sender';
import { notificationDispatchWorkflow } from './workflow';
import { senderKey } from '../../notifications/sender/lanes';

/** Handlers of `NotificationControl`; each signature is bound to one. */
export type NotificationControlHandler = 'dispatch' | 'poke';

/** A database step with bounded retries and a generic failure text (no SQL). */
function safeRun<T>(ctx: restate.Context, name: string, action: () => Promise<T>) {
  return ctx.run(name, async () => {
    try {
      return await action();
    } catch (error) {
      log.error({ service: NOTIFICATION_CONTROL_SERVICE_NAME, step: name, err: error instanceof Error ? error.name : 'unknown' }, 'notification.control.error');
      throw new Error('A database operation failed; the worker log has the details.');
    }
  }, { maxRetryAttempts: 5 });
}

/**
 * `NotificationControl` is the only notification service reachable through
 * Restate ingress; `NotificationDispatch` is `ingressPrivate`. The API hands
 * an outbox event over with a one-way, idempotent, signed send, so no
 * request waits for the worker. `dispatch` is, in order: Zod-parsed,
 * authenticated by its HMAC signature (`WORKER_CONTROL_SECRET`), checked
 * against the database (the event exists, is pending and is at this
 * attempt), and only then starts the workflow under the attempt's key and
 * records its invocation ID,
 * which the API's sweep uses to notice a fan-out Restate paused or that
 * ended early.
 */
export const notificationControlService = restate.service({
  name: NOTIFICATION_CONTROL_SERVICE_NAME,
  handlers: {
    dispatch: async (ctx: restate.Context, rawInput: NotificationDispatchInput): Promise<{ invocationId: string } | { status: 'not_pending' }> => {
      const parsed = notificationDispatchInputSchema.safeParse(rawInput);
      if (!parsed.success) throw new restate.TerminalError('Invalid notification dispatch request.', { errorCode: 400 });
      const input = parsed.data;
      await authenticateControlCall(ctx, { service: NOTIFICATION_CONTROL_SERVICE_NAME, handler: 'dispatch', input, log });
      const pending = await safeRun(ctx, 'validate-event', async () => {
        const [row] = await db
          .select({ id: notificationEventTable.id })
          .from(notificationEventTable)
          .where(
            and(
              eq(notificationEventTable.id, input.eventId),
              eq(notificationEventTable.status, 'pending'),
              eq(notificationEventTable.dispatchAttempt, input.attempt),
            ),
          )
          .limit(1);
        return Boolean(row);
      });
      // Already dispatched, failed, moved on to another attempt, or purged with its demo school: nothing to do.
      if (!pending) return { status: 'not_pending' };
      const handle = ctx
        .workflowSendClient(notificationDispatchWorkflow, notificationDispatchWorkflowKey(input.eventId, input.attempt))
        .run(input);
      const invocationId = await handle.invocationId;
      await safeRun(ctx, 'record-invocation', async () => {
        await db
          .update(notificationEventTable)
          .set({ invocationId, updatedAt: new Date() })
          .where(and(eq(notificationEventTable.id, input.eventId), eq(notificationEventTable.dispatchAttempt, input.attempt)));
      });
      return { invocationId };
    },
    /**
     * Starts a drain of one sender lane (D-39) for the API sweep, which
     * pokes every lane that has due deliveries. Signed like `dispatch`; the
     * API's idempotency key folds repeated pokes within a window into one.
     * The sweep skips lanes where a drain is already live (see
     * `pokeDueSenders`); one that raced in anyway queues behind it and
     * finds nothing left.
     */
    poke: async (ctx: restate.Context, rawInput: NotificationSenderPokeInput): Promise<{ status: 'poked' }> => {
      const parsed = notificationSenderPokeInputSchema.safeParse(rawInput);
      if (!parsed.success) throw new restate.TerminalError('Invalid notification sender poke.', { errorCode: 400 });
      const input = parsed.data;
      await authenticateControlCall(ctx, { service: NOTIFICATION_CONTROL_SERVICE_NAME, handler: 'poke', input, log });
      ctx.objectSendClient(notificationSenderObject, senderKey(input)).drain({ reason: 'sweep' });
      return { status: 'poked' };
    },
  },
});

export type NotificationControlService = typeof notificationControlService;
