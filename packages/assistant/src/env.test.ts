import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { assistantEnvSchema } from '@campuspilot/env/assistant';

const GEMINI = {
  GEMINI_API_KEY: 'key',
  GEMINI_MODEL: 'gemini-3.8-flash',
  GEMINI_PRICE_INPUT_USD_PER_MTOK: '0.75',
  GEMINI_PRICE_OUTPUT_USD_PER_MTOK: '3.75',
  GEMINI_PRICE_CACHE_READ_USD_PER_MTOK: '0.075',
  GEMINI_PRICE_CACHE_WRITE_USD_PER_MTOK: '0',
};

const issuesOf = (values: Record<string, string>) => {
  const result = assistantEnvSchema.safeParse(values);
  return result.success ? [] : result.error.issues.map((issue) => issue.path.join('.'));
};

describe('the assistant environment', () => {
  it('accepts a provider with all six settings, or none', () => {
    expect(assistantEnvSchema.safeParse(GEMINI).success).toBe(true);
    expect(assistantEnvSchema.safeParse({}).success).toBe(true);
  });

  it('refuses a half-configured provider, naming each missing setting', () => {
    const { GEMINI_PRICE_CACHE_WRITE_USD_PER_MTOK: _write, GEMINI_MODEL: _model, ...half } = GEMINI;
    expect(issuesOf(half).sort()).toEqual(['GEMINI_MODEL', 'GEMINI_PRICE_CACHE_WRITE_USD_PER_MTOK']);
    expect(issuesOf({ ANTHROPIC_API_KEY: 'key' })).toHaveLength(5);
  });

  it('refuses a price that is not a decimal amount', () => {
    expect(issuesOf({ ...GEMINI, GEMINI_PRICE_INPUT_USD_PER_MTOK: '0,75' })).toEqual(['GEMINI_PRICE_INPUT_USD_PER_MTOK']);
    expect(z.string().safeParse('ok').success).toBe(true);
  });
});
