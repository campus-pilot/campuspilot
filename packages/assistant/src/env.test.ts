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

  describe('question paper settings', () => {
    const PRICES = {
      QUESTION_PAPER_PRICE_INPUT_USD_PER_MTOK: '1.5',
      QUESTION_PAPER_PRICE_OUTPUT_USD_PER_MTOK: '6',
      QUESTION_PAPER_PRICE_CACHE_READ_USD_PER_MTOK: '0.15',
      QUESTION_PAPER_PRICE_CACHE_WRITE_USD_PER_MTOK: '0',
    };

    it('needs nothing and uses its defaults', () => {
      const parsed = assistantEnvSchema.parse({});
      expect(parsed.QUESTION_PAPER_MAX_OUTPUT_TOKENS).toBe(32_000);
      expect(parsed.QUESTION_PAPER_JOB_TIMEOUT_MINUTES).toBe(20);
    });

    it('requires all four prices with a model, and refuses prices without one', () => {
      expect(assistantEnvSchema.safeParse({ ...GEMINI, QUESTION_PAPER_MODEL: 'gemini-3.8-pro', ...PRICES }).success).toBe(true);
      const { QUESTION_PAPER_PRICE_OUTPUT_USD_PER_MTOK: _output, ...partial } = PRICES;
      expect(issuesOf({ ...GEMINI, QUESTION_PAPER_MODEL: 'gemini-3.8-pro', ...partial })).toEqual([
        'QUESTION_PAPER_PRICE_OUTPUT_USD_PER_MTOK',
      ]);
      expect(issuesOf({ ...GEMINI, ...PRICES })).toHaveLength(4);
    });

    it('refuses an explicit provider that has no key or no model to call', () => {
      expect(issuesOf({ QUESTION_PAPER_PROVIDER: 'anthropic' })).toEqual(['QUESTION_PAPER_PROVIDER', 'QUESTION_PAPER_PROVIDER']);
      expect(issuesOf({ ...GEMINI, QUESTION_PAPER_PROVIDER: 'gemini' })).toEqual([]);
      expect(issuesOf({ GEMINI_API_KEY: 'key', QUESTION_PAPER_PROVIDER: 'gemini' })).toContain('QUESTION_PAPER_PROVIDER');
    });
  });
});
