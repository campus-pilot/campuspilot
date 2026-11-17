import { env, isAssistantVoiceConfigured } from '@campuspilot/env/assistant';

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
  /** The most sessions this process carries at once; a new one beyond it is refused. */
  maxSessions: number;
};

/**
 * The voice settings from an environment, or null when voice is not
 * configured ({@link isAssistantVoiceConfigured}: its model, all four prices
 * and the Gemini key). The env schema already refuses some without the rest,
 * and this never fills a missing price with a default.
 */
export function readVoiceSettings(source: Readonly<Record<string, string | number | undefined>>): VoiceSettings | null {
  if (!isAssistantVoiceConfigured(source)) return null;
  // Every name below is a non-empty string once the check above passed.
  const required = (name: string) => source[name] as string;
  const voiceName = source.GEMINI_LIVE_VOICE;
  return {
    apiKey: required('GEMINI_API_KEY'),
    model: required('GEMINI_LIVE_MODEL'),
    voiceName: typeof voiceName === 'string' && voiceName.length > 0 ? voiceName : null,
    prices: {
      textInputUsdPerMtok: required('GEMINI_LIVE_PRICE_TEXT_INPUT_USD_PER_MTOK'),
      audioInputUsdPerMtok: required('GEMINI_LIVE_PRICE_AUDIO_INPUT_USD_PER_MTOK'),
      textOutputUsdPerMtok: required('GEMINI_LIVE_PRICE_TEXT_OUTPUT_USD_PER_MTOK'),
      audioOutputUsdPerMtok: required('GEMINI_LIVE_PRICE_AUDIO_OUTPUT_USD_PER_MTOK'),
    },
    maxSessionMs: Number(source.ASSISTANT_VOICE_MAX_SESSION_MINUTES ?? 20) * 60_000,
    idleMs: Number(source.ASSISTANT_VOICE_IDLE_SECONDS ?? 180) * 1_000,
    maxSessions: Number(source.ASSISTANT_VOICE_MAX_SESSIONS ?? 500),
  };
}

/** The voice settings of this deployment, or null when voice is not configured. */
export function voiceSettings(): VoiceSettings | null {
  return readVoiceSettings(env as unknown as Readonly<Record<string, string | number | undefined>>);
}
