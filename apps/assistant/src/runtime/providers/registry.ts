import { env } from '@campuspilot/env/assistant';

import { createAnthropicProvider } from './anthropic';
import { createGeminiProvider } from './gemini';
import type { ModelProvider, ModelProviderId } from './types';

/**
 * The configured providers. `current` serves new conversations; `get` serves
 * an existing conversation on the provider it started with, as long as that
 * provider is still configured.
 */
export type ProviderRegistry = {
  current: ModelProvider | null;
  /** Why `current` is missing, when it is. */
  unavailableReason: string | null;
  get: (id: ModelProviderId) => ModelProvider | null;
};

function configuredProviders(): Map<ModelProviderId, ModelProvider> {
  const providers = new Map<ModelProviderId, ModelProvider>();
  if (env.ANTHROPIC_API_KEY) {
    providers.set(
      'anthropic',
      createAnthropicProvider({ apiKey: env.ANTHROPIC_API_KEY, model: env.ANTHROPIC_MODEL }),
    );
  }
  if (env.GEMINI_API_KEY && env.GEMINI_MODEL) {
    providers.set('gemini', createGeminiProvider({ apiKey: env.GEMINI_API_KEY, model: env.GEMINI_MODEL }));
  }
  return providers;
}

const MISSING: Record<ModelProviderId, string> = {
  anthropic: 'The assistant is not configured: set ANTHROPIC_API_KEY.',
  gemini: 'The assistant is not configured: set GEMINI_API_KEY and GEMINI_MODEL.',
};

let registry: ProviderRegistry | undefined;

export function providerRegistry(): ProviderRegistry {
  if (registry) return registry;
  const providers = configuredProviders();
  const current = providers.get(env.ASSISTANT_PROVIDER) ?? null;
  registry = {
    current,
    unavailableReason: current ? null : MISSING[env.ASSISTANT_PROVIDER],
    get: (id) => providers.get(id) ?? null,
  };
  return registry;
}
