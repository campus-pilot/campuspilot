import { env } from '@campuspilot/env/server';
import { getRestateClient, rpc } from '@campuspilot/restate/client';
import * as restate from '@restatedev/restate-sdk';

import { signWorkerControlCall } from '../control-auth';
import { LEAD_CONTROL_SERVICE_NAME, leadAlertIdempotencyKey, type LeadControlHandler } from './constants';
import type { LeadAlertInput } from './input';

/**
 * Declares, for typing only, the handlers of the worker's `LeadControl`
 * service. The implementation is `control-service.ts` (served by
 * `apps/worker`) and must keep this name, handler and input; importing it
 * here would import the workflow into the API. The function is never called.
 */
const declareControlService = () =>
  restate.service({
    name: LEAD_CONTROL_SERVICE_NAME,
    handlers: {
      scheduleAlert: async (_ctx: restate.Context, _input: LeadAlertInput): Promise<{ invocationId: string }> => {
        throw new Error('Declared for typing only.');
      },
    },
  });
export type LeadControlService = ReturnType<typeof declareControlService>;

/** Bound for one send: Restate itself, not the worker, must answer within it. */
const SEND_TIMEOUT_MS = 5_000;

/**
 * Schedules a lead's alert as a signed, idempotent one-way send (`/send`):
 * Restate answers as soon as it has durably accepted the invocation, whether
 * or not a worker is running, so the API only schedules the work and never
 * waits for it. The idempotency key makes a repeated send (outbox retry,
 * replica race) join the same invocation.
 */
export async function sendLeadAlertSchedule(leadId: string) {
  const secret = env.WORKER_CONTROL_SECRET;
  if (!secret) throw new Error('WORKER_CONTROL_SECRET is not set, so worker control calls cannot be signed.');
  const handler: LeadControlHandler = 'scheduleAlert';
  const input: LeadAlertInput = { leadId };
  const headers = signWorkerControlCall(secret, { service: LEAD_CONTROL_SERVICE_NAME, handler }, input);
  const sent = await getRestateClient()
    .serviceSendClient<LeadControlService>({ name: LEAD_CONTROL_SERVICE_NAME })
    .scheduleAlert(input, rpc.sendOpts<LeadAlertInput>({ idempotencyKey: leadAlertIdempotencyKey(leadId), headers, timeout: SEND_TIMEOUT_MS }));
  return { invocationId: sent.invocationId };
}
