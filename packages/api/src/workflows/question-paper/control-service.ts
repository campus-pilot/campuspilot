import { db } from '@campuspilot/db';
import { examQuestionPaperJobTable } from '@campuspilot/db/schema/exam-question-paper';
import * as restate from '@restatedev/restate-sdk';
import { and, eq, inArray } from 'drizzle-orm';

import { authenticateControlCall } from '../control-service-auth';
import { QUESTION_PAPER_CONTROL_SERVICE_NAME, questionPaperWorkflowKey, type QuestionPaperControlHandler } from './constants';
import { questionPaperJobInputSchema, type QuestionPaperJobInput } from './input';
import { log } from './log';
import { questionPaperGenerationWorkflow } from './workflow';

/** A database step with bounded retries and a generic failure text (no SQL). */
function safeRun<T>(ctx: restate.Context, name: string, action: () => Promise<T>) {
  return ctx.run(
    name,
    async () => {
      try {
        return await action();
      } catch (error) {
        log.error({ service: QUESTION_PAPER_CONTROL_SERVICE_NAME, step: name, err: error instanceof Error ? error.name : 'unknown' }, 'question-paper.control.error');
        throw new Error('A database operation failed; the worker log has the details.');
      }
    },
    { maxRetryAttempts: 5 },
  );
}

/**
 * `QuestionPaperControl` is the only question paper service reachable through
 * Restate ingress; the generation workflow is `ingressPrivate`. The API hands
 * a queued job over with a one-way, idempotent, signed send (the outbox in
 * `outbox.ts`), so no request waits for the worker. `startGeneration` is, in
 * order: Zod-parsed (malformed input fails terminally at once), authenticated
 * by its HMAC signature (`WORKER_CONTROL_SECRET`, bound to this service and
 * handler), checked against the database (the job exists, is at this attempt
 * and is queued or running), and only then starts the workflow under the
 * attempt's key. It never trusts the caller beyond the job id and attempt.
 */
export const questionPaperControlService = restate.service({
  name: QUESTION_PAPER_CONTROL_SERVICE_NAME,
  handlers: {
    startGeneration: async (ctx: restate.Context, rawInput: QuestionPaperJobInput): Promise<{ invocationId: string }> => {
      const parsed = questionPaperJobInputSchema.safeParse(rawInput);
      if (!parsed.success) throw new restate.TerminalError('Invalid question paper generation request.', { errorCode: 400 });
      const input = parsed.data;
      const handler: QuestionPaperControlHandler = 'startGeneration';
      await authenticateControlCall(ctx, { service: QUESTION_PAPER_CONTROL_SERVICE_NAME, handler, input, log });
      const allowed = await safeRun(ctx, 'validate-job', async () => {
        const [job] = await db
          .select({ id: examQuestionPaperJobTable.id })
          .from(examQuestionPaperJobTable)
          .where(
            and(
              eq(examQuestionPaperJobTable.id, input.jobId),
              eq(examQuestionPaperJobTable.attempt, input.attempt),
              inArray(examQuestionPaperJobTable.status, ['queued', 'running']),
            ),
          )
          .limit(1);
        return Boolean(job);
      });
      if (!allowed) throw new restate.TerminalError('No queued or running generation job matches this attempt.', { errorCode: 409 });
      const handle = ctx.workflowSendClient(questionPaperGenerationWorkflow, questionPaperWorkflowKey(input.jobId, input.attempt)).run(input);
      return { invocationId: await handle.invocationId };
    },
  },
});

export type QuestionPaperControlService = typeof questionPaperControlService;
