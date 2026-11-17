import { db } from '@campuspilot/db';
import * as restate from '@restatedev/restate-sdk';

import { authenticateControlCall } from '../control-service-auth';
import { IMAGE_DERIVATIVE_CONTROL_SERVICE_NAME, type ImageDerivativeControlHandler } from './constants';
import { imageDerivativeInputSchema, type ImageDerivativeInput } from './input';
import { log } from './log';
import { processImageDerivatives, type DerivativeOutcome } from './process';

/** Shared, non-revealing text for a failed step (Restate stores and shows it). */
const UNEXPECTED_STEP_FAILURE = 'A storage, database or decode operation failed; the worker log has the details.';

/**
 * `ImageDerivativeControl` makes the thumbnail and model copy of one stored
 * image (a question paper page or a chat attachment) in the worker, so the
 * API never decodes photos. The API hands an image over with a signed,
 * idempotent one-way send right after the upload commits (and the sweep
 * re-sends what is still `pending`, see `outbox.ts`). The handler is, in
 * order: Zod-parsed (malformed input fails terminally), authenticated by its
 * HMAC signature (`WORKER_CONTROL_SECRET`), then one journaled step that reads
 * the row, decodes, writes the objects and records the outcome fenced on
 * `pending`. It trusts nothing from the caller beyond the target and id.
 *
 * Transient failures (storage, database) are retried a few times; after that
 * the row stays `pending` until the sweep's deadline marks it `failed`, which
 * the screen shows with a way to upload again.
 */
export const imageDerivativeControlService = restate.service({
  name: IMAGE_DERIVATIVE_CONTROL_SERVICE_NAME,
  handlers: {
    makeDerivatives: async (ctx: restate.Context, rawInput: ImageDerivativeInput): Promise<DerivativeOutcome> => {
      const parsed = imageDerivativeInputSchema.safeParse(rawInput);
      if (!parsed.success) throw new restate.TerminalError('Invalid image derivative request.', { errorCode: 400 });
      const input = parsed.data;
      const handler: ImageDerivativeControlHandler = 'makeDerivatives';
      await authenticateControlCall(ctx, { service: IMAGE_DERIVATIVE_CONTROL_SERVICE_NAME, handler, input, log });
      const outcome = await ctx.run(
        'derive',
        async () => {
          try {
            return await processImageDerivatives(db, input.target, input.id);
          } catch (error) {
            log.error({ target: input.target, id: input.id, err: error instanceof Error ? { name: error.name, message: error.message.slice(0, 300) } : String(error) }, 'image-derivatives.step.error');
            throw new Error(UNEXPECTED_STEP_FAILURE);
          }
        },
        { maxRetryAttempts: 5, initialRetryInterval: 1_000, retryIntervalFactor: 2, maxRetryInterval: 30_000 },
      );
      log.info({ target: input.target, id: input.id, outcome }, 'image-derivatives.done');
      return outcome;
    },
  },
});

export type ImageDerivativeControlService = typeof imageDerivativeControlService;
