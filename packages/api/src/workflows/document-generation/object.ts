import * as restate from '@restatedev/restate-sdk';

import { DOCUMENT_GENERATION_OBJECT_NAME } from './constants';
import { runDocumentGeneration, type DocumentGenerationOutcome, type StepRunner } from './generation';
import { documentGenerationJobInputSchema, type DocumentGenerationJobInput } from './input';
import { log } from './log';

/** Shared, non-revealing text for unexpected step failures (Restate keeps and shows `last_failure`). */
const UNEXPECTED_STEP_FAILURE = 'A database, storage or PDF conversion operation failed; the worker log has the details.';

/**
 * Bounded retries for infrastructure failures (storage, database,
 * Gotenberg). After the last one the step's error reaches the job, which
 * ends `failed` (`conversion_failed` or `internal_error`), so a broken batch
 * never holds the school's queue for long.
 */
const DEFAULT_STEP_OPTIONS = {
  maxRetryAttempts: 5,
  initialRetryInterval: 2_000,
  retryIntervalFactor: 2,
  maxRetryInterval: 30_000,
} as const;

/**
 * Journals one unit of work. An error that escapes the action (business
 * failures are returned as values, see `generation.ts`) is logged without
 * its parameters and replaced by a generic one, because Restate stores the
 * text.
 */
function journaled(ctx: restate.ObjectContext): StepRunner {
  return (name, action, options) =>
    ctx.run(
      name,
      async () => {
        try {
          return await action();
        } catch (error) {
          log.error(
            {
              object: DOCUMENT_GENERATION_OBJECT_NAME,
              key: ctx.key,
              step: name,
              err: error instanceof Error ? { name: error.name, message: error.message.split('\nparams:')[0]!.slice(0, 500) } : String(error),
            },
            'document-generation.step.error',
          );
          throw new Error(UNEXPECTED_STEP_FAILURE);
        }
      },
      { ...DEFAULT_STEP_OPTIONS, ...options },
    );
}

/**
 * Runs document generation jobs, keyed by school id. `generate` is an
 * exclusive handler, so Restate runs at most one job of a school at a time
 * and queues that school's other jobs in arrival order, while jobs of other
 * schools run alongside (each bounded by the process's conversion slots,
 * `conversion-slots.ts`). One school's 1,500-document export therefore
 * delays only that school's next export. Private to ingress: only
 * `DocumentGenerationControl`, which checks the job row first, sends to it.
 *
 * A batch conversion can take up to two minutes and may first wait for a
 * conversion slot, longer than Restate's default inactivity and abort
 * timeouts (1 minute), so both are raised; the API sweep fails a job that
 * runs past `DOCUMENT_GENERATION_RUN_DEADLINE_MS` anyway, and every step
 * checks the job is still running first.
 */
export const documentGenerationObject = restate.object({
  name: DOCUMENT_GENERATION_OBJECT_NAME,
  options: { ingressPrivate: true, inactivityTimeout: 15 * 60_000, abortTimeout: 15 * 60_000 },
  handlers: {
    generate: async (ctx: restate.ObjectContext, rawInput: DocumentGenerationJobInput): Promise<DocumentGenerationOutcome> => {
      const parsed = documentGenerationJobInputSchema.safeParse(rawInput);
      if (!parsed.success) throw new restate.TerminalError('Invalid document generation input.', { errorCode: 400 });
      const outcome = await runDocumentGeneration(parsed.data, journaled(ctx), { expectedSchoolId: ctx.key });
      log.info({ jobId: parsed.data.jobId, status: outcome.status }, 'document-generation.job.finished');
      return outcome;
    },
  },
});

export type DocumentGenerationObject = typeof documentGenerationObject;
