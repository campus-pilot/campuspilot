import { env } from "@campuspilot/env/server";
import { getRestateClient } from "@campuspilot/restate/client";

import { DEMO_SCHOOL_CONTROL_SERVICE_NAME } from "../../../workflows/demo-school/constants";
import type { DemoSchoolControlService } from "../../../workflows/demo-school/control-service";

/**
 * API-side Restate calls. Both workflows are private to ingress, so the API
 * starts them through `DemoSchoolControl`, which validates the job row or the
 * purge manifest first. Services are referenced by name and type only:
 * importing their implementation here would import the router itself.
 */

function control() {
  return getRestateClient().serviceClient<DemoSchoolControlService>({
    name: DEMO_SCHOOL_CONTROL_SERVICE_NAME,
  });
}

/** Starts one attempt of a demo seed and returns its workflow invocation. */
export async function submitDemoSchoolWorkflow(jobId: string, attempt: number) {
  return control().startSeed({ jobId, attempt });
}

/** Starts S3 cleanup for a committed purge manifest; keyed by school ID. */
export async function submitDemoSchoolPurgeWorkflow(schoolId: string) {
  return control().startPurgeCleanup({ schoolId });
}

/** Invocation states from Restate's `sys_invocation` (`completed` is final). */
export type RestateInvocationStatus =
  | "pending" | "scheduled" | "ready" | "running" | "paused" | "backing-off" | "suspended" | "completed";

/**
 * Reads an invocation's status through the Restate admin query API. Returns
 * null when Restate no longer knows it (purged after its retention period),
 * which callers treat like a finished run.
 */
export async function getRestateInvocationStatus(invocationId: string, signal?: AbortSignal): Promise<RestateInvocationStatus | null> {
  if (!/^inv_[A-Za-z0-9]+$/.test(invocationId)) throw new Error("Invalid Restate invocation ID.");
  const response = await fetch(new URL("/query", env.RESTATE_ADMIN_URL), {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ query: `SELECT status FROM sys_invocation WHERE id = '${invocationId}'` }),
    signal,
  });
  if (!response.ok) throw new Error(`Restate admin query failed (${response.status}).`);
  const body = (await response.json()) as { rows: Array<{ status: RestateInvocationStatus }> };
  return body.rows[0]?.status ?? null;
}

/**
 * Cancels a seed invocation through the Restate admin API. An invocation
 * that already finished is not an error (404/409 mean nothing is running).
 */
export async function cancelRestateInvocation(invocationId: string, signal?: AbortSignal) {
  const response = await fetch(
    new URL(`/invocations/${encodeURIComponent(invocationId)}/cancel`, env.RESTATE_ADMIN_URL),
    { method: "PATCH", signal },
  );
  if (!response.ok && response.status !== 404 && response.status !== 409) {
    throw new Error(`Restate refused to cancel invocation (${response.status}).`);
  }
}

/**
 * Cancels an invocation and waits until it has actually ended. Cancellation
 * only takes effect at the next journal operation, so a step that is already
 * running finishes first. Returns false if it is still running at the timeout.
 */
export async function cancelRestateInvocationAndWait(invocationId: string, options: { timeoutMs?: number; signal?: AbortSignal } = {}) {
  await cancelRestateInvocation(invocationId, options.signal);
  const deadline = Date.now() + (options.timeoutMs ?? 60_000);
  for (;;) {
    const status = await getRestateInvocationStatus(invocationId, options.signal);
    if (status === null || status === "completed") return true;
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}
