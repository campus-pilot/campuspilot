import { env } from '@campuspilot/env/server';
import { getRestateClient, rpc } from '@campuspilot/restate/client';
import * as restate from '@restatedev/restate-sdk';

import { signWorkerControlCall } from '../control-auth';
import {
  SCHOOL_SETUP_CONTROL_SERVICE_NAME,
  schoolSetupIdempotencyKey,
  type SchoolSetupControlHandler,
  type SchoolSetupWorkflowInput,
} from './constants';

/**
 * Declares, for typing only, the handlers of the worker's `SchoolSetupControl`
 * service. The implementation is `control-service.ts` (served by
 * `apps/worker`) and must keep this name, handler and input; importing it
 * here would import the workflow into the API. The function is never called.
 */
const declareControlService = () =>
  restate.service({
    name: SCHOOL_SETUP_CONTROL_SERVICE_NAME,
    handlers: {
      start: async (_ctx: restate.Context, _input: SchoolSetupWorkflowInput): Promise<{ invocationId: string }> => {
        throw new Error('Declared for typing only.');
      },
    },
  });
type SchoolSetupControlService = ReturnType<typeof declareControlService>;

/** Bound for one send: Restate itself, not the worker, must answer within it. */
const SEND_TIMEOUT_MS = 5_000;

/**
 * Hands one attempt of a school setup to Restate as a signed, idempotent
 * one-way send: Restate answers once it has durably accepted the call,
 * whether or not a worker is running, so the API never waits for the setup.
 */
export async function sendSchoolSetupStart(setupId: string, attempt: number) {
  const secret = env.WORKER_CONTROL_SECRET;
  if (!secret) throw new Error('WORKER_CONTROL_SECRET is not set, so worker control calls cannot be signed.');
  const handler: SchoolSetupControlHandler = 'start';
  const input: SchoolSetupWorkflowInput = { setupId, attempt };
  const headers = signWorkerControlCall(secret, { service: SCHOOL_SETUP_CONTROL_SERVICE_NAME, handler }, input);
  const sent = await getRestateClient()
    .serviceSendClient<SchoolSetupControlService>({ name: SCHOOL_SETUP_CONTROL_SERVICE_NAME })
    .start(input, rpc.sendOpts<SchoolSetupWorkflowInput>({ idempotencyKey: schoolSetupIdempotencyKey(setupId, attempt), headers, timeout: SEND_TIMEOUT_MS }));
  return { invocationId: sent.invocationId };
}
