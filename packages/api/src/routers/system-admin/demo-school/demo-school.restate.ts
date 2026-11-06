import { env } from "@campuspilot/env/server";
import { getRestateClient } from "@campuspilot/restate/client";

import {
  DEMO_SCHOOL_PURGE_WORKFLOW_NAME,
  DEMO_SCHOOL_WORKFLOW_NAME,
  demoSchoolWorkflowKey,
} from "../../../workflows/demo-school/constants";
import type {
  DemoSchoolPurgeInput,
  DemoSchoolPurgeWorkflow,
} from "../../../workflows/demo-school/purge-workflow";
import type { DemoSchoolWorkflow } from "../../../workflows/demo-school/workflow";

/**
 * API-side Restate calls. The workflows are referenced by name and type only:
 * importing their implementation here would import the router itself.
 */

/**
 * Submits one attempt of a demo seed. Resubmitting the same key attaches to
 * the existing run, so this is safe to call again (plan §3.1).
 */
export async function submitDemoSchoolWorkflow(jobId: string, attempt: number) {
  const submission = await getRestateClient()
    .workflowClient<DemoSchoolWorkflow>(
      { name: DEMO_SCHOOL_WORKFLOW_NAME },
      demoSchoolWorkflowKey(jobId, attempt),
    )
    .workflowSubmit({ jobId });
  return { invocationId: submission.invocationId };
}

/** Starts S3 cleanup for a purged demo school; keyed by school ID. */
export async function submitDemoSchoolPurgeWorkflow(input: DemoSchoolPurgeInput) {
  const submission = await getRestateClient()
    .workflowClient<DemoSchoolPurgeWorkflow>(
      { name: DEMO_SCHOOL_PURGE_WORKFLOW_NAME },
      input.schoolId,
    )
    .workflowSubmit(input);
  return { invocationId: submission.invocationId };
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
