import type { ModelUsage } from './types';

/** USD per million tokens. */
type ModelPrice = { input: number; output: number; cacheRead: number; cacheWrite: number };

/**
 * One price a model has had. `until` is the last UTC day (YYYY-MM-DD) the
 * price applies; the entry without it is the current open-ended price.
 */
type PricePeriod = ModelPrice & { until?: string };

/**
 * List prices for developer cost estimates (diagnostics), as of 2026-11.
 * They are estimates only: they ignore long-context tiers, batch and
 * regional pricing, and drift when providers change prices. Cache writes
 * use the 5-minute rate (1.25x input) where the provider charges for them.
 * A model missing here gets no estimate rather than a wrong one.
 * Periods are listed oldest first.
 */
const MODEL_PRICES: Record<string, readonly PricePeriod[]> = {
  'claude-fable-5-1': [{ input: 10, output: 50, cacheRead: 0.25, cacheWrite: 12.5 }],
  'claude-opus-5-5': [{ input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 }],
  'claude-sonnet-5-5': [{ input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 }],
  'claude-haiku-5-5': [{ input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 }],
  // Gemini bills implicit cache reads and no cache writes.
  'gemini-4-argon': [{ input: 2, output: 10, cacheRead: 0.1, cacheWrite: 0 }],
  // Introductory rate, then the standard rate. Cache reads are assumed at
  // Gemini's usual 10% of input; that rate is not published yet.
  'gemini-3.8-flash': [
    { until: '2026-12-31', input: 0.75, output: 3.75, cacheRead: 0.075, cacheWrite: 0 },
    { input: 1.5, output: 7.5, cacheRead: 0.15, cacheWrite: 0 },
  ],
};

/** A dated or numbered release of a listed model: `-20260815`, `-2026-08-15`, `-001`. */
const RELEASE_SUFFIX = /^-\d[\d-]*$/;

/**
 * Price periods for a model id as a provider reports it. Providers answer
 * with the exact release that served the request (`claude-opus-5-5-20260815`
 * for `claude-opus-5-5`), which has the listed model's price. Only a release
 * suffix is accepted: `gemini-3.8-flash-lite` is a different model with a
 * different price, and gets no estimate.
 */
function pricePeriods(model: string): readonly PricePeriod[] | undefined {
  const exact = MODEL_PRICES[model];
  if (exact) return exact;
  const listed = Object.keys(MODEL_PRICES).find(
    (id) => model.startsWith(id) && RELEASE_SUFFIX.test(model.slice(id.length)),
  );
  return listed ? MODEL_PRICES[listed] : undefined;
}

/**
 * Estimated USD cost of a run's usage at the prices in force on the day it
 * ran (`at`), or null when the model's prices are unknown.
 */
export function estimateCostUsd(model: string | null, usage: ModelUsage, at: Date): number | null {
  const day = at.toISOString().slice(0, 10);
  const price = model
    ? pricePeriods(model)?.find((period) => period.until === undefined || day <= period.until)
    : undefined;
  if (!price) return null;
  return (
    (usage.inputTokens * price.input +
      usage.outputTokens * price.output +
      usage.cacheReadInputTokens * price.cacheRead +
      usage.cacheCreationInputTokens * price.cacheWrite) /
    1_000_000
  );
}
