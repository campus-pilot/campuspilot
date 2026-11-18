import { createAnthropicProvider } from './anthropic';
import {
  configuredProviderSettings,
  missingProviderReason,
  proProviderId,
  questionPaperStrongSettings,
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
 *
 * A message sent with Pro picked is answered by `pro`: another provider
 * (`ASSISTANT_PRO_PROVIDER`), or the provider's stronger model, Gemini's
 * `QUESTION_PAPER_STRONG_MODEL`. `get` and `prices` with that model's name return its
 * instance and its own prices; with any other name (a run journaled before
 * the stronger model was removed, say) they return the provider's own, so a
 * request is always billed at the prices of the model it calls.
 */
export type ProviderRegistry = {
  current: ModelProvider | null;
  /** Why `current` is missing, when it is. */
  unavailableReason: string | null;
  get: (id: ModelProviderId, model?: string) => ModelProvider | null;
  prices: (id: ModelProviderId, model?: string) => ModelPrices | null;
  /**
   * What answers a Pro message in a conversation on `id`: the provider named by
   * `ASSISTANT_PRO_PROVIDER` when it is another one, else `id`'s stronger
   * model; null when Pro is the standard model.
   */
  pro: (id: ModelProviderId) => ModelProvider | null;
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
  const strongSettings = questionPaperStrongSettings()?.strong ?? null;
  const strong = strongSettings && providers.has('gemini') ? createGeminiProvider({ apiKey: strongSettings.apiKey, model: strongSettings.model }) : null;
  /** Whether `model` names the stronger model of `id`, other than its own. */
  const isStrong = (id: ModelProviderId, model: string | undefined) => id === 'gemini' && strong !== null && model === strong.model && model !== providers.get(id)?.model;
  registry = {
    current,
    unavailableReason: current ? null : missingProviderReason(selected),
    get: (id, model) => (isStrong(id, model) ? strong : (providers.get(id) ?? null)),
    prices: (id, model) => (isStrong(id, model) ? strongSettings!.prices : (settings.get(id)?.prices ?? null)),
    pro: (id) => {
      const proId = proProviderId();
      if (proId && proId !== id) return providers.get(proId) ?? null;
      return id === 'gemini' && providers.has('gemini') ? strong : null;
    },
  };
  return registry;
}
