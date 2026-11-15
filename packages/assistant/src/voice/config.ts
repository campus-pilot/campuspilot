import { env } from '@campuspilot/env/assistant';

/**
 * The voice model's prices in USD per million tokens, as decimal text exactly
 * as configured. Text and audio tokens are billed differently, in and out.
 * They are copied onto the cost rows and multiplied in Postgres `numeric`
 * (`recordVoiceUsage`), so no float ever touches money.
 */
export type VoicePrices = {
  textInputUsdPerMtok: string;
  audioInputUsdPerMtok: string;
  textOutputUsdPerMtok: string;
  audioOutputUsdPerMtok: string;
};

/** Everything a voice session needs from the deployment. */
export type VoiceSettings = {
  apiKey: string;
  model: string;
  /** The prebuilt voice to speak with; null leaves the model's default. */
  voiceName: string | null;
  prices: VoicePrices;
  /** The longest one session may last. */
  maxSessionMs: number;
  /** How long a session may stay silent, with nothing running, before it ends. */
  idleMs: number;
};

/**
 * The voice settings from an environment, or null when voice is not
 * configured. Voice is configured only when its model, all four prices and
 * the Gemini key are set; the env schema already refuses some without the
 * rest, and this never fills a missing price with a default.
 */
export function readVoiceSettings(source: Readonly<Record<string, string | number | undefined>>): VoiceSettings | null {
  const text = (name: string) => {
    const value = source[name];
    return typeof value === 'string' && value.length > 0 ? value : null;
  };
  const apiKey = text('GEMINI_API_KEY');
  const model = text('GEMINI_LIVE_MODEL');
  const textInputUsdPerMtok = text('GEMINI_LIVE_PRICE_TEXT_INPUT_USD_PER_MTOK');
  const audioInputUsdPerMtok = text('GEMINI_LIVE_PRICE_AUDIO_INPUT_USD_PER_MTOK');
  const textOutputUsdPerMtok = text('GEMINI_LIVE_PRICE_TEXT_OUTPUT_USD_PER_MTOK');
  const audioOutputUsdPerMtok = text('GEMINI_LIVE_PRICE_AUDIO_OUTPUT_USD_PER_MTOK');
  if (!apiKey || !model || !textInputUsdPerMtok || !audioInputUsdPerMtok || !textOutputUsdPerMtok || !audioOutputUsdPerMtok) {
    return null;
  }
  return {
    apiKey,
    model,
    voiceName: text('GEMINI_LIVE_VOICE'),
    prices: { textInputUsdPerMtok, audioInputUsdPerMtok, textOutputUsdPerMtok, audioOutputUsdPerMtok },
    maxSessionMs: Number(source.ASSISTANT_VOICE_MAX_SESSION_MINUTES ?? 20) * 60_000,
    idleMs: Number(source.ASSISTANT_VOICE_IDLE_SECONDS ?? 180) * 1_000,
  };
}

/** The voice settings of this deployment, or null when voice is not configured. */
export function voiceSettings(): VoiceSettings | null {
  return readVoiceSettings(env as unknown as Readonly<Record<string, string | number | undefined>>);
}
