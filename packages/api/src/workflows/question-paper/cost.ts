import type { DatabaseExecutor } from '@campuspilot/db';
import { assistantModelRequestTable } from '@campuspilot/db/schema/assistant';
import { examQuestionPaperJobTable } from '@campuspilot/db/schema/exam-question-paper';
import { eq, sql } from 'drizzle-orm';

import type { ModelUsage, QuestionPaperModel } from './model';

/**
 * The idempotency key of a model request of one attempt of a job. `n` is the
 * request's place in the job (1 the transcription, 2 the repair); a billed
 * attempt that failed and was retried adds `:attempt:{k}`. A step replayed by
 * Restate computes the same key and so saves nothing a second time.
 */
export function questionPaperRequestKey(jobId: string, attempt: number, n: number, failedAttempt?: number): string {
  const base = `qp:${jobId}.${attempt}:model:${n}`;
  return failedAttempt === undefined ? base : `${base}:attempt:${failedAttempt}`;
}

/**
 * Saves one model request of a generation job in `assistant_model_request`
 * with `source = 'question_paper'`, no run and the job's id, and returns
 * whether a row was written (false when this key was saved before).
 *
 * The same rule as `recordModelRequest` in the assistant package (which this
 * package cannot import): the prices are the ones the model was configured
 * with (`QUESTION_PAPER_*` when a model override is set, else the provider's),
 * copied onto the row, and `cost_usd` is computed once in Postgres `numeric`.
 * Because spend, the monthly limit and the usage pages read this table only,
 * a generation counts toward the school's AI limit and usage with no further
 * step. A failed attempt the provider billed (`usageComplete: false` when it
 * reported only part of its usage) is saved too.
 *
 * The job's own `model_request_count` and `model` follow from the saved rows,
 * recomputed from them (not incremented), so a replay cannot count twice.
 */
export async function recordQuestionPaperRequest(
  db: DatabaseExecutor,
  input: {
    jobId: string;
    schoolId: string;
    userId: string;
    requestKey: string;
    model: Pick<QuestionPaperModel, 'provider' | 'model' | 'prices'>;
    answeredModel: string;
    usage: ModelUsage;
    usageComplete: boolean;
  },
): Promise<boolean> {
  const { usage, model } = input;
  const prices = model.prices;
  const [saved] = await db
    .insert(assistantModelRequestTable)
    .values({
      source: 'question_paper',
      runId: null,
      questionPaperJobId: input.jobId,
      schoolId: input.schoolId,
      userId: input.userId,
      requestKey: input.requestKey,
      provider: model.provider,
      requestedModel: model.model,
      answeredModel: input.answeredModel,
      usageComplete: input.usageComplete,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheReadInputTokens: usage.cacheReadInputTokens,
      cacheCreationInputTokens: usage.cacheCreationInputTokens,
      inputUsdPerMtok: prices.inputUsdPerMtok,
      outputUsdPerMtok: prices.outputUsdPerMtok,
      cacheReadUsdPerMtok: prices.cacheReadUsdPerMtok,
      cacheWriteUsdPerMtok: prices.cacheWriteUsdPerMtok,
      costUsd: sql`(${usage.inputTokens}::numeric * ${prices.inputUsdPerMtok}::numeric
        + ${usage.outputTokens}::numeric * ${prices.outputUsdPerMtok}::numeric
        + ${usage.cacheReadInputTokens}::numeric * ${prices.cacheReadUsdPerMtok}::numeric
        + ${usage.cacheCreationInputTokens}::numeric * ${prices.cacheWriteUsdPerMtok}::numeric) / 1000000`,
    })
    .onConflictDoNothing({ target: assistantModelRequestTable.requestKey })
    .returning({ id: assistantModelRequestTable.id });
  await db
    .update(examQuestionPaperJobTable)
    .set({
      model: input.answeredModel,
      modelRequestCount: sql`(select count(*) from ${assistantModelRequestTable} where ${assistantModelRequestTable.questionPaperJobId} = ${input.jobId})::int`,
    })
    .where(eq(examQuestionPaperJobTable.id, input.jobId));
  return Boolean(saved);
}
