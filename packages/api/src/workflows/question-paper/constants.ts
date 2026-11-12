/**
 * Restate names and keys of the question paper generation job. Kept free of
 * runtime imports so the API can reference the worker's service by name and
 * type without importing its implementation (see `restate.ts`).
 */

/** The only ingress-callable question paper service; it validates the job row before starting a workflow. */
export const QUESTION_PAPER_CONTROL_SERVICE_NAME = 'QuestionPaperControl';
export const QUESTION_PAPER_WORKFLOW_NAME = 'questionPaperGeneration';

/** Handlers of `QuestionPaperControl`; each signature is bound to one. */
export type QuestionPaperControlHandler = 'startGeneration';

/** The Restate idempotency key of one attempt of a job; a retry uses a new attempt. */
export function questionPaperIdempotencyKey(jobId: string, attempt: number): string {
  return `qp-job:${jobId}.${attempt}`;
}

/** Restate workflow key of one attempt of a job. */
export function questionPaperWorkflowKey(jobId: string, attempt: number): string {
  return `${jobId}.${attempt}`;
}

/** How long a running job may take before the outbox sweep fails it as `not_finished`. */
export const QUESTION_PAPER_JOB_TIMEOUT_MINUTES = 30;
