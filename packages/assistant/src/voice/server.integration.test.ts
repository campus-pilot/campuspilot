import { createServer, type Server } from 'node:http';
import { connect as connectTcp, type AddressInfo, type Socket } from 'node:net';

import type { Context } from '@campuspilot/api/context';
import { ASSISTANT_PAGE_TEXT_MAX } from '@campuspilot/assistant-contract/dto';
import { VOICE_MAX_INPUT_FRAME_BYTES, voiceServerMessageSchema, type VoiceClientMessage, type VoiceServerMessage } from '@campuspilot/assistant-contract/voice';
import { assistantModelRequestTable } from '@campuspilot/db/schema/assistant';
import { call } from '@orpc/server';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';

import { loadAssistantAccess, type AssistantAccessDecision } from '../access';
import { db } from '../db';
import { assistantRouter } from '../router';
import { resolveAssistantSession, type AssistantSession } from '../session';
import * as store from '../store';
import { seedTurn } from '../testing/turn';
import { voiceSettings, type VoiceSettings } from './config';
import type { VoiceConnectInput, VoiceEvent } from './provider';
import { attachAssistantVoice } from './server';

/**
 * The voice endpoint over a real socket, against the real store, Postgres and
 * Redis. Replaced: who the session cookie belongs to, the API's access
 * decision (both tested where they live), the deployment's voice settings,
 * and the voice model, which is scripted.
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

const ORIGIN = 'http://management.invalid';

const SETTINGS: VoiceSettings = {
  apiKey: 'test-key',
  model: 'voice-test-model',
  voiceName: null,
  prices: { textInputUsdPerMtok: '0.75', audioInputUsdPerMtok: '3', textOutputUsdPerMtok: '4.5', audioOutputUsdPerMtok: '12' },
  maxSessionMs: 10 * 60_000,
  idleMs: 5 * 60_000,
  maxSessions: 500,
};

const ALLOWED: AssistantAccessDecision = {
  featureEnabled: true,
  member: true,
  allowedRoles: ['teacher'],
  suspended: false,
  noPlan: false,
  limit: { known: true, monthlyLimitUsd: null },
  limitReached: false,
  windowSpend: null,
  voiceEnabled: true,
  allowed: true,
  refusal: null,
};

const sessionOf = (userId: string, impersonatedBy: string | null = null): AssistantSession => ({
  user: { id: userId, name: 'Asha Rao', email: 'asha@school.test', impersonatedBy },
  context: { session: { user: { id: userId } } } as unknown as Context,
});

/** The scripted voice model: every connection the endpoint opened, and what it was sent. */
const model = { connections: [] as Array<{ input: VoiceConnectInput; sent: unknown[][]; closed: boolean }>, unreachable: false, broken: false };
const lastConnection = () => model.connections[model.connections.length - 1]!;
const say = (event: VoiceEvent) => lastConnection().input.onEvent(event);

let server: Server;
let url: string;
let voice: { close: () => void };

beforeAll(async () => {
  server = createServer((_request, response) => response.writeHead(404).end());
  voice = attachAssistantVoice(server, {
    createProvider: (settings) => {
      if (model.broken) throw new Error('the voice provider could not be built');
      return {
      id: 'gemini' as const,
      model: settings.model,
      connect: async (input: VoiceConnectInput) => {
        if (model.unreachable) throw new Error('the voice model cannot be reached');
        const connection = { input, sent: [] as unknown[][], closed: false };
        model.connections.push(connection);
        return {
          sendAudio: (pcm) => connection.sent.push(['audio', pcm.byteLength]),
          endAudio: () => connection.sent.push(['endAudio']),
          sendToolResult: (result) => connection.sent.push(['result', result]),
          sendNote: (text) => connection.sent.push(['note', text]),
          close: () => {
            connection.closed = true;
          },
        };
      },
      };
    },
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  url = `ws://127.0.0.1:${(server.address() as AddressInfo).port}/model/voice`;
});

afterAll(async () => {
  voice.close();
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
  model.connections.length = 0;
  model.unreachable = false;
  model.broken = false;
  vi.mocked(voiceSettings).mockReturnValue(SETTINGS);
  vi.mocked(loadAssistantAccess).mockResolvedValue(ALLOWED);
  vi.mocked(resolveAssistantSession).mockResolvedValue(sessionOf('usr_voice_default'));
});

/** The HTTP status an upgrade request is refused with. */
function refusalOf(target: string, headers: Record<string, string>): Promise<number> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(target, { headers });
    socket.on('unexpected-response', (_request, response) => resolve(response.statusCode ?? 0));
    socket.on('open', () => {
      socket.close();
      reject(new Error('the upgrade was accepted'));
    });
    socket.on('error', () => undefined);
  });
}

/**
 * Runs `work` and returns every error that nobody handled while it ran. In
 * production such an error ends the API process, and with it every school's
 * requests; the test runner would only note it beside a passing test, so the
 * tests that guard against it look for it themselves.
 */
async function unhandledDuring(work: () => Promise<void>): Promise<unknown[]> {
  const unhandled: unknown[] = [];
  const existing = process.listeners('uncaughtException');
  const collect = (error: unknown) => unhandled.push(error);
  process.removeAllListeners('uncaughtException');
  process.on('uncaughtException', collect);
  try {
    await work();
  } finally {
    process.off('uncaughtException', collect);
    for (const listener of existing) process.on('uncaughtException', listener);
  }
  return unhandled;
}

/** Sends one raw upgrade request for `target`, as a client that is not a browser can, and hands over its connection. */
function rawUpgrade(target: string): Promise<Socket> {
  const { port } = server.address() as AddressInfo;
  return new Promise((resolve, reject) => {
    const raw = connectTcp(port, '127.0.0.1', () => {
      raw.write(
        `GET ${target} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\nOrigin: ${ORIGIN}\r\nCookie: session=test\r\n\r\n`,
        () => resolve(raw),
      );
    });
    raw.on('error', reject);
  });
}

/** An open voice session as the browser sees it. */
async function connect(schoolId: string) {
  const socket = new WebSocket(`${url}?schoolId=${schoolId}&kind=overlay`, { headers: { origin: ORIGIN, cookie: 'session=test' } });
  const messages: VoiceServerMessage[] = [];
  const audio: number[] = [];
  const waiters: Array<() => void> = [];
  socket.on('message', (data, isBinary) => {
    if (isBinary) audio.push((data as Buffer).byteLength);
    else messages.push(voiceServerMessageSchema.parse(JSON.parse(data.toString())));
    for (const wake of waiters.splice(0)) wake();
  });
  const closed = new Promise<void>((resolve) => socket.on('close', () => resolve()));
  /** Resolves with the first message of `type`, once it has arrived. */
  const next = async <T extends VoiceServerMessage['type']>(type: T): Promise<Extract<VoiceServerMessage, { type: T }>> => {
    for (;;) {
      const found = messages.find((message) => message.type === type);
      if (found) return found as Extract<VoiceServerMessage, { type: T }>;
      await new Promise<void>((resolve) => waiters.push(resolve));
    }
  };
  await next('ready');
  return { socket, messages, audio, closed, next, send: (message: VoiceClientMessage) => socket.send(JSON.stringify(message)) };
}

/** Waits until `read` returns something. */
async function eventually<T>(read: () => T | undefined | null | false | Promise<T | undefined | null | false>): Promise<T> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const value = await read();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('nothing arrived in time');
}

describe('the voice endpoint', () => {
  it('refuses an upgrade before any socket exists: another site, no session, no access, no voice', async () => {
    const target = `${url}?schoolId=sch_any&kind=overlay`;
    const cookie = 'session=test';
    // A WebSocket handshake carries the user's cookie from any site and is not subject to CORS.
    expect(await refusalOf(target, { origin: 'http://evil.invalid', cookie })).toBe(403);
    expect(await refusalOf(target, { cookie })).toBe(403);
    expect(await refusalOf(url, { origin: ORIGIN, cookie })).toBe(400);

    vi.mocked(resolveAssistantSession).mockResolvedValueOnce(null);
    expect(await refusalOf(target, { origin: ORIGIN })).toBe(401);

    vi.mocked(loadAssistantAccess).mockResolvedValueOnce({ ...ALLOWED, voiceEnabled: false });
    expect(await refusalOf(target, { origin: ORIGIN, cookie })).toBe(403);

    vi.mocked(loadAssistantAccess).mockResolvedValueOnce({ ...ALLOWED, limitReached: true, allowed: false, refusal: { code: 'limit_reached', message: 'At the limit.' } });
    expect(await refusalOf(target, { origin: ORIGIN, cookie })).toBe(403);

    vi.mocked(resolveAssistantSession).mockResolvedValueOnce(sessionOf('usr_voice_default', 'adm_1'));
    expect(await refusalOf(target, { origin: ORIGIN, cookie })).toBe(403);

    vi.mocked(voiceSettings).mockReturnValue(null);
    expect(await refusalOf(target, { origin: ORIGIN, cookie })).toBe(404);
    expect(model.connections).toHaveLength(0);
  });

  it('closes an upgrade for any other path', async () => {
    await expect(
      new Promise((resolve, reject) => {
        const socket = new WebSocket(url.replace('/model/voice', '/model/rpc/getStatus'), { headers: { origin: ORIGIN } });
        socket.on('open', () => resolve('open'));
        socket.on('error', reject);
      }),
    ).rejects.toThrow();
  });

  it('relays audio both ways and shows what was heard and said', async () => {
    const browser = await connect('sch_relay');
    expect(lastConnection().input.resumeHandle).toBeNull();
    expect(lastConnection().input.instructions).toContain('Asha');
    expect(lastConnection().input.tools.map((tool) => tool.name)).toEqual(['ask_assistant', 'open_page', 'open_on_screen', 'read_screen']);

    browser.socket.send(new Uint8Array(1280), { binary: true });
    // Not audio: an odd number of bytes, and a text frame that is not a known message.
    browser.socket.send(new Uint8Array(3), { binary: true });
    browser.socket.send('{"type":"approve","approvalId":"x"}');
    await eventually(() => lastConnection().sent.length > 0);
    expect(lastConnection().sent).toEqual([['audio', 1280]]);

    say({ type: 'user_speaking', speaking: true });
    say({ type: 'heard', text: 'Class 8-B ki report', finished: false });
    say({ type: 'user_speaking', speaking: false });
    say({ type: 'audio', pcm: new Uint8Array(960) });
    say({ type: 'said', text: 'Sure, one moment.' });
    say({ type: 'usage', usage: { textInputTokens: 10, audioInputTokens: 20, textOutputTokens: 0, audioOutputTokens: 30 } });
    say({ type: 'reply_done' });
    await browser.next('reply_done');
    expect(browser.messages.slice(1)).toEqual([
      { type: 'user_speaking', speaking: true },
      { type: 'heard', text: 'Class 8-B ki report', final: false },
      { type: 'user_speaking', speaking: false },
      { type: 'heard', text: 'Class 8-B ki report', final: true },
      { type: 'said', text: 'Sure, one moment.' },
      { type: 'reply_done' },
    ]);
    expect(browser.audio).toEqual([960]);

    browser.send({ type: 'end' });
    await browser.closed;
    expect(lastConnection().closed).toBe(true);
  });

  it('follows the user’s own run to its outcome, and saves what the voice model cost', async () => {
    const turn = await seedTurn({ text: 'How many students are in class 1?' });
    vi.mocked(resolveAssistantSession).mockResolvedValue(sessionOf(turn.userId));
    const browser = await connect(turn.schoolId);

    say({ type: 'user_speaking', speaking: true });
    say({ type: 'tool_calls', calls: [{ id: 'call1', name: 'ask_assistant', args: { request: 'How many students are in class 1?' } }] });
    const ask = await browser.next('ask');
    expect(ask.request).toBe('How many students are in class 1?');
    browser.send({ type: 'turn', askId: ask.askId, conversationId: turn.conversationId, runId: turn.runId });

    // The run answers and completes, as the worker would make it.
    await store.assistantTransaction(db, async (tx, emit) => {
      await store.insertItem(tx, emit, {
        conversationId: turn.conversationId,
        runId: turn.runId,
        kind: 'assistant_message',
        status: 'complete',
        body: { text: 'There are 11 students in Class 1.' },
        itemKey: `${turn.runId}:answer`,
      });
      await store.updateRun(tx, emit, { id: turn.runId, conversationId: turn.conversationId }, { status: 'completed', completedAt: new Date() });
    });

    await browser.next('ask_done');
    expect(lastConnection().sent).toEqual([
      ['result', { id: 'call1', name: 'ask_assistant', output: { status: 'done', answer: 'There are 11 students in Class 1.' }, delivery: 'when_idle', final: true }],
    ]);

    say({ type: 'usage', usage: { textInputTokens: 400, audioInputTokens: 300, textOutputTokens: 20, audioOutputTokens: 90 } });
    const rows = await eventually(async () => {
      const found = await db.select().from(assistantModelRequestTable).where(eq(assistantModelRequestTable.schoolId, turn.schoolId));
      return found.length === 2 && found;
    });
    expect(rows.map((row) => [row.source, row.userId, row.requestedModel]).sort()).toEqual([
      ['voice', turn.userId, 'voice-test-model'],
      ['voice', turn.userId, 'voice-test-model'],
    ]);
    expect(new Set(rows.map((row) => row.voiceSessionId)).size).toBe(1);
    browser.send({ type: 'end' });
    await browser.closed;
  });

  it('never follows someone else’s run: the voice model is told the request failed', async () => {
    const theirs = await seedTurn();
    vi.mocked(resolveAssistantSession).mockResolvedValue(sessionOf('usr_someone_else'));
    const browser = await connect(theirs.schoolId);
    say({ type: 'user_speaking', speaking: true });
    say({ type: 'tool_calls', calls: [{ id: 'call1', name: 'ask_assistant', args: { request: 'Show their conversation' } }] });
    const ask = await browser.next('ask');
    browser.send({ type: 'turn', askId: ask.askId, conversationId: theirs.conversationId, runId: theirs.runId });
    await browser.next('ask_done');
    const [kind, result] = lastConnection().sent[0]!;
    expect(kind).toBe('result');
    expect((result as { output: { status: string } }).output.status).toBe('failed');
    browser.send({ type: 'end' });
    await browser.closed;
  });

  it('keeps one session per user: starting another ends the first', async () => {
    vi.mocked(resolveAssistantSession).mockResolvedValue(sessionOf('usr_two_tabs'));
    const first = await connect('sch_tabs');
    const second = await connect('sch_tabs');
    expect(await first.next('ended')).toEqual({ type: 'ended', reason: 'replaced', message: 'Voice continued in another window.' });
    await first.closed;
    expect(model.connections[0]!.closed).toBe(true);
    expect(model.connections[1]!.closed).toBe(false);
    second.send({ type: 'end' });
    await second.closed;
  });

  it('survives a browser that drops the connection in the middle of the handshake', async () => {
    // The session lookup takes a moment; the client resets the connection while the server is still deciding.
    vi.mocked(resolveAssistantSession).mockImplementationOnce(async () => {
      await new Promise((resolve) => setTimeout(resolve, 150));
      return sessionOf('usr_dropped');
    });
    const unhandled = await unhandledDuring(async () => {
      const raw = await rawUpgrade('/model/voice?schoolId=sch_drop&kind=overlay');
      raw.on('error', () => undefined);
      raw.resetAndDestroy();
      // Long enough for the lookup to finish and the server to answer a socket that is gone.
      await new Promise((resolve) => setTimeout(resolve, 400));
    });
    expect(unhandled).toEqual([]);
    // The server is still serving: a new session starts normally.
    vi.mocked(resolveAssistantSession).mockResolvedValue(sessionOf('usr_after_drop'));
    const browser = await connect('sch_drop');
    browser.send({ type: 'end' });
    await browser.closed;
  });

  it('closes a request whose address is not an address, and keeps serving', async () => {
    const unhandled = await unhandledDuring(async () => {
      const raw = await rawUpgrade('//');
      await new Promise<void>((resolve) => {
        raw.on('close', () => resolve());
        raw.on('error', () => resolve());
      });
    });
    expect(unhandled).toEqual([]);
    const browser = await connect('sch_address');
    browser.send({ type: 'end' });
    await browser.closed;
  });

  it('takes a description of a whole page in any script, and no microphone frame longer than a second', async () => {
    const browser = await connect('sch_frames');
    say({ type: 'tool_calls', calls: [{ id: 'call_read', name: 'read_screen', args: {} }] });
    const asked = await browser.next('read_screen');
    if (asked.type !== 'read_screen') throw new Error('unreachable');
    // The longest page text the app sends, in Devanagari: three bytes a character, far more than a frame of audio.
    const text = 'क'.repeat(ASSISTANT_PAGE_TEXT_MAX);
    browser.send({ type: 'screen', readId: asked.readId, title: 'Admissions', text });
    await eventually(() => lastConnection().sent.some(([kind]) => kind === 'result'));
    expect(lastConnection().sent.find(([kind]) => kind === 'result')?.[1]).toMatchObject({ output: { page_text: text } });

    browser.socket.send(new Uint8Array(VOICE_MAX_INPUT_FRAME_BYTES + 2), { binary: true });
    browser.socket.send(new Uint8Array(1280), { binary: true });
    await eventually(() => lastConnection().sent.some(([kind]) => kind === 'audio'));
    expect(lastConnection().sent.filter(([kind]) => kind === 'audio')).toEqual([['audio', 1280]]);
    browser.send({ type: 'end' });
    await browser.closed;
  });

  it('gives a session in the chat only what it can do there', async () => {
    vi.mocked(resolveAssistantSession).mockResolvedValue(sessionOf('usr_in_chat'));
    const socket = new WebSocket(`${url}?schoolId=sch_chat&kind=chat`, { headers: { origin: ORIGIN, cookie: 'session=test' } });
    await new Promise<void>((resolve, reject) => {
      socket.on('message', (data) => {
        if (voiceServerMessageSchema.parse(JSON.parse(data.toString())).type === 'ready') resolve();
      });
      socket.on('error', reject);
    });
    expect(lastConnection().input.tools.map((tool) => tool.name)).toEqual(['ask_assistant']);
    expect(lastConnection().input.instructions).not.toContain('read_screen');
    socket.close();
    expect(await refusalOf(`${url}?schoolId=sch_chat&kind=sidebar`, { origin: ORIGIN, cookie: 'session=test' })).toBe(400);
  });

  it('closes one connection whose session cannot even be built, and keeps serving the others', async () => {
    model.broken = true;
    vi.mocked(resolveAssistantSession).mockResolvedValue(sessionOf('usr_unbuildable'));
    const socket = new WebSocket(`${url}?schoolId=sch_broken&kind=overlay`, { headers: { origin: ORIGIN, cookie: 'session=test' } });
    await new Promise<void>((resolve) => {
      socket.on('close', () => resolve());
      socket.on('error', () => resolve());
    });
    model.broken = false;
    const browser = await connect('sch_broken');
    browser.send({ type: 'end' });
    await browser.closed;
  });

  it('refuses new sessions beyond what one server may carry, and takes them again once there is room', async () => {
    const users = ['usr_cap_1', 'usr_cap_2'];
    let index = 0;
    vi.mocked(resolveAssistantSession).mockImplementation(async () => sessionOf(users[index++ % users.length]!));
    vi.mocked(voiceSettings).mockReturnValue({ ...SETTINGS, maxSessions: 1 });
    const first = await connect('sch_cap');
    expect(await refusalOf(`${url}?schoolId=sch_cap&kind=overlay`, { origin: ORIGIN, cookie: 'session=test' })).toBe(503);
    first.send({ type: 'end' });
    await first.closed;
    vi.mocked(resolveAssistantSession).mockResolvedValue(sessionOf('usr_cap_2'));
    const second = await eventually(() => connect('sch_cap').catch(() => null));
    second.send({ type: 'end' });
    await second.closed;
  });

  it('gives the last place to one of several people who ask for it at the same moment', async () => {
    vi.mocked(voiceSettings).mockReturnValue({ ...SETTINGS, maxSessions: 1 });
    // Each request is its own user, and all of them are still being looked up when the last one arrives.
    vi.mocked(resolveAssistantSession).mockImplementation(async (headers) => {
      await new Promise((resolve) => setTimeout(resolve, 100));
      return sessionOf(/user=([^;]+)/.exec(headers.get('cookie') ?? '')?.[1] ?? 'nobody');
    });
    const outcomes = await Promise.all(
      ['usr_rush_1', 'usr_rush_2', 'usr_rush_3', 'usr_rush_4'].map(
        (userId) =>
          new Promise<WebSocket | number>((resolve) => {
            const socket = new WebSocket(`${url}?schoolId=sch_rush&kind=overlay`, { headers: { origin: ORIGIN, cookie: `user=${userId}` } });
            socket.on('open', () => resolve(socket));
            socket.on('unexpected-response', (_request, response) => resolve(response.statusCode ?? 0));
            socket.on('error', () => undefined);
          }),
      ),
    );
    const admitted = outcomes.filter((outcome): outcome is WebSocket => typeof outcome !== 'number');
    expect(admitted).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome === 503)).toHaveLength(3);
    await new Promise<void>((resolve) => {
      admitted[0]!.on('close', () => resolve());
      admitted[0]!.close();
    });
  });

  it('tells the browser voice is unavailable when the voice model cannot be reached', async () => {
    model.unreachable = true;
    vi.mocked(resolveAssistantSession).mockResolvedValue(sessionOf('usr_unreachable'));
    const socket = new WebSocket(`${url}?schoolId=sch_down&kind=overlay`, { headers: { origin: ORIGIN, cookie: 'session=test' } });
    const messages: VoiceServerMessage[] = [];
    socket.on('message', (data) => messages.push(voiceServerMessageSchema.parse(JSON.parse(data.toString()))));
    await new Promise<void>((resolve) => socket.on('close', () => resolve()));
    expect(messages).toEqual([{ type: 'ended', reason: 'unavailable', message: 'Voice is not available right now. You can keep typing.' }]);
  });
});

describe('getStatus', () => {
  it('offers voice only when the platform has a voice model and the school has voice on', async () => {
    const context = { context: { headers: new Headers({ cookie: 'session=test' }) } };
    expect((await call(assistantRouter.getStatus, { schoolId: 'sch_status' }, context)).voice).toEqual({ available: true });

    vi.mocked(loadAssistantAccess).mockResolvedValueOnce({ ...ALLOWED, voiceEnabled: false });
    expect((await call(assistantRouter.getStatus, { schoolId: 'sch_status' }, context)).voice).toEqual({ available: false });

    vi.mocked(voiceSettings).mockReturnValue(null);
    expect(await call(assistantRouter.getStatus, { schoolId: 'sch_status' }, context)).toMatchObject({ available: true, voice: { available: false } });
  });
});
