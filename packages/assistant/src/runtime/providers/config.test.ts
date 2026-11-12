import { describe, expect, it } from 'vitest';

import { readProviderSettings, readQuestionPaperSettings } from './config';

const GEMINI = {
  GEMINI_API_KEY: 'key',
  GEMINI_MODEL: 'gemini-3.8-flash',
  GEMINI_PRICE_INPUT_USD_PER_MTOK: '0.75',
  GEMINI_PRICE_OUTPUT_USD_PER_MTOK: '3.75',
  GEMINI_PRICE_CACHE_READ_USD_PER_MTOK: '0.075',
  GEMINI_PRICE_CACHE_WRITE_USD_PER_MTOK: '0',
};

describe('readProviderSettings', () => {
  it('reads a provider with its key, model and four prices, keeping the prices as text', () => {
    expect(readProviderSettings(GEMINI, 'gemini')).toEqual({
      id: 'gemini',
      apiKey: 'key',
      model: 'gemini-3.8-flash',
      prices: {
        inputUsdPerMtok: '0.75',
        outputUsdPerMtok: '3.75',
        cacheReadUsdPerMtok: '0.075',
        cacheWriteUsdPerMtok: '0',
      },
    });
  });

  it.each(Object.keys(GEMINI))('treats the provider as not configured without %s', (name) => {
    expect(readProviderSettings({ ...GEMINI, [name]: undefined }, 'gemini')).toBeNull();
  });

  it('reads each provider from its own prefix only', () => {
    expect(readProviderSettings(GEMINI, 'anthropic')).toBeNull();
    const anthropic = Object.fromEntries(Object.entries(GEMINI).map(([key, value]) => [key.replace('GEMINI', 'ANTHROPIC'), value]));
    expect(readProviderSettings(anthropic, 'anthropic')).toMatchObject({ id: 'anthropic', model: 'gemini-3.8-flash' });
  });
});

describe('readQuestionPaperSettings', () => {
  const OVERRIDE = {
    QUESTION_PAPER_MODEL: 'gemini-3.8-pro',
    QUESTION_PAPER_PRICE_INPUT_USD_PER_MTOK: '1.5',
    QUESTION_PAPER_PRICE_OUTPUT_USD_PER_MTOK: '6',
    QUESTION_PAPER_PRICE_CACHE_READ_USD_PER_MTOK: '0.15',
    QUESTION_PAPER_PRICE_CACHE_WRITE_USD_PER_MTOK: '0',
  };

  it('falls back to the assistant provider, model and prices', () => {
    expect(readQuestionPaperSettings(GEMINI, 'gemini')).toEqual(readProviderSettings(GEMINI, 'gemini'));
    expect(readQuestionPaperSettings({}, 'gemini')).toBeNull();
  });

  it('uses the question paper model with its own prices and the provider key', () => {
    expect(readQuestionPaperSettings({ GEMINI_API_KEY: 'key', ...OVERRIDE }, 'gemini')).toEqual({
      id: 'gemini',
      apiKey: 'key',
      model: 'gemini-3.8-pro',
      prices: { inputUsdPerMtok: '1.5', outputUsdPerMtok: '6', cacheReadUsdPerMtok: '0.15', cacheWriteUsdPerMtok: '0' },
    });
  });

  it('never gives a model another model\'s prices, nor a missing key', () => {
    const { QUESTION_PAPER_PRICE_OUTPUT_USD_PER_MTOK: _output, ...partial } = OVERRIDE;
    expect(readQuestionPaperSettings({ ...GEMINI, ...partial }, 'gemini')).toBeNull();
    expect(readQuestionPaperSettings(OVERRIDE, 'gemini')).toBeNull();
  });

  it('takes the provider from QUESTION_PAPER_PROVIDER', () => {
    const anthropic = Object.fromEntries(Object.entries(GEMINI).map(([key, value]) => [key.replace('GEMINI', 'ANTHROPIC'), value]));
    expect(readQuestionPaperSettings({ ...GEMINI, ...anthropic, QUESTION_PAPER_PROVIDER: 'anthropic' }, 'gemini')?.id).toBe('anthropic');
  });
});
