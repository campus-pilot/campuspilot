import { appendFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { monitorEventLoopDelay } from 'node:perf_hooks';

import type { Context } from '@campuspilot/api/context';
import { voiceServerMessageSchema } from '@campuspilot/assistant-contract/voice';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';

import { loadAssistantAccess, type AssistantAccessDecision } from '../access';
import { resolveAssistantSession } from '../session';
import { voiceSettings, type VoiceSettings } from './config';
import type { VoiceConnectInput } from './provider';
import { attachAssistantVoice } from './server';

/**
 * Many voice sessions at once through the real endpoint, each with its own
 * user, as when many schools talk at the same time. The voice model is
 * scripted to behave like the live one at its busiest: every session sends
 * microphone audio (25 frames a second) while the model speaks back (10
 * frames a second), for the whole run.
 *
 * It answers three questions about one API process:
 * - does every session start, and stay up;
 * - does audio get through both ways without loss or delay;
 * - does one session's traffic hold up the others (event-loop delay).
 *
 * The clients run in this same process, so the numbers are a lower bound of
 * what the server alone can carry. `VOICE_SCALE_SESSIONS` and
 * `VOICE_SCALE_SECONDS` size a bigger run by hand; the default is small enough
 * for every test run and still fails if the relay starts dropping or stalling.
 */
vi.mock('../session', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../session')>()),
  resolveAssistantSession: vi.fn(),
}));
vi.mock('../access', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../access')>()),
  loadAssistantAccess: vi.fn(),
}));
vi.mock('./config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./config')>()),
  voiceSettings: vi.fn(),
}));

const SESSIONS = Number(process.env.VOICE_SCALE_SESSIONS ?? 150);
const SECONDS = Number(process.env.VOICE_SCALE_SECONDS ?? 4);
/** How many sessions start in the same instant. */
const ARRIVING_TOGETHER = 50;

const ORIGIN = 'http://management.invalid';
/** 40 ms of microphone audio (16 kHz, 16-bit). */
const MIC_FRAME_BYTES = 1280;
const MIC_FRAME_MS = 40;
/** 100 ms of the assistant's voice (24 kHz, 16-bit); its first 8 bytes carry when it was sent. */
const VOICE_FRAME_BYTES = 4800;
const VOICE_FRAME_MS = 100;

const SETTINGS: VoiceSettings = {
  apiKey: 'test-key',
  model: 'voice-test-model',
  voiceName: null,
  prices: { textInputUsdPerMtok: '0.75', audioInputUsdPerMtok: '3', textOutputUsdPerMtok: '4.5', audioOutputUsdPerMtok: '12' },
  maxSessionMs: 10 * 60_000,
  idleMs: 5 * 60_000,
  maxSessions: 5_000,
};

const ALLOWED: AssistantAccessDecision = {
  featureEnabled: true,
  member: true,
  allowedRoles: ['teacher'],
  suspended: false,
  limit: { known: true, monthlyLimitUsd: null },
  limitReached: false,
  voiceEnabled: true,
  allowed: true,
  refusal: null,
};

/** The scripted voice model's side of every session. */
const model = { audioIn: 0, audioOut: 0, quiet: false, speaking: [] as Array<ReturnType<typeof setInterval>> };

let server: Server;
let url: string;
let voice: { close: () => void };

beforeAll(async () => {
  vi.mocked(voiceSettings).mockReturnValue(SETTINGS);
  vi.mocked(loadAssistantAccess).mockResolvedValue(ALLOWED);
  // Each socket is its own user (the cookie names them), as each school's staff are.
  vi.mocked(resolveAssistantSession).mockImplementation(async (headers) => {
    const userId = /user=([^;]+)/.exec(headers.get('cookie') ?? '')?.[1] ?? 'nobody';
    return {
      user: { id: userId, name: 'Asha Rao', email: `${userId}@school.test`, impersonatedBy: null },
      context: { session: { user: { id: userId } } } as unknown as Context,
    };
  });
  server = createServer((_request, response) => response.writeHead(404).end());
  voice = attachAssistantVoice(server, {
    createProvider: (settings) => ({
      id: 'gemini',
      model: settings.model,
      connect: async (input: VoiceConnectInput) => {
        // The model speaks for the whole session: a frame every 100 ms, stamped with when it left.
        const speaking = setInterval(() => {
          if (model.quiet) return;
          const pcm = Buffer.alloc(VOICE_FRAME_BYTES);
          pcm.writeDoubleLE(performance.now(), 0);
          model.audioOut += 1;
          input.onEvent({ type: 'audio', pcm });
        }, VOICE_FRAME_MS);
        model.speaking.push(speaking);
        return {
          sendAudio: () => {
            model.audioIn += 1;
          },
          endAudio: () => undefined,
          sendToolResult: () => undefined,
          sendNote: () => undefined,
          close: () => clearInterval(speaking),
        };
      },
    }),
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  url = `ws://127.0.0.1:${(server.address() as AddressInfo).port}/model/voice`;
});

afterAll(async () => {
  for (const speaking of model.speaking) clearInterval(speaking);
  voice.close();
  await new Promise((resolve) => server.close(resolve));
});

const percentile = (sorted: readonly number[], share: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * share))] ?? 0;

describe('the voice endpoint under many sessions', () => {
  it(`carries ${SESSIONS} sessions talking at once for ${SECONDS} s, without loss, delay or a session ending`, async () => {
    const delays: number[] = [];
    let voiceFrames = 0;
    let ended = 0;
    const startedAt = performance.now();

    const open = (index: number) => {
        const socket = new WebSocket(`${url}?schoolId=sch_${index % 50}&kind=overlay`, { headers: { origin: ORIGIN, cookie: `user=usr_scale_${index}` } });
        return new Promise<WebSocket>((resolve, reject) => {
          socket.on('error', reject);
          socket.on('unexpected-response', (_request, response) => reject(new Error(`refused with ${response.statusCode}`)));
          socket.on('message', (data, isBinary) => {
            if (isBinary) {
              voiceFrames += 1;
              delays.push(performance.now() - (data as Buffer).readDoubleLE(0));
              return;
            }
            const message = voiceServerMessageSchema.parse(JSON.parse(data.toString()));
            if (message.type === 'ready') resolve(socket);
            if (message.type === 'ended') ended += 1;
          });
        });
    };
    // People arrive a few at a time, not in one instant: the operating system queues only so many new connections at once.
    const sockets: WebSocket[] = [];
    for (let index = 0; index < SESSIONS; index += ARRIVING_TOGETHER) {
      sockets.push(...(await Promise.all(Array.from({ length: Math.min(ARRIVING_TOGETHER, SESSIONS - index) }, (_, offset) => open(index + offset)))));
    }
    const admitMs = performance.now() - startedAt;

    // Count from the moment everyone is in: what arrived while the last sessions were still starting is not the steady state.
    delays.length = 0;
    voiceFrames = 0;
    model.audioIn = 0;
    model.audioOut = 0;
    const loop = monitorEventLoopDelay({ resolution: 10 });
    loop.enable();
    const memoryBefore = process.memoryUsage().rss;
    const mic = Buffer.alloc(MIC_FRAME_BYTES);
    let micFrames = 0;
    const talking = setInterval(() => {
      for (const socket of sockets) {
        socket.send(mic, { binary: true });
        micFrames += 1;
      }
    }, MIC_FRAME_MS);
    await new Promise((resolve) => setTimeout(resolve, SECONDS * 1000));
    clearInterval(talking);
    model.quiet = true;
    // Let what is on its way arrive.
    await new Promise((resolve) => setTimeout(resolve, 300));
    loop.disable();

    delays.sort((a, b) => a - b);
    const report = {
      sessions: SESSIONS,
      seconds: SECONDS,
      admitMs: Math.round(admitMs),
      micFramesSent: micFrames,
      micFramesAtModel: model.audioIn,
      voiceFramesFromModel: model.audioOut,
      voiceFramesAtBrowsers: voiceFrames,
      voiceDelayMs: { p50: Math.round(percentile(delays, 0.5)), p99: Math.round(percentile(delays, 0.99)), max: Math.round(delays[delays.length - 1] ?? 0) },
      eventLoopDelayMs: { p50: Math.round(loop.percentile(50) / 1e6), p99: Math.round(loop.percentile(99) / 1e6), max: Math.round(loop.max / 1e6) },
      rssGrowthMb: Math.round((process.memoryUsage().rss - memoryBefore) / 1024 / 1024),
      sessionsEnded: ended,
    };
    console.info('voice scale', JSON.stringify(report));
    if (process.env.VOICE_SCALE_REPORT) appendFileSync(process.env.VOICE_SCALE_REPORT, `${JSON.stringify(report)}\n`);

    // Every microphone frame reached the model: the relay never drops what the user says.
    expect(model.audioIn).toBe(micFrames);
    // Every frame of the assistant's voice reached its browser, in time to play without gaps (a frame is 100 ms long).
    expect(voiceFrames).toBe(model.audioOut);
    expect(voiceFrames).toBeGreaterThan(0);
    expect(report.voiceDelayMs.p99).toBeLessThan(200);
    expect(ended).toBe(0);

    await Promise.all(
      sockets.map(
        (socket) =>
          new Promise<void>((resolve) => {
            socket.on('close', () => resolve());
            socket.send(JSON.stringify({ type: 'end' }));
          }),
      ),
    );
  }, 120_000);
});
