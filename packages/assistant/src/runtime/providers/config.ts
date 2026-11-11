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

/** Why the selected provider cannot be used, for status and logs. */
export function missingProviderReason(id: ModelProviderId): string {
  const prefix = ENV_PREFIX[id];
  return `The assistant is not configured: set ${prefix}_API_KEY, ${prefix}_MODEL and the four ${prefix}_PRICE_*_USD_PER_MTOK settings.`;
}
