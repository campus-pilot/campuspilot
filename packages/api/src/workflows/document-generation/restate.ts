import { env } from '@campuspilot/env/server';
import { getRestateClient, rpc } from '@campuspilot/restate/client';
import * as restate from '@restatedev/restate-sdk';

import { signWorkerControlCall } from '../control-auth';
import {
  DOCUMENT_GENERATION_CONTROL_SERVICE_NAME,
  documentGenerationIdempotencyKey,
  type DocumentGenerationControlHandler,
} from './constants';
import type { DocumentGenerationJobInput } from './input';

/**
 * Declares, for typing only, the handlers of the worker's
 * `DocumentGenerationControl` service. The implementation is
 * `control-service.ts` (served by `apps/worker`) and must keep this name,
 * handler and input; importing it here would import the whole job into the
 * API. The function is never called.
 */
const declareControlService = () =>
  restate.service({
    name: DOCUMENT_GENERATION_CONTROL_SERVICE_NAME,
    handlers: {
      startGeneration: async (_ctx: restate.Context, _input: DocumentGenerationJobInput): Promise<{ invocationId: string }> => {
        throw new Error('Declared for typing only.');
      },
    },
  });
export type DocumentGenerationControlService = ReturnType<typeof declareControlService>;

/** Bound for one send: Restate itself, not the worker, must answer within it. */
const SEND_TIMEOUT_MS = 5_000;

/**
 * Hands a queued job to Restate as a signed, idempotent one-way send
 * (`/send`): Restate answers as soon as it has durably accepted the
 * invocation, whether or not a worker is running, so a request never waits
 * for the worker. The idempotency key makes a repeated send (outbox retry,
 * replica race) join the same invocation.
 */
export async function sendDocumentGenerationStart(jobId: string) {
  const secret = env.WORKER_CONTROL_SECRET;
  if (!secret) throw new Error('WORKER_CONTROL_SECRET is not set, so worker control calls cannot be signed.');
  const handler: DocumentGenerationControlHandler = 'startGeneration';
  const input: DocumentGenerationJobInput = { jobId };
  const headers = signWorkerControlCall(secret, { service: DOCUMENT_GENERATION_CONTROL_SERVICE_NAME, handler }, input);
  const sent = await getRestateClient()
    .serviceSendClient<DocumentGenerationControlService>({ name: DOCUMENT_GENERATION_CONTROL_SERVICE_NAME })
    .startGeneration(
      input,
      rpc.sendOpts<DocumentGenerationJobInput>({ idempotencyKey: documentGenerationIdempotencyKey(jobId), headers, timeout: SEND_TIMEOUT_MS }),
    );
  return { invocationId: sent.invocationId };
}
