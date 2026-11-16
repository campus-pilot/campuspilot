import { assistantModelRequestTable } from '@campuspilot/db/schema/assistant';
import { sql } from 'drizzle-orm';

import type { AssistantExecutor } from '../db';
import type { VoicePrices } from './config';
import type { VoiceUsage } from './provider';

/**
 * Saves the usage of one reply of the voice model as cost rows
 * (`assistant_model_request`, `source = 'voice'`), so voice counts toward the
 * school's monthly limit and shows on the usage pages like every other model
 * request.
 *
 * Text and audio tokens are billed at different prices, and a cost row holds
 * one input price and one output price. So a reply is saved as up to two rows,
 * one per modality (`<requestKey>:text`, `<requestKey>:audio`), each with the
 * prices its tokens were billed at; a modality without tokens gets no row. The
 * cost uses the same expression as every other writer (tokens × USD per
 * million ÷ 10⁶ in Postgres `numeric`). The provider reports no cache use for
 * a live session, so the cache counts and prices are zero.
 *
 * Idempotent on the request key, like the other writers.
 */
export async function recordVoiceUsage(
  db: AssistantExecutor,
  input: {
    voiceSessionId: string;
    schoolId: string;
    userId: string;
    /** Unique per reply of the session; the modality is appended. */
    requestKey: string;
    provider: 'gemini';
    model: string;
    usage: VoiceUsage;
    prices: VoicePrices;
  },
): Promise<void> {
  const { usage, prices } = input;
  const modalities = [
    { name: 'text', inputTokens: usage.textInputTokens, outputTokens: usage.textOutputTokens, inputPrice: prices.textInputUsdPerMtok, outputPrice: prices.textOutputUsdPerMtok },
    { name: 'audio', inputTokens: usage.audioInputTokens, outputTokens: usage.audioOutputTokens, inputPrice: prices.audioInputUsdPerMtok, outputPrice: prices.audioOutputUsdPerMtok },
  ].filter((modality) => modality.inputTokens > 0 || modality.outputTokens > 0);
  if (modalities.length === 0) return;
  await db
    .insert(assistantModelRequestTable)
    .values(
      modalities.map((modality) => ({
        source: 'voice' as const,
        voiceSessionId: input.voiceSessionId,
        schoolId: input.schoolId,
        userId: input.userId,
        requestKey: `${input.requestKey}:${modality.name}`,
        provider: input.provider,
        requestedModel: input.model,
        // A live session does not name the model that answered each reply; it is the one the session was opened on.
        answeredModel: input.model,
        usageComplete: true,
        inputTokens: modality.inputTokens,
        outputTokens: modality.outputTokens,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
        inputUsdPerMtok: modality.inputPrice,
        outputUsdPerMtok: modality.outputPrice,
        cacheReadUsdPerMtok: '0',
        cacheWriteUsdPerMtok: '0',
        costUsd: sql`(${modality.inputTokens}::numeric * ${modality.inputPrice}::numeric
          + ${modality.outputTokens}::numeric * ${modality.outputPrice}::numeric) / 1000000`,
      })),
    )
    .onConflictDoNothing({ target: assistantModelRequestTable.requestKey });
}
