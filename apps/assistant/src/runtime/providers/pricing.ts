import type { ModelUsage } from './types';

/** USD per million tokens. */
type ModelPrice = { input: number; output: number; cacheRead: number; cacheWrite: number };

/**
 * List prices for developer cost estimates (diagnostics), as of 2026-11.
 * They are estimates only: they ignore long-context tiers, batch and
 * regional pricing, and drift when providers change prices. Cache writes
 * use the 5-minute rate (1.25x input) where the provider charges for them.
 * A model missing here gets no estimate rather than a wrong one.
 */
const MODEL_PRICES: Record<string, ModelPrice> = {
  'claude-fable-5-1': { input: 10, output: 50, cacheRead: 0.25, cacheWrite: 12.5 },
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
  // Gemini bills implicit cache reads and no cache writes.
  'gemini-4-argon': { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 0 },
  // Introductory rate until 2026-12-31 (standard from 2027: $1.50 / $7.50).
  // Cache reads assumed at Gemini's usual 10% of input; not yet published.
  'gemini-3.8-flash': { input: 0.75, output: 3.75, cacheRead: 0.075, cacheWrite: 0 },
};

/** Estimated USD cost of a run's usage, or null when the model's prices are unknown. */
export function estimateCostUsd(model: string | null, usage: ModelUsage): number | null {
  const price = model ? MODEL_PRICES[model] : undefined;
  if (!price) return null;
  return (
    (usage.inputTokens * price.input +
      usage.outputTokens * price.output +
      usage.cacheReadInputTokens * price.cacheRead +
      usage.cacheCreationInputTokens * price.cacheWrite) /
    1_000_000
  );
}
