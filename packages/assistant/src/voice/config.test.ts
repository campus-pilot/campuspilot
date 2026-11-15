import { describe, expect, it } from 'vitest';

import { readVoiceSettings } from './config';

const VOICE = {
  GEMINI_API_KEY: 'key',
  GEMINI_LIVE_MODEL: 'gemini-3.8-live',
  GEMINI_LIVE_PRICE_TEXT_INPUT_USD_PER_MTOK: '0.75',
  GEMINI_LIVE_PRICE_AUDIO_INPUT_USD_PER_MTOK: '3.00',
  GEMINI_LIVE_PRICE_TEXT_OUTPUT_USD_PER_MTOK: '4.50',
  GEMINI_LIVE_PRICE_AUDIO_OUTPUT_USD_PER_MTOK: '12.00',
};

describe('readVoiceSettings', () => {
  it('reads the model, the four prices as written, and the limits with their defaults', () => {
    expect(readVoiceSettings(VOICE)).toEqual({
      apiKey: 'key',
      model: 'gemini-3.8-live',
      voiceName: null,
      prices: { textInputUsdPerMtok: '0.75', audioInputUsdPerMtok: '3.00', textOutputUsdPerMtok: '4.50', audioOutputUsdPerMtok: '12.00' },
      maxSessionMs: 20 * 60_000,
      idleMs: 180_000,
    });
    expect(readVoiceSettings({ ...VOICE, GEMINI_LIVE_VOICE: 'Kore', ASSISTANT_VOICE_MAX_SESSION_MINUTES: 5, ASSISTANT_VOICE_IDLE_SECONDS: 60 })).toMatchObject({
      voiceName: 'Kore',
      maxSessionMs: 5 * 60_000,
      idleMs: 60_000,
    });
  });

  it('is not configured without the model, any one price, or the key: a price is never filled in', () => {
    expect(readVoiceSettings({})).toBeNull();
    for (const name of Object.keys(VOICE)) {
      expect(readVoiceSettings({ ...VOICE, [name]: undefined }), name).toBeNull();
      expect(readVoiceSettings({ ...VOICE, [name]: '' }), name).toBeNull();
    }
  });
});
