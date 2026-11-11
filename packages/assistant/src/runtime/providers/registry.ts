import { createAnthropicProvider } from './anthropic';
import {
  configuredProviderSettings,
  missingProviderReason,
  selectedProviderId,
  type ModelPrices,
} from './config';
import { createGeminiProvider } from './gemini';
import type { ModelProvider, ModelProviderId } from './types';

/**
 * The configured providers, as the worker's turn loop uses them. `current`
 * serves new conversations; `get` serves an existing conversation on the
 * provider it started with, as long as that provider is still configured;
 * `prices` are the prices the provider is configured with now, saved with
 * every model request.
 */
export type ProviderRegistry = {
  current: ModelProvider | null;
  /** Why `current` is missing, when it is. */
  unavailableReason: string | null;
  get: (id: ModelProviderId) => ModelProvider | null;
  prices: (id: ModelProviderId) => ModelPrices | null;
};

let registry: ProviderRegistry | undefined;

export function providerRegistry(): ProviderRegistry {
  if (registry) return registry;
  const settings = configuredProviderSettings();
  const providers = new Map<ModelProviderId, ModelProvider>();
  for (const configured of settings.values()) {
    const create = configured.id === 'anthropic' ? createAnthropicProvider : createGeminiProvider;
    providers.set(configured.id, create({ apiKey: configured.apiKey, model: configured.model }));
  }
  const selected = selectedProviderId();
  const current = providers.get(selected) ?? null;
  registry = {
    current,
    unavailableReason: current ? null : missingProviderReason(selected),
    get: (id) => providers.get(id) ?? null,
    prices: (id) => settings.get(id)?.prices ?? null,
  };
  return registry;
}
