import * as restate from '@restatedev/restate-sdk';

import { QUESTION_PAPER_WORKFLOW_NAME, questionPaperWorkflowKey } from './constants';
import { runQuestionPaperGeneration, type GenerationOutcome, type StepRunner } from './generation';
import { questionPaperJobInputSchema, type QuestionPaperJobInput } from './input';
import { log } from './log';

/** Shared, non-revealing text for unexpected step failures (Restate keeps and shows `last_failure`). */
const UNEXPECTED_STEP_FAILURE = 'A model, database or storage operation failed; the worker log has the details.';

/** Bounded retries for transient failures (storage, database, Gotenberg); a model step lowers it itself. */
const DEFAULT_STEP_OPTIONS = {
  maxRetryAttempts: 5,
  initialRetryInterval: 1_000,
  retryIntervalFactor: 2,
  maxRetryInterval: 30_000,
} as const;

/**
 * Journals one unit of work. An error that escapes the action (business
 * failures are returned as values, see `generation.ts`) is logged without its
 * parameters and replaced by a generic one, because Restate stores the text.
 */
function journaled(ctx: restate.WorkflowContext): StepRunner {
  return (name, action, options) =>
    ctx.run(
      name,
      async () => {
        try {
          return await action();
        } catch (error) {
          log.error({ workflow: QUESTION_PAPER_WORKFLOW_NAME, key: ctx.key, step: name, err: error instanceof Error ? { name: error.name, message: error.message.split('\nparams:')[0]!.slice(0, 500) } : String(error) }, 'question-paper.step.error');
          throw new Error(UNEXPECTED_STEP_FAILURE);
        }
      },
      { ...DEFAULT_STEP_OPTIONS, ...options },
    );
}

/**
 * Generates a question paper from the uploaded pages of one job attempt. Keyed
 * by `{jobId}.{attempt}`, so an attempt runs once; every write is idempotent
 * besides (cost rows by request key, the version by job id). Private to
 * ingress: only `QuestionPaperControl`, which checks the job row first,
 * starts it. The job row carries the outcome (`succeeded` or `failed` with a
 * code and a safe message), so the workflow itself returns normally for a job
 * that could not succeed.
 *
 * A model call can take minutes, longer than Restate's default inactivity
 * and abort timeouts (1 minute), so both are raised above the job timeout
 * (`QUESTION_PAPER_JOB_TIMEOUT_MINUTES`, at most 240; the API's sweep fails
 * the job at that deadline anyway, and every step checks that the job is
 * still live before spending).
 */
export const questionPaperGenerationWorkflow = restate.workflow({
  name: QUESTION_PAPER_WORKFLOW_NAME,
  options: { ingressPrivate: true, inactivityTimeout: 30 * 60_000, abortTimeout: 30 * 60_000 },
  handlers: {
    run: async (ctx: restate.WorkflowContext, rawInput: QuestionPaperJobInput): Promise<GenerationOutcome> => {
      const parsed = questionPaperJobInputSchema.safeParse(rawInput);
      if (!parsed.success) throw new restate.TerminalError('Invalid question paper generation input.', { errorCode: 400 });
      const input = parsed.data;
      if (ctx.key !== questionPaperWorkflowKey(input.jobId, input.attempt)) {
        throw new restate.TerminalError('The workflow key does not match the job.', { errorCode: 400 });
      }
      const outcome = await runQuestionPaperGeneration(input, journaled(ctx));
      log.info({ jobId: input.jobId, attempt: input.attempt, status: outcome.status }, 'question-paper.job.finished');
      return outcome;
    },
  },
});

export type QuestionPaperGenerationWorkflow = typeof questionPaperGenerationWorkflow;
