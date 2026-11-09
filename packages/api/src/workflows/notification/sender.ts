import * as restate from '@restatedev/restate-sdk';
import { z } from 'zod';

import { parseSenderKey, senderKey, senderPokeIdempotencyKey, type SenderTarget } from '../../notifications/sender/lanes';
import { runSenderDrain, type SenderDrainResult } from '../../notifications/sender/drain';
import { NOTIFICATION_SENDER_OBJECT_NAME } from './constants';
import { log } from './log';

/** Why a drain was started; for the log only. */
export const senderDrainInputSchema = z.object({ reason: z.enum(['fan_out', 'sweep', 'continue']) });
export type SenderDrainInput = z.infer<typeof senderDrainInputSchema>;

/** Bounded retries per step; a step that still fails ends this drain (see below). */
const STEP_OPTIONS = {
  maxRetryAttempts: 6,
  initialRetryInterval: 1_000,
  retryIntervalFactor: 2,
  maxRetryInterval: 30_000,
} as const;

/**
 * `NotificationSender` drains one sender lane of the send queue (D-39; see
 * `notifications/sender/drain.ts`). Keyed by lane (`whatsapp`,
 * `web_push:<n>`): a virtual object runs one exclusive `drain` per key at a
 * time, so each lane has exactly one sender and one rate limit, and pokes
 * that arrive meanwhile queue behind it (each queued drain finds what is
 * left, or nothing). Private to ingress: the fan-out workflow and the
 * signed `NotificationControl.poke` (the API sweep) start drains.
 *
 * A step that keeps failing (database down) ends the drain instead of
 * failing the invocation: a failed or paused virtual object invocation
 * would hold the key's lock and block every later poke. Rows it did not
 * claim stay owed for the next poke; a row claimed but not recorded stays
 * `sending` and is never sent again (D-25).
 */
export const notificationSenderObject = restate.object({
  name: NOTIFICATION_SENDER_OBJECT_NAME,
  options: { ingressPrivate: true },
  handlers: {
    drain: async (ctx: restate.ObjectContext, rawInput: SenderDrainInput): Promise<SenderDrainResult | { status: 'aborted' }> => {
      const input = senderDrainInputSchema.safeParse(rawInput);
      const target = parseSenderKey(ctx.key);
      if (!input.success || !target) throw new restate.TerminalError('Invalid notification sender drain.', { errorCode: 400 });
      let result: SenderDrainResult;
      try {
        result = await runSenderDrain({
          target,
          step: (name, action) => ctx.run(name, action, STEP_OPTIONS),
          sleep: (name, ms) => ctx.sleep(ms, name),
        });
      } catch (error) {
        if (!(error instanceof restate.TerminalError) || error instanceof restate.CancelledError) throw error;
        log.error({ sender: ctx.key, reason: input.data.reason, err: error.message }, 'notification.sender.aborted');
        return { status: 'aborted' };
      }
      // A long backlog continues in a fresh invocation with a fresh journal.
      if (result.status === 'continue') ctx.objectSendClient(notificationSenderObject, ctx.key).drain({ reason: 'continue' });
      log.info({ sender: ctx.key, reason: input.data.reason, ...result }, 'notification.sender.drained');
      return result;
    },
  },
});

export type NotificationSenderObject = typeof notificationSenderObject;

/**
 * Pokes senders from inside another handler (one-way, idempotent per
 * sender and time window, so a burst of fan-outs starts one drain each).
 * `nowMs` must be journaled (`ctx.date.now()`).
 */
export function pokeSenders(ctx: restate.Context, targets: readonly SenderTarget[], nowMs: number, reason: SenderDrainInput['reason']) {
  for (const target of targets) {
    ctx
      .objectSendClient(notificationSenderObject, senderKey(target))
      .drain({ reason }, restate.rpc.sendOpts({ idempotencyKey: senderPokeIdempotencyKey(target, nowMs) }));
  }
}
