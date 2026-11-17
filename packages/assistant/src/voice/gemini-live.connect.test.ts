import type { LiveCallbacks } from '@google/genai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { VoiceSettings } from './config';
import { createGeminiLiveProvider, VOICE_CONNECT_TIMEOUT_MS } from './gemini-live';
import type { VoiceEvent } from './provider';

/**
 * Connecting to the voice model, with the SDK's client replaced by one whose
 * socket the test drives: `live.connect` waits for a setup that the test
 * completes, or never does, exactly as the real SDK waits (it has no failure
 * path of its own).
 */
const live = vi.hoisted(() => ({
  attempts: [] as Array<{ callbacks: { onclose?: ((event: never) => void) | null }; ready: (session: unknown) => void }>,
  clientOptions: [] as unknown[],
}));

vi.mock('@google/genai', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@google/genai')>()),
  GoogleGenAI: class {
    constructor(options: unknown) {
      live.clientOptions.push(options);
    }
    live = {
      connect: (params: { callbacks: LiveCallbacks }) =>
        new Promise((resolve) => {
          live.attempts.push({ callbacks: params.callbacks, ready: resolve });
        }),
    };
  },
}));

const SETTINGS: VoiceSettings = {
  apiKey: 'test-key',
  model: 'voice-test-model',
  voiceName: null,
  prices: { textInputUsdPerMtok: '0.75', audioInputUsdPerMtok: '3', textOutputUsdPerMtok: '4.5', audioOutputUsdPerMtok: '12' },
  maxSessionMs: 60_000,
  idleMs: 60_000,
  maxSessions: 10,
};

const connect = (events: VoiceEvent[] = []) =>
  createGeminiLiveProvider(SETTINGS).connect({ instructions: 'instructions', tools: [], resumeHandle: null, onEvent: (event) => events.push(event) });

beforeEach(() => {
  vi.useFakeTimers();
  live.attempts.length = 0;
});
afterEach(() => {
  vi.useRealTimers();
});

describe('connecting to the voice model', () => {
  it('creates its client on v1beta, the only Gemini API version that serves the Live API', () => {
    createGeminiLiveProvider(SETTINGS);
    expect(live.clientOptions.at(-1)).toEqual({ apiKey: 'test-key', apiVersion: 'v1beta' });
  });

  it('fails when the socket closes before the model is ready, instead of waiting for ever', async () => {
    const events: VoiceEvent[] = [];
    const connecting = connect(events);
    // A model name the key may not use: the socket opens and is closed with a reason, and setup never completes.
    live.attempts[0]!.callbacks.onclose?.({ code: 1008, reason: 'model not found' } as never);
    await expect(connecting).rejects.toThrow('before it was ready: 1008 model not found');
    // A failed connect is the caller's to handle; it is not also reported as a session that dropped.
    expect(events).toEqual([]);
  });

  it('gives up on a model that never becomes ready, and closes the connection if it turns up later', async () => {
    const connecting = connect();
    const outcome = connecting.then(
      () => 'connected',
      (error: Error) => error.message,
    );
    await vi.advanceTimersByTimeAsync(VOICE_CONNECT_TIMEOUT_MS);
    expect(await outcome).toBe('The voice model was not ready within 15 s.');
    const late = { close: vi.fn() };
    live.attempts[0]!.ready(late);
    await vi.advanceTimersByTimeAsync(0);
    expect(late.close).toHaveBeenCalledOnce();
  });

  it('reports a close after the model was ready as the session dropping', async () => {
    const events: VoiceEvent[] = [];
    const connecting = connect(events);
    const session = { close: vi.fn() };
    live.attempts[0]!.ready(session);
    const connection = await connecting;
    live.attempts[0]!.callbacks.onclose?.({ code: 1011, reason: 'internal error' } as never);
    expect(events).toEqual([{ type: 'closed', expected: false, detail: '1011 internal error' }]);
    // Already closed: closing again does nothing.
    connection.close();
    expect(session.close).not.toHaveBeenCalled();
    // The time limit ended with the connect: nothing fires later.
    await vi.advanceTimersByTimeAsync(VOICE_CONNECT_TIMEOUT_MS);
    expect(events).toHaveLength(1);
  });
});
