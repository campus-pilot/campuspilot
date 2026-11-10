import { describe, expect, it } from 'vitest';

import { readProviderSettings } from './config';

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
