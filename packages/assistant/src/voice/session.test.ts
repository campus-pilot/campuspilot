import type { VoiceServerMessage } from '@campuspilot/assistant-contract/voice';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { APP_NOTE_PREFIX } from './prompt';
import type { VoiceConnectInput, VoiceEvent } from './provider';
import { VoiceSession, type VoiceSessionRefusal } from './session';
import type { TurnUpdate } from './turn-watch';

/**
 * A voice session against a scripted voice model: the test plays the model's
 * events and the browser's messages, and reads what the session sent to each.
 */
function harness(options: { failConnects?: number; refusal?: VoiceSessionRefusal | null; watchRejects?: boolean } = {}) {
  const connections: Array<{ input: VoiceConnectInput; calls: unknown[][]; closed: boolean }> = [];
  let failConnects = options.failConnects ?? 0;
  const toBrowser: VoiceServerMessage[] = [];
  const audioToBrowser: Uint8Array[] = [];
  const usage: Array<{ reply: number; audioOutputTokens: number }> = [];
  const watches: Array<{ turn: { conversationId: string; runId: string }; onUpdate: (update: TurnUpdate) => void; stopped: boolean }> = [];
  let socketClosed = 0;
  let refusal = options.refusal ?? null;

  const session = new VoiceSession({
    sessionId: 'avs_test',
    provider: {
      id: 'gemini',
      model: 'voice-test-model',
      connect: async (input) => {
        if (failConnects > 0) {
          failConnects -= 1;
          throw new Error('cannot reach the voice model');
        }
        const connection = { input, calls: [] as unknown[][], closed: false };
        connections.push(connection);
        return {
          sendAudio: (pcm) => connection.calls.push(['audio', pcm.byteLength]),
          endAudio: () => connection.calls.push(['endAudio']),
          sendToolResult: (result) => connection.calls.push(['result', result]),
          sendNote: (text) => connection.calls.push(['note', text]),
          close: () => {
            connection.closed = true;
          },
        };
      },
    },
    instructions: 'instructions',
    limits: { maxSessionMs: 10 * 60_000, idleMs: 60_000 },
    send: (message) => toBrowser.push(message),
    sendAudio: (pcm) => audioToBrowser.push(pcm),
    closeSocket: () => {
      socketClosed += 1;
    },
    recordUsage: async (value, reply) => {
      usage.push({ reply, audioOutputTokens: value.audioOutputTokens });
    },
    refusal: async () => refusal,
    watchTurn: async (turn, onUpdate) => {
      if (options.watchRejects) throw new Error('not this user’s run');
      const watch = { turn, onUpdate, stopped: false };
      watches.push(watch);
      return {
        stop: async () => {
          watch.stopped = true;
        },
      };
    },
    log: { info: () => undefined, warn: () => undefined },
  });

  return {
    session,
    connections,
    toBrowser,
    audioToBrowser,
    usage,
    watches,
    socketClosed: () => socketClosed,
    setRefusal: (value: VoiceSessionRefusal | null) => {
      refusal = value;
    },
    /** The voice model sends an event on its latest connection. A tool call follows the user speaking, as it does for real. */
    model: (event: VoiceEvent, connection = connections.length - 1) => {
      if (event.type === 'tool_calls') {
        connections[connection]!.input.onEvent({ type: 'user_speaking', speaking: true });
        connections[connection]!.input.onEvent({ type: 'user_speaking', speaking: false });
        toBrowser.splice(-2);
      }
      connections[connection]!.input.onEvent(event);
    },
    /** The voice model sends an event exactly as given, with nothing before it. */
    modelRaw: (event: VoiceEvent) => connections[connections.length - 1]!.input.onEvent(event),
    last: () => connections[connections.length - 1]!,
    types: () => toBrowser.map((message) => message.type),
  };
}

const ask = (request: unknown, id = 'call1'): VoiceEvent => ({ type: 'tool_calls', calls: [{ id, name: 'ask_assistant', args: { request } }] });


beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('a voice session', () => {
  it('tells the browser it may talk once the voice model is connected, and relays audio both ways', async () => {
    const h = harness();
    await h.session.start();
    expect(h.toBrowser).toEqual([{ type: 'ready', sessionId: 'avs_test', maxSeconds: 600 }]);
    expect(h.last().input.resumeHandle).toBeNull();

    h.session.handleAudio(new Uint8Array(640));
    expect(h.last().calls).toEqual([['audio', 640]]);
    h.model({ type: 'audio', pcm: new Uint8Array(480) });
    expect(h.audioToBrowser.map((pcm) => pcm.byteLength)).toEqual([480]);
  });

  it('shows what the user said as one utterance, final once they stop', async () => {
    const h = harness();
    await h.session.start();
    h.model({ type: 'user_speaking', speaking: true });
    h.model({ type: 'heard', text: 'Class 8-B ', finished: false });
    h.model({ type: 'heard', text: 'ki report', finished: false });
    h.model({ type: 'user_speaking', speaking: false });
    h.model({ type: 'user_speaking', speaking: true });
    h.model({ type: 'heard', text: 'aur 7-A', finished: false });
    expect(h.toBrowser.slice(1)).toEqual([
      { type: 'user_speaking', speaking: true },
      { type: 'heard', text: 'Class 8-B ', final: false },
      { type: 'heard', text: 'Class 8-B ki report', final: false },
      { type: 'user_speaking', speaking: false },
      { type: 'heard', text: 'Class 8-B ki report', final: true },
      { type: 'user_speaking', speaking: true },
      { type: 'heard', text: 'aur 7-A', final: false },
    ]);
  });

  it('starts a new caption for each reply of the assistant', async () => {
    const h = harness();
    await h.session.start();
    h.model({ type: 'said', text: 'Sure, ' });
    h.model({ type: 'said', text: 'one moment.' });
    h.model({ type: 'reply_done' });
    h.model({ type: 'said', text: 'Here it is.' });
    expect(h.toBrowser.slice(1)).toEqual([
      { type: 'said', text: 'Sure, ' },
      { type: 'said', text: 'Sure, one moment.' },
      { type: 'reply_done' },
      { type: 'said', text: 'Here it is.' },
    ]);
  });

  it('passes a request to the browser, follows the run it started and gives the voice model its outcome', async () => {
    const h = harness();
    await h.session.start();
    h.model(ask('  Aarav Sharma ki half-yearly report dikhao  '));
    expect(h.toBrowser.at(-1)).toEqual({ type: 'ask', askId: 'ask_1', request: 'Aarav Sharma ki half-yearly report dikhao' });

    h.session.handleMessage({ type: 'turn', askId: 'ask_1', conversationId: 'c1', runId: 'r1' });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.watches.map((watch) => watch.turn)).toEqual([{ conversationId: 'c1', runId: 'r1' }]);

    h.watches[0]!.onUpdate({ type: 'approval', change: 'Record a payment of ₹4,500' });
    h.watches[0]!.onUpdate({
      type: 'settled',
      outcome: { status: 'done', answer: 'Recorded.', onScreen: ['Table: Receipts'], changesMade: ['Record a payment of ₹4,500'], changesDeclined: [] },
    });

    expect(h.last().calls).toEqual([
      ['result', { id: 'call1', name: 'ask_assistant', output: { status: 'needs_approval', change_waiting_for_the_users_tap: 'Record a payment of ₹4,500' }, delivery: 'when_idle', final: false }],
      [
        'result',
        {
          id: 'call1',
          name: 'ask_assistant',
          output: { status: 'done', answer: 'Recorded.', shown_on_screen: ['Table: Receipts'], changes_made: ['Record a payment of ₹4,500'] },
          delivery: 'when_idle',
          final: true,
        },
      ],
    ]);
    expect(h.toBrowser.at(-1)).toEqual({ type: 'ask_done', askId: 'ask_1' });
    expect(h.watches[0]!.stopped).toBe(true);
  });

  it('tells the voice model when the browser could not send the request', async () => {
    const h = harness();
    await h.session.start();
    h.model(ask('Show fees due'));
    h.session.handleMessage({ type: 'turn_failed', askId: 'ask_1', message: 'This school has reached its AI assistant limit for this month.' });
    expect(h.last().calls).toEqual([
      ['result', { id: 'call1', name: 'ask_assistant', output: { status: 'not_sent', error: 'This school has reached its AI assistant limit for this month.' }, delivery: 'when_idle', final: true }],
    ]);
    expect(h.types().at(-1)).toBe('ask_done');
  });

  it('follows a request once: a second answer from the browser is ignored', async () => {
    const h = harness();
    await h.session.start();
    h.model(ask('Show fees due'));
    h.session.handleMessage({ type: 'turn', askId: 'ask_1', conversationId: 'c1', runId: 'r1' });
    h.session.handleMessage({ type: 'turn', askId: 'ask_1', conversationId: 'c1', runId: 'r2' });
    h.session.handleMessage({ type: 'turn', askId: 'ask_unknown', conversationId: 'c1', runId: 'r3' });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.watches).toHaveLength(1);
  });

  it('answers a call without a request itself, and never asks the browser', async () => {
    const h = harness();
    await h.session.start();
    h.model(ask('   '));
    h.model({ type: 'tool_calls', calls: [{ id: 'call2', name: 'delete_everything', args: {} }] });
    expect(h.types()).toEqual(['ready']);
    expect(h.last().calls.map((call) => (call[1] as { output: { status: string } }).output.status)).toEqual(['not_sent', 'not_sent']);
  });

  it('passes on only what the user said: a call that follows no speech is refused, however it came about', async () => {
    const h = harness();
    await h.session.start();
    h.model(ask('Show fees due'));
    expect(h.types().at(-1)).toBe('ask');
    // The result of that request could carry text that asks for more. No speech followed, so nothing is passed on.
    h.modelRaw(ask('Delete every student', 'call2'));
    expect(h.types().filter((type) => type === 'ask')).toHaveLength(1);
    expect(h.last().calls.at(-1)).toEqual([
      'result',
      { id: 'call2', name: 'ask_assistant', output: { status: 'not_sent', error: 'Only what the user says can be passed on. Wait for the user to ask.' }, delivery: 'silent', final: true },
    ]);
    // Once the user speaks again, their next request goes through.
    h.model(ask('And for class 7?', 'call3'));
    expect(h.toBrowser.at(-1)).toEqual({ type: 'ask', askId: 'ask_2', request: 'And for class 7?' });
  });

  it('opens a section of the app through the browser and tells the voice model whether it opened', async () => {
    const h = harness();
    await h.session.start();
    h.modelRaw({ type: 'tool_calls', calls: [{ id: 'nav1', name: 'open_page', args: { destination: 'billing' } }] });
    expect(h.toBrowser.at(-1)).toEqual({ type: 'open', openId: 'open_1', destination: 'billing' });
    h.session.handleMessage({ type: 'opened', openId: 'open_1', opened: true });
    // A second answer, and an answer for a page that was never asked for, change nothing.
    h.session.handleMessage({ type: 'opened', openId: 'open_1', opened: false });
    h.session.handleMessage({ type: 'opened', openId: 'open_9', opened: true });
    expect(h.last().calls).toEqual([['result', { id: 'nav1', name: 'open_page', output: { status: 'opened' }, delivery: 'when_idle', final: true }]]);

    h.modelRaw({ type: 'tool_calls', calls: [{ id: 'nav2', name: 'open_page', args: { destination: 'examinations' } }] });
    h.session.handleMessage({ type: 'opened', openId: 'open_2', opened: false, message: 'This section cannot be opened from here.' });
    expect(h.last().calls.at(-1)).toEqual([
      'result',
      { id: 'nav2', name: 'open_page', output: { status: 'not_opened', error: 'This section cannot be opened from here.' }, delivery: 'when_idle', final: true },
    ]);
  });

  it('follows a link on the screen by its text, and gives the voice model the links when none matched', async () => {
    const h = harness();
    await h.session.start();
    h.modelRaw({ type: 'tool_calls', calls: [{ id: 'nav1', name: 'open_on_screen', args: { label: ' Second Term Examination ' } }] });
    expect(h.toBrowser.at(-1)).toEqual({ type: 'open_link', openId: 'open_1', label: 'Second Term Examination' });
    h.session.handleMessage({ type: 'opened', openId: 'open_1', opened: false, message: 'Nothing on the screen matches "Second Term Examination".', linksOnScreen: ['Periodic Test 1', 'Annual Examination'] });
    expect(h.last().calls).toEqual([
      [
        'result',
        {
          id: 'nav1',
          name: 'open_on_screen',
          output: { status: 'not_opened', error: 'Nothing on the screen matches "Second Term Examination".', links_on_screen: ['Periodic Test 1', 'Annual Examination'] },
          delivery: 'when_idle',
          final: true,
        },
      ],
    ]);
    h.modelRaw({ type: 'tool_calls', calls: [{ id: 'nav2', name: 'open_on_screen', args: { label: '' } }] });
    expect(h.toBrowser.filter((message) => message.type === 'open_link')).toHaveLength(1);
  });

  it('reads the screen through the browser and gives the voice model its text, without the assistant', async () => {
    const h = harness();
    await h.session.start();
    h.modelRaw({ type: 'tool_calls', calls: [{ id: 'read1', name: 'read_screen', args: {} }] });
    expect(h.toBrowser.at(-1)).toEqual({ type: 'read_screen', readId: 'read_1' });
    h.session.handleMessage({ type: 'screen', readId: 'read_1', title: 'Examinations · School', text: 'Examinations\nPeriodic Test 1 | Completed' });
    // A second answer, and one for a read never asked for, change nothing.
    h.session.handleMessage({ type: 'screen', readId: 'read_1', title: 'x', text: 'y' });
    h.session.handleMessage({ type: 'screen', readId: 'read_9', title: 'x', text: 'y' });
    expect(h.last().calls).toEqual([
      [
        'result',
        {
          id: 'read1',
          name: 'read_screen',
          output: {
            status: 'read',
            page_title: 'Examinations · School',
            page_text: 'Examinations\nPeriodic Test 1 | Completed',
            valid: 'Only for the question just asked. Read the screen again for any later question.',
          },
          delivery: 'when_idle',
          final: true,
        },
      ],
    ]);
    expect(h.types()).not.toContain('ask');

    h.modelRaw({ type: 'tool_calls', calls: [{ id: 'read2', name: 'read_screen', args: {} }] });
    h.session.handleMessage({ type: 'screen', readId: 'read_2', title: '', text: '' });
    expect((h.last().calls.at(-1)![1] as { output: { status: string } }).output.status).toBe('not_read');
  });

  it('never asks the browser to open an address the voice model made up', async () => {
    const h = harness();
    await h.session.start();
    for (const destination of ['https://evil.example', '/school/other/settings', '', undefined]) {
      h.modelRaw({ type: 'tool_calls', calls: [{ id: 'nav', name: 'open_page', args: { destination } }] });
    }
    expect(h.types()).toEqual(['ready']);
    expect(h.last().calls.map((call) => (call[1] as { output: { status: string } }).output.status)).toEqual(['not_opened', 'not_opened', 'not_opened', 'not_opened']);
  });

  it('reports a run it may not follow as failed, without waiting for ever', async () => {
    const h = harness({ watchRejects: true });
    await h.session.start();
    h.model(ask('Show fees due'));
    h.session.handleMessage({ type: 'turn', askId: 'ask_1', conversationId: 'c1', runId: 'someone-elses' });
    await vi.advanceTimersByTimeAsync(0);
    expect((h.last().calls[0]![1] as { output: { status: string } }).output.status).toBe('failed');
    expect(h.types().at(-1)).toBe('ask_done');
  });

  it('tells the outcome as a note once the voice model stopped waiting for the call', async () => {
    const h = harness();
    await h.session.start();
    h.model(ask('Show fees due'));
    h.session.handleMessage({ type: 'turn', askId: 'ask_1', conversationId: 'c1', runId: 'r1' });
    await vi.advanceTimersByTimeAsync(0);
    h.model({ type: 'tool_calls_cancelled', ids: ['call1'] });
    h.watches[0]!.onUpdate({ type: 'settled', outcome: { status: 'failed', error: 'The fee structure was not found.' } });
    expect(h.last().calls).toEqual([['note', `${APP_NOTE_PREFIX} News about a request the user made earlier: {"status":"failed","error":"The fee structure was not found."}`]]);
  });

  it('replaces a connection that is about to close, continuing from the latest handle', async () => {
    const h = harness();
    await h.session.start();
    h.model({ type: 'resume_handle', handle: 'h1' });
    h.model({ type: 'resume_handle', handle: 'h2' });
    h.model(ask('Show fees due'));
    h.session.handleMessage({ type: 'turn', askId: 'ask_1', conversationId: 'c1', runId: 'r1' });
    await vi.advanceTimersByTimeAsync(0);

    h.model({ type: 'going_away' });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.connections).toHaveLength(2);
    expect(h.connections[0]!.closed).toBe(true);
    expect(h.connections[1]!.input.resumeHandle).toBe('h2');
    expect(h.types().slice(-2)).toEqual(['reconnecting', 'reconnected']);

    // The old connection's late events are ignored; the running request's outcome reaches the new one as a note.
    h.model({ type: 'said', text: 'stale' }, 0);
    expect(h.types().at(-1)).toBe('reconnected');
    h.watches[0]!.onUpdate({ type: 'settled', outcome: { status: 'stopped' } });
    expect(h.connections[1]!.calls[0]![0]).toBe('note');
  });

  it('restores a dropped connection, and ends as unavailable when it cannot', async () => {
    const h = harness();
    await h.session.start();
    h.model({ type: 'closed', expected: false, detail: '1011 internal error' });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.connections).toHaveLength(2);

    const failing = harness();
    await failing.session.start();
    const before = failing.connections.length;
    // Every later connect fails.
    failing.session['deps'].provider.connect = async () => {
      throw new Error('down');
    };
    failing.model({ type: 'closed', expected: false, detail: '1006' });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(failing.connections).toHaveLength(before);
    expect(failing.toBrowser.at(-1)).toEqual({ type: 'ended', reason: 'unavailable', message: 'Voice is not available right now. You can keep typing.' });
    expect(failing.socketClosed()).toBe(1);
  });

  it('does not reconnect after closing the connection itself', async () => {
    const h = harness();
    await h.session.start();
    h.session.handleMessage({ type: 'end' });
    h.model({ type: 'closed', expected: true, detail: '1000' });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.connections).toHaveLength(1);
    expect(h.connections[0]!.closed).toBe(true);
    expect(h.toBrowser.at(-1)).toEqual({ type: 'ended', reason: 'ended', message: 'Voice ended.' });
    expect(h.socketClosed()).toBe(1);
  });

  it('saves the usage of each reply under its number', async () => {
    const h = harness();
    await h.session.start();
    const usage = { textInputTokens: 1, audioInputTokens: 2, textOutputTokens: 3, audioOutputTokens: 4 };
    h.model({ type: 'usage', usage });
    h.model({ type: 'usage', usage: { ...usage, audioOutputTokens: 9 } });
    expect(h.usage).toEqual([
      { reply: 1, audioOutputTokens: 4 },
      { reply: 2, audioOutputTokens: 9 },
    ]);
  });

  it('ends when it stays quiet, but not while a request is running', async () => {
    const quiet = harness();
    await quiet.session.start();
    await vi.advanceTimersByTimeAsync(65_000);
    expect(quiet.toBrowser.at(-1)).toMatchObject({ type: 'ended', reason: 'idle' });

    const working = harness();
    await working.session.start();
    working.model(ask('A long report'));
    working.session.handleMessage({ type: 'turn', askId: 'ask_1', conversationId: 'c1', runId: 'r1' });
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(working.types()).not.toContain('ended');
  });

  it('ends at its longest length', async () => {
    const h = harness();
    await h.session.start();
    h.model(ask('A very long report'));
    await vi.advanceTimersByTimeAsync(10 * 60_000 + 5_000);
    expect(h.toBrowser.at(-1)).toMatchObject({ type: 'ended', reason: 'max_duration' });
    expect(h.last().closed).toBe(true);
  });

  it('ends with the reason once its user may no longer use voice', async () => {
    const h = harness();
    await h.session.start();
    h.model(ask('Keep the session open'));
    h.setRefusal({ reason: 'limit_reached', message: 'This school has reached its AI assistant limit for this month.' });
    await vi.advanceTimersByTimeAsync(61_000);
    expect(h.toBrowser.at(-1)).toEqual({ type: 'ended', reason: 'limit_reached', message: 'This school has reached its AI assistant limit for this month.' });
  });

  it('ends quietly when the browser goes away, and stops following its requests', async () => {
    const h = harness();
    await h.session.start();
    h.model(ask('Show fees due'));
    h.session.handleMessage({ type: 'turn', askId: 'ask_1', conversationId: 'c1', runId: 'r1' });
    await vi.advanceTimersByTimeAsync(0);
    h.session.handleSocketClosed();
    expect(h.types()).not.toContain('ended');
    expect(h.watches[0]!.stopped).toBe(true);
    expect(h.last().closed).toBe(true);
    h.session.handleAudio(new Uint8Array(2));
    expect(h.last().calls).toEqual([]);
  });

  it('tells the voice model the microphone paused when the user mutes', async () => {
    const h = harness();
    await h.session.start();
    h.session.handleMessage({ type: 'mic', open: false });
    h.session.handleMessage({ type: 'mic', open: true });
    expect(h.last().calls).toEqual([['endAudio']]);
  });

  it('rejects the start when the voice model cannot be reached', async () => {
    const h = harness({ failConnects: 1 });
    await expect(h.session.start()).rejects.toThrow('cannot reach the voice model');
    expect(h.toBrowser).toEqual([]);
  });
});
