/**
 * Restate names and keys of the assistant's worker services. Kept free of
 * runtime imports so the API can hand work over by name and type without
 * importing the worker implementation (the turn loop and model providers).
 */

/** The only ingress-callable assistant service; every call is signed with `WORKER_CONTROL_SECRET`. */
export const ASSISTANT_CONTROL_SERVICE_NAME = 'AssistantControl';

/** Handlers of `AssistantControl`; each signature is bound to one. */
export type AssistantControlHandler = 'startRun' | 'resolveApproval';

/** Restate idempotency key for handing a run's start over; a re-send joins the first invocation. */
export const assistantRunHandoverKey = (runId: string) => `assistant-run:${runId}`;

/** Restate idempotency key for handing a decided approval over. */
export const assistantApprovalHandoverKey = (approvalId: string) => `assistant-approval:${approvalId}`;
