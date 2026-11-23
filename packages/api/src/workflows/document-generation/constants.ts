/**
 * Restate names, keys and failure codes of the document generation job.
 * Kept free of runtime imports so the API can reference the worker's control
 * service by name and type without importing its implementation (see
 * `restate.ts`).
 */

/** The only ingress-callable document generation service; it checks the job row before queueing it. */
export const DOCUMENT_GENERATION_CONTROL_SERVICE_NAME = 'DocumentGenerationControl';
/**
 * The virtual object that runs jobs, keyed by school id. Its handler is
 * exclusive, so Restate runs at most one job of a school at a time and
 * queues the rest in order; other schools run alongside.
 */
export const DOCUMENT_GENERATION_OBJECT_NAME = 'documentGeneration';

/** Handlers of `DocumentGenerationControl`; each signature is bound to one. */
export type DocumentGenerationControlHandler = 'startGeneration';

/** The Restate idempotency key of a job's hand-over; a job is handed over once. */
export function documentGenerationIdempotencyKey(jobId: string): string {
  return `doc-job:${jobId}`;
}

/** A job Restate has not accepted after this long fails with `dispatch_failed`. */
export const DOCUMENT_GENERATION_HANDOVER_DEADLINE_MS = 10 * 60 * 1000;
/**
 * Accepted by Restate but not started after this long fails with
 * `not_started`. Longer than the question paper's deadline because a job
 * waits behind the school's other jobs (one runs at a time per school).
 */
export const DOCUMENT_GENERATION_START_DEADLINE_MS = 60 * 60 * 1000;
/** Running for longer than this fails with `not_finished` (1,500 report cards take minutes, not an hour). */
export const DOCUMENT_GENERATION_RUN_DEADLINE_MS = 60 * 60 * 1000;
/**
 * Jobs that may be queued or running at once: per school, and per person
 * (`generateDocument` is also an MCP tool, so a loop must not queue
 * unbounded work). Counted under a per-school lock at start.
 */
export const DOCUMENT_JOBS_PER_SCHOOL = 3;
export const DOCUMENT_JOBS_PER_USER = 2;
/** An ended job whose temporary objects are still there after this long has them removed by the API sweep. */
export const DOCUMENT_GENERATION_CLEANUP_GRACE_MS = 15 * 60 * 1000;

/**
 * Every `error_code` a failed job can carry, with the safe text the user
 * reads (`error_message`). A refused input (`source_changed`, `invalid_source`,
 * `template_unavailable`, `images_*`, `document_too_large`, `conversion_refused`,
 * `pdf_too_large`, and `school_suspended` / `no_plan` when the school became
 * read-only before the worker claimed the job) fails at once without retries; `conversion_failed` and `internal_error` follow Restate's
 * retries of an infrastructure failure. The sweep writes the last three.
 * Codes whose message names the problem (`invalid_source`, `images_invalid`)
 * carry their own text; the one here is the default.
 */
export const DOCUMENT_GENERATION_JOB_FAILURES = {
  source_changed: 'The data changed after this document was requested. Preview it again, then create it again.',
  invalid_source: 'This document can no longer be created from the chosen data. Check the selection and try again.',
  template_unavailable: 'The template revision this document was requested with is no longer available. Create it again.',
  images_invalid: 'A photo or the school logo cannot be printed. Upload it again as a PNG, JPEG or WebP image of at most 5 MB.',
  images_too_large: 'The photos are too large to print together. Use smaller photos (at most a few hundred KB each).',
  document_too_large: 'A document exceeds the rendering limit. Use a shorter template or fewer repeated blocks.',
  conversion_refused: 'The PDF converter could not print these documents. Check the template, then try again.',
  pdf_too_large: 'The PDF would be too large to store. Select fewer students or use smaller photos.',
  school_suspended: 'This school is suspended, so nothing can be created. Contact CampusPilot support.',
  no_plan: 'This school has no active plan, so nothing can be created. Contact CampusPilot to continue.',
  conversion_failed: 'The PDF could not be created. Try again.',
  internal_error: 'The PDF could not be created because of an unexpected error. Try again.',
  not_started: 'The PDF was not started in time. Try again.',
  not_finished: 'The PDF took too long to create. Try again with fewer documents.',
  dispatch_failed: 'The PDF could not be started. Try again.',
} as const;
export type DocumentGenerationJobErrorCode = keyof typeof DOCUMENT_GENERATION_JOB_FAILURES;
