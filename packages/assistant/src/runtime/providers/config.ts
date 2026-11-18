import { env } from '@campuspilot/env/assistant';

import { MODEL_PROVIDER_IDS, type ModelProviderId } from './types';

/**
 * A provider's prices in USD per million tokens, as decimal text exactly as
 * configured. They are copied onto each `assistant_model_request` row and
 * multiplied in Postgres `numeric`, so no float ever touches money.
 */
export type ModelPrices = {
  inputUsdPerMtok: string;
  outputUsdPerMtok: string;
  cacheReadUsdPerMtok: string;
  cacheWriteUsdPerMtok: string;
};

/** Everything one configured provider needs: its key, the model it calls and its prices. */
export type ProviderSettings = {
  id: ModelProviderId;
  apiKey: string;
  model: string;
  prices: ModelPrices;
};

const ENV_PREFIX: Record<ModelProviderId, 'ANTHROPIC' | 'GEMINI'> = {
  anthropic: 'ANTHROPIC',
  gemini: 'GEMINI',
};

/**
 * One provider's settings from an environment, or null when it is not
 * configured. A provider is configured only when its key, model and all four
 * prices are set (`<P>_API_KEY`, `<P>_MODEL`, `<P>_PRICE_*_USD_PER_MTOK`);
 * the env schema already refuses a provider with only some of them, and this
 * never fills a missing price with a default.
 */
export function readProviderSettings(
  source: Readonly<Record<string, string | undefined>>,
  id: ModelProviderId,
): ProviderSettings | null {
  const prefix = ENV_PREFIX[id];
  const apiKey = source[`${prefix}_API_KEY`];
  const model = source[`${prefix}_MODEL`];
  const inputUsdPerMtok = source[`${prefix}_PRICE_INPUT_USD_PER_MTOK`];
  const outputUsdPerMtok = source[`${prefix}_PRICE_OUTPUT_USD_PER_MTOK`];
  const cacheReadUsdPerMtok = source[`${prefix}_PRICE_CACHE_READ_USD_PER_MTOK`];
  const cacheWriteUsdPerMtok = source[`${prefix}_PRICE_CACHE_WRITE_USD_PER_MTOK`];
  if (!apiKey || !model || !inputUsdPerMtok || !outputUsdPerMtok || !cacheReadUsdPerMtok || !cacheWriteUsdPerMtok) {
    return null;
  }
  return {
    id,
    apiKey,
    model,
    prices: { inputUsdPerMtok, outputUsdPerMtok, cacheReadUsdPerMtok, cacheWriteUsdPerMtok },
  };
}

/** Every configured provider of this deployment, by id. */
export function configuredProviderSettings(): ReadonlyMap<ModelProviderId, ProviderSettings> {
  const source = env as unknown as Readonly<Record<string, string | undefined>>;
  const settings = new Map<ModelProviderId, ProviderSettings>();
  for (const id of MODEL_PROVIDER_IDS) {
    const configured = readProviderSettings(source, id);
    if (configured) settings.set(id, configured);
  }
  return settings;
}

/** The provider new conversations start on (`ASSISTANT_PROVIDER`). */
export const selectedProviderId = (): ModelProviderId => env.ASSISTANT_PROVIDER;

/** The provider that answers Pro messages (`ASSISTANT_PRO_PROVIDER`), or null when Pro stays on the conversation's provider. */
export const proProviderId = (): ModelProviderId | null => env.ASSISTANT_PRO_PROVIDER ?? null;

/** Why the selected provider cannot be used, for status and logs. */
export function missingProviderReason(id: ModelProviderId): string {
  const prefix = ENV_PREFIX[id];
  return `The assistant is not configured: set ${prefix}_API_KEY, ${prefix}_MODEL and the four ${prefix}_PRICE_*_USD_PER_MTOK settings.`;
}

/**
 * What question paper generation calls: a provider, its key, the model and the
 * prices that model is billed at.
 */
export type QuestionPaperSettings = ProviderSettings;

/**
 * The settings of question paper generation from an environment, or null when
 * it cannot be called. The provider is `QUESTION_PAPER_PROVIDER`, else
 * `defaultProviderId` (the assistant's). With `QUESTION_PAPER_MODEL` set the
 * model and its four `QUESTION_PAPER_PRICE_*` prices come from the question
 * paper settings (the env schema requires all four with a model, and refuses
 * them without one); otherwise the provider's own model and prices are used.
 * Only the API key is always the provider's own: a model override never
 * brings a different key. A model never inherits another model's prices.
 */
export function readQuestionPaperSettings(
  source: Readonly<Record<string, string | undefined>>,
  defaultProviderId: ModelProviderId,
): QuestionPaperSettings | null {
  const providerId = (source.QUESTION_PAPER_PROVIDER as ModelProviderId | undefined) ?? defaultProviderId;
  const model = source.QUESTION_PAPER_MODEL;
  if (!model) return readProviderSettings(source, providerId);
  const apiKey = source[`${ENV_PREFIX[providerId]}_API_KEY`];
  const inputUsdPerMtok = source.QUESTION_PAPER_PRICE_INPUT_USD_PER_MTOK;
  const outputUsdPerMtok = source.QUESTION_PAPER_PRICE_OUTPUT_USD_PER_MTOK;
  const cacheReadUsdPerMtok = source.QUESTION_PAPER_PRICE_CACHE_READ_USD_PER_MTOK;
  const cacheWriteUsdPerMtok = source.QUESTION_PAPER_PRICE_CACHE_WRITE_USD_PER_MTOK;
  if (!apiKey || !inputUsdPerMtok || !outputUsdPerMtok || !cacheReadUsdPerMtok || !cacheWriteUsdPerMtok) return null;
  return { id: providerId, apiKey, model, prices: { inputUsdPerMtok, outputUsdPerMtok, cacheReadUsdPerMtok, cacheWriteUsdPerMtok } };
}

/** The question paper settings of this deployment, or null when generation is not configured. */
export function questionPaperSettings(): QuestionPaperSettings | null {
  return readQuestionPaperSettings(env as unknown as Readonly<Record<string, string | undefined>>, selectedProviderId());
}

/**
 * The figure route of question paper generation: the model a paper with
 * diagrams is written with, and the decision model that tells such a paper
 * apart, billed for its input only (it writes no text).
 */
export type QuestionPaperStrongSettings = {
  strong: QuestionPaperSettings;
  decision: { apiKey: string; model: string; inputUsdPerMtok: string };
};

/**
 * The figure route from an environment, or null when it is off. It is on when
 * `QUESTION_PAPER_STRONG_MODEL` is set with its four prices and the decision
 * model's input price, and question papers run on Gemini (the env schema
 * refuses anything else; this returns null for it all the same). The key is
 * Gemini's own, as for every question paper model.
 */
export function readQuestionPaperStrongSettings(
  source: Readonly<Record<string, string | undefined>>,
  defaultProviderId: ModelProviderId,
): QuestionPaperStrongSettings | null {
  const providerId = (source.QUESTION_PAPER_PROVIDER as ModelProviderId | undefined) ?? defaultProviderId;
  const model = source.QUESTION_PAPER_STRONG_MODEL;
  const apiKey = source.GEMINI_API_KEY;
  const inputUsdPerMtok = source.QUESTION_PAPER_STRONG_PRICE_INPUT_USD_PER_MTOK;
  const outputUsdPerMtok = source.QUESTION_PAPER_STRONG_PRICE_OUTPUT_USD_PER_MTOK;
  const cacheReadUsdPerMtok = source.QUESTION_PAPER_STRONG_PRICE_CACHE_READ_USD_PER_MTOK;
  const cacheWriteUsdPerMtok = source.QUESTION_PAPER_STRONG_PRICE_CACHE_WRITE_USD_PER_MTOK;
  const decisionInputUsdPerMtok = source.QUESTION_PAPER_DECISION_PRICE_INPUT_USD_PER_MTOK;
  if (providerId !== 'gemini' || !model || !apiKey) return null;
  if (!inputUsdPerMtok || !outputUsdPerMtok || !cacheReadUsdPerMtok || !cacheWriteUsdPerMtok || !decisionInputUsdPerMtok) return null;
  return {
    strong: { id: 'gemini', apiKey, model, prices: { inputUsdPerMtok, outputUsdPerMtok, cacheReadUsdPerMtok, cacheWriteUsdPerMtok } },
    decision: { apiKey, model: source.QUESTION_PAPER_DECISION_MODEL || 'gemini-decision-1', inputUsdPerMtok: decisionInputUsdPerMtok },
  };
}

/** The figure route of this deployment, or null when it is off. */
export function questionPaperStrongSettings(): QuestionPaperStrongSettings | null {
  return readQuestionPaperStrongSettings(env as unknown as Readonly<Record<string, string | undefined>>, selectedProviderId());
}
