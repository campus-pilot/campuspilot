import { env } from '@campuspilot/env/server';
import { getRestateClient, rpc } from '@campuspilot/restate/client';
import * as restate from '@restatedev/restate-sdk';

import { signWorkerControlCall } from '../control-auth';
import {
  IMAGE_DERIVATIVE_CONTROL_SERVICE_NAME,
  imageDerivativeIdempotencyKey,
  type ImageDerivativeControlHandler,
} from './constants';
import type { ImageDerivativeInput } from './input';
import type { DerivativeOutcome } from './process';

/**
 * Declares, for typing only, the handler of the worker's
 * `ImageDerivativeControl` service. The implementation is
 * `control-service.ts` (served by `apps/worker`) and must keep this name,
 * handler and input; importing it here would load sharp into every caller.
 * The function is never called.
 */
const declareControlService = () =>
  restate.service({
    name: IMAGE_DERIVATIVE_CONTROL_SERVICE_NAME,
    handlers: {
      makeDerivatives: async (_ctx: restate.Context, _input: ImageDerivativeInput): Promise<DerivativeOutcome> => {
        throw new Error('Declared for typing only.');
      },
    },
  });
type ImageDerivativeControlService = ReturnType<typeof declareControlService>;

/** Bound for one send: Restate itself, not the worker, must answer within it. */
const SEND_TIMEOUT_MS = 5_000;

/**
 * Hands one image to the worker as a signed, idempotent one-way send: Restate
 * answers once it has durably accepted the invocation, so the upload request
 * never waits for the decode. The idempotency key (one per row) makes a
 * repeated send join the same invocation.
 */
export async function sendImageDerivativeJob(input: ImageDerivativeInput) {
  const secret = env.WORKER_CONTROL_SECRET;
  if (!secret) throw new Error('WORKER_CONTROL_SECRET is not set, so worker control calls cannot be signed.');
  const handler: ImageDerivativeControlHandler = 'makeDerivatives';
  const headers = signWorkerControlCall(secret, { service: IMAGE_DERIVATIVE_CONTROL_SERVICE_NAME, handler }, input);
  const sent = await getRestateClient()
    .serviceSendClient<ImageDerivativeControlService>({ name: IMAGE_DERIVATIVE_CONTROL_SERVICE_NAME })
    .makeDerivatives(
      input,
      rpc.sendOpts<ImageDerivativeInput>({
        idempotencyKey: imageDerivativeIdempotencyKey(input.target, input.id),
        headers,
        timeout: SEND_TIMEOUT_MS,
      }),
    );
  return { invocationId: sent.invocationId };
}
