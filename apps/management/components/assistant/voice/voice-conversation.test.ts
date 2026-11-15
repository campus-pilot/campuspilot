import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createVoiceConversation, type VoiceTurn } from './voice-conversation';

/** A `send` the test answers by hand, and what it was called with. */
function sender() {
  const calls: Array<{ request: string; conversationId: string | null; answer: (turn: VoiceTurn) => void; fail: (error: Error) => void }> = [];
  const send = (request: string, conversationId: string | null) =>
    new Promise<VoiceTurn>((answer, fail) => {
      calls.push({ request, conversationId, answer, fail });
    });
  return { calls, send };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('a voice session’s conversation', () => {
  it('sends a second request only once the first has a conversation, into that conversation', async () => {
    const { calls, send } = sender();
    const started: string[] = [];
    const conversation = createVoiceConversation(null);
    const first = conversation.send('Show fees due', send, (id) => started.push(id));
    // Spoken while the first is still on its way.
    const second = conversation.send('And for class 7?', send, (id) => started.push(id));
    await tick();
    assert.deepEqual(
      calls.map((call) => [call.request, call.conversationId]),
      [['Show fees due', null]],
    );
    calls[0]!.answer({ conversationId: 'c1', runId: 'r1' });
    assert.deepEqual(await first, { conversationId: 'c1', runId: 'r1' });
    await tick();
    assert.deepEqual([calls[1]!.request, calls[1]!.conversationId], ['And for class 7?', 'c1']);
    calls[1]!.answer({ conversationId: 'c1', runId: 'r2' });
    assert.deepEqual(await second, { conversationId: 'c1', runId: 'r2' });
    // One conversation was started, once.
    assert.deepEqual(started, ['c1']);
  });

  it('continues the conversation it was started in, and never reports it as started', async () => {
    const { calls, send } = sender();
    const started: string[] = [];
    const sent = createVoiceConversation('c9').send('Show fees due', send, (id) => started.push(id));
    await tick();
    assert.equal(calls[0]!.conversationId, 'c9');
    calls[0]!.answer({ conversationId: 'c9', runId: 'r1' });
    await sent;
    assert.deepEqual(started, []);
  });

  it('is not held up by a request that could not be sent: the next one starts the conversation', async () => {
    const { calls, send } = sender();
    const started: string[] = [];
    const conversation = createVoiceConversation(null);
    const first = conversation.send('Show fees due', send, (id) => started.push(id));
    const second = conversation.send('Show fees due', send, (id) => started.push(id));
    await tick();
    calls[0]!.fail(new Error('offline'));
    await assert.rejects(first, /offline/);
    await tick();
    assert.equal(calls[1]!.conversationId, null);
    calls[1]!.answer({ conversationId: 'c2', runId: 'r2' });
    assert.deepEqual(await second, { conversationId: 'c2', runId: 'r2' });
    assert.deepEqual(started, ['c2']);
  });
});
