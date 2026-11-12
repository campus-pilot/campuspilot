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

/**
 * Every `error_code` a failed generation job can carry, with the safe text the
 * user reads (`error_message`). The sweep writes the last three; the workflow
 * writes the rest. `unsupported_page_format` and `page_unreadable` name the
 * page in their message, so their text here is only the default.
 */
export const QUESTION_PAPER_JOB_FAILURES = {
  limit_reached: 'This school has reached its AI limit for this month.',
  feature_disabled: 'The AI assistant is switched off for this school.',
  role_not_enabled: 'You cannot use the AI assistant in this school.',
  unsupported_page_format: 'A page is in a format the AI model cannot read. Convert it to JPEG and upload it again.',
  images_too_large: 'The pages are too large to send together. Remove some pages or upload smaller photos.',
  page_unreadable: 'A page could not be read. Upload it again.',
  model_rejected: 'The AI could not process these pages. Try fewer or clearer photos.',
  provider_unavailable: 'AI generation is not available right now.',
  model_busy: 'The AI service is busy. Try again in a few minutes.',
  model_error: 'The AI service failed. Try again.',
  invalid_output: 'The AI returned a paper that could not be used. Try again.',
  output_too_long: 'This paper is too long to read in one go.',
  template_missing: 'Choose a question paper template first.',
  paper_locked: 'This paper can no longer be changed.',
  plan_mode_removed: 'The exam plan no longer has this paper\'s mode, so the paper was not saved. Check the exam plan and try again.',
  paper_unprintable: 'The paper was read but it is too large or too complex to print. Use fewer pages or simpler formulas.',
  pdf_failed: 'The paper was read but the PDF could not be created. Try again.',
  internal_error: 'AI generation failed unexpectedly. Try again.',
  not_started: 'AI generation did not start. Try again.',
  not_finished: 'AI generation took too long. Try again.',
  dispatch_failed: 'AI generation could not be started. Try again.',
} as const;
export type QuestionPaperJobErrorCode = keyof typeof QUESTION_PAPER_JOB_FAILURES;
