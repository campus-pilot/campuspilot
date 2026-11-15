import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { Context } from '@campuspilot/api/context';
import { voiceServerMessageSchema, type VoiceClientMessage, type VoiceServerMessage } from '@campuspilot/assistant-contract/voice';
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
};

const ALLOWED: AssistantAccessDecision = {
  featureEnabled: true,
  member: true,
  allowedRoles: ['teacher'],
  limit: { known: true, monthlyLimitUsd: null },
  limitReached: false,
  voiceEnabled: true,
  allowed: true,
  refusal: null,
};

const sessionOf = (userId: string, impersonatedBy: string | null = null): AssistantSession => ({
  user: { id: userId, name: 'Asha Rao', email: 'asha@school.test', impersonatedBy },
  context: { session: { user: { id: userId } } } as unknown as Context,
});

/** The scripted voice model: every connection the endpoint opened, and what it was sent. */
const model = { connections: [] as Array<{ input: VoiceConnectInput; sent: unknown[][]; closed: boolean }>, unreachable: false };
const lastConnection = () => model.connections[model.connections.length - 1]!;
const say = (event: VoiceEvent) => lastConnection().input.onEvent(event);

let server: Server;
let url: string;
let voice: { close: () => void };

beforeAll(async () => {
  server = createServer((_request, response) => response.writeHead(404).end());
  voice = attachAssistantVoice(server, {
    createProvider: (settings) => ({
      id: 'gemini',
      model: settings.model,
      connect: async (input) => {
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
    }),
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

/** An open voice session as the browser sees it. */
async function connect(schoolId: string) {
  const socket = new WebSocket(`${url}?schoolId=${schoolId}`, { headers: { origin: ORIGIN, cookie: 'session=test' } });
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
    const target = `${url}?schoolId=sch_any`;
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
    expect(await first.next('ended')).toEqual({ type: 'ended', reason: 'ended', message: 'Voice continued in another window.' });
    await first.closed;
    expect(model.connections[0]!.closed).toBe(true);
    expect(model.connections[1]!.closed).toBe(false);
    second.send({ type: 'end' });
    await second.closed;
  });

  it('tells the browser voice is unavailable when the voice model cannot be reached', async () => {
    model.unreachable = true;
    vi.mocked(resolveAssistantSession).mockResolvedValue(sessionOf('usr_unreachable'));
    const socket = new WebSocket(`${url}?schoolId=sch_down`, { headers: { origin: ORIGIN, cookie: 'session=test' } });
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
