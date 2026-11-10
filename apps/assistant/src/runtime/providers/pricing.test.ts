import { describe, expect, it } from 'vitest';

import { estimateCostUsd } from './pricing';

/** One million of each token kind, so an estimate reads as the sum of the list prices. */
const MILLION_EACH = {
  inputTokens: 1_000_000,
  outputTokens: 1_000_000,
  cacheReadInputTokens: 1_000_000,
  cacheCreationInputTokens: 1_000_000,
};
const MILLION_INPUT = { inputTokens: 1_000_000, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 };
const NOVEMBER = new Date('2026-11-10T12:00:00.000Z');

describe('estimateCostUsd', () => {
  it('prices each token kind at its own rate', () => {
    // claude-opus-5-5: input 4, output 20, cache read 0.2, cache write 5 (USD per million).
    expect(estimateCostUsd('claude-opus-5-5', MILLION_EACH, NOVEMBER)).toBeCloseTo(29.2, 10);
    expect(estimateCostUsd('claude-opus-5-5', MILLION_INPUT, NOVEMBER)).toBeCloseTo(4, 10);
    expect(
      estimateCostUsd(
        'claude-opus-5-5',
        { inputTokens: 1_500, outputTokens: 250, cacheReadInputTokens: 10_000, cacheCreationInputTokens: 0 },
        NOVEMBER,
      ),
    ).toBeCloseTo((1_500 * 4 + 250 * 20 + 10_000 * 0.2) / 1_000_000, 12);
  });

  it('prices a dated release as its listed model', () => {
    const listed = estimateCostUsd('claude-opus-5-5', MILLION_EACH, NOVEMBER);
    expect(listed).not.toBeNull();
    expect(estimateCostUsd('claude-opus-5-5-20260815', MILLION_EACH, NOVEMBER)).toBe(listed);
    // A release suffix belongs to the model it follows, not to a shorter id.
    expect(estimateCostUsd('claude-opus-5-5-20260815', MILLION_EACH, NOVEMBER)).not.toBe(
      estimateCostUsd('claude-sonnet-5-5', MILLION_EACH, NOVEMBER),
    );
  });

  it('gives no estimate for a different model that only shares a listed prefix', () => {
    expect(estimateCostUsd('gemini-3.8-flash', MILLION_EACH, NOVEMBER)).not.toBeNull();
    expect(estimateCostUsd('gemini-3.8-flash-lite', MILLION_EACH, NOVEMBER)).toBeNull();
  });

  it('uses the introductory gemini-3.8-flash price through 2026-12-31 and the standard price from 2027-01-01', () => {
    const lastIntroductoryDay = new Date('2026-12-31T23:59:59.999Z');
    const firstStandardDay = new Date('2027-01-01T00:00:00.000Z');
    expect(estimateCostUsd('gemini-3.8-flash', MILLION_INPUT, lastIntroductoryDay)).toBeCloseTo(0.75, 10);
    expect(estimateCostUsd('gemini-3.8-flash', MILLION_INPUT, firstStandardDay)).toBeCloseTo(1.5, 10);
    // Every token kind changes with the period, not only input.
    expect(estimateCostUsd('gemini-3.8-flash', MILLION_EACH, lastIntroductoryDay)).toBeCloseTo(0.75 + 3.75 + 0.075, 10);
    expect(estimateCostUsd('gemini-3.8-flash', MILLION_EACH, firstStandardDay)).toBeCloseTo(1.5 + 7.5 + 0.15, 10);
  });

  it('gives no estimate for an unknown model or a run that has no model yet', () => {
    expect(estimateCostUsd('some-unlisted-model', MILLION_EACH, NOVEMBER)).toBeNull();
    expect(estimateCostUsd(null, MILLION_EACH, NOVEMBER)).toBeNull();
  });
});
