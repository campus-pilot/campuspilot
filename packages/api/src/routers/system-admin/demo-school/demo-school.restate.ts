import { env } from "@campuspilot/env/server";
import { getRestateClient, rpc } from "@campuspilot/restate/client";

import { DEMO_SCHOOL_CONTROL_SERVICE_NAME } from "../../../workflows/demo-school/constants";
import { signWorkerControlCall } from "../../../workflows/control-auth";
import type { DemoSchoolControlHandler, DemoSchoolControlService } from "../../../workflows/demo-school/control-service";

/**
 * API-side hand-over to Restate. Both workflows are private to ingress, so the
 * API starts them through `DemoSchoolControl`, which authenticates the call
 * and validates the job row or purge request first. Services are referenced
 * by name and type only: importing their implementation here would import the
 * router itself.
 *
 * Every call is a one-way send (`/send`): Restate answers as soon as it has
 * durably accepted the invocation, whether or not a worker is running, so the
 * hand-over never waits for the worker. The idempotency key makes a repeated
 * send (outbox retry, replica race) join the same invocation.
 */

/** Bound for one send: Restate itself, not the worker, must answer within it. */
const SEND_TIMEOUT_MS = 5_000;

function controlSend() {
  return getRestateClient().serviceSendClient<DemoSchoolControlService>({
    name: DEMO_SCHOOL_CONTROL_SERVICE_NAME,
  });
}

/** Signed send options; refuses to send unsigned (the worker would refuse it anyway). */
function signedSendOptions<I>(handler: DemoSchoolControlHandler, input: I, idempotencyKey: string) {
  const secret = env.WORKER_CONTROL_SECRET;
  if (!secret) throw new Error("WORKER_CONTROL_SECRET is not set, so worker control calls cannot be signed.");
  const headers = signWorkerControlCall(secret, { service: DEMO_SCHOOL_CONTROL_SERVICE_NAME, handler }, input);
  return rpc.sendOpts<I>({ idempotencyKey, headers, timeout: SEND_TIMEOUT_MS });
}

/** Hands one attempt of a demo seed to Restate; returns the control invocation. */
export async function sendDemoSchoolStart(jobId: string, attempt: number) {
  const input = { jobId, attempt };
  const sent = await controlSend().startSeed(input, signedSendOptions("startSeed", input, `demo-seed:${jobId}.${attempt}`));
  return { invocationId: sent.invocationId };
}

/** Hands one attempt of a demo purge to Restate; returns the control invocation. */
export async function sendDemoSchoolPurge(schoolId: string, attempt: number) {
  const input = { schoolId, attempt };
  const sent = await controlSend().startPurge(input, signedSendOptions("startPurge", input, `demo-purge:${schoolId}.${attempt}`));
  return { invocationId: sent.invocationId };
}
