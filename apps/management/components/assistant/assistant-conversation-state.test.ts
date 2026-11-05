import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { AssistantItemDto, AssistantRunDto } from '@campuspilot/assistant-contract/dto';

import { applyAssistantEvent, EMPTY_CONVERSATION_STATE } from './assistant-conversation-state';

const at = new Date('2026-11-05T00:00:00Z');
const conversation = { id: 'c', schoolId: 's', title: 't', lastSequence: 3, createdAt: at, updatedAt: at };
const reply = (sequence: number, status: 'streaming' | 'complete', text = ''): AssistantItemDto => ({
  id: 'i2', conversationId: 'c', runId: 'r', position: 2, sequence, createdAt: at, updatedAt: at,
  kind: 'assistant_message', status, body: { text },
});
const user: AssistantItemDto = {
  id: 'i1', conversationId: 'c', runId: 'r', position: 1, sequence: 1, createdAt: at, updatedAt: at,
  kind: 'user_message', status: 'complete', body: { text: 'hi' },
};
const run = (sequence: number, status: AssistantRunDto['status']): AssistantRunDto => ({
  id: 'r', conversationId: 'c', status, surface: 'panel', stopRequestedAt: null, errorCode: null,
  errorMessage: null, sequence, createdAt: at, startedAt: null, completedAt: null,
});

const snapshot = applyAssistantEvent(EMPTY_CONVERSATION_STATE, {
  type: 'snapshot', conversation, items: [reply(3, 'streaming'), user], runs: [run(2, 'running')],
});

test('snapshot orders items by position', () => {
  assert.deepEqual(snapshot.items.map((item) => item.id), ['i1', 'i2']);
});

test('text frames leave items and runs untouched', () => {
  const next = applyAssistantEvent(snapshot, { type: 'text', itemId: 'i2', offset: 0, delta: 'Hel' });
  assert.equal(next.items, snapshot.items);
  assert.equal(next.runs, snapshot.runs);
  assert.equal(next.text.i2, 'Hel');
});

test('stale upserts are ignored', () => {
  assert.equal(applyAssistantEvent(snapshot, { type: 'run', run: run(1, 'queued') }), snapshot);
  assert.equal(applyAssistantEvent(snapshot, { type: 'item', item: reply(3, 'complete') }), snapshot);
});

test('completing a message drops its streamed text and late frames', () => {
  const streaming = applyAssistantEvent(snapshot, { type: 'text', itemId: 'i2', offset: 0, delta: 'Hel' });
  const done = applyAssistantEvent(streaming, { type: 'item', item: reply(4, 'complete', 'Hello') });
  assert.equal(done.text.i2, undefined);
  assert.equal(applyAssistantEvent(done, { type: 'text', itemId: 'i2', offset: 3, delta: 'lo' }), done);
});

test('text deltas append in order and ignore duplicates and gaps', () => {
  let state = applyAssistantEvent(snapshot, { type: 'text', itemId: 'i2', offset: 0, delta: 'Hel' });
  state = applyAssistantEvent(state, { type: 'text', itemId: 'i2', offset: 3, delta: 'lo ' });
  assert.equal(state.text.i2, 'Hello ');
  assert.equal(applyAssistantEvent(state, { type: 'text', itemId: 'i2', offset: 0, delta: 'Hel' }), state);
  assert.equal(applyAssistantEvent(state, { type: 'text', itemId: 'i2', offset: 9, delta: 'x' }), state);
  // A reconnect re-sends the whole text from offset 0: only the new tail lands.
  state = applyAssistantEvent(state, { type: 'text', itemId: 'i2', offset: 0, delta: 'Hello world' });
  assert.equal(state.text.i2, 'Hello world');
});

test('resume merges changes and advances the cursor', () => {
  const resumed = applyAssistantEvent(snapshot, {
    type: 'resume', conversation: { ...conversation, lastSequence: 6 }, items: [reply(5, 'complete', 'Done')], runs: [run(6, 'completed')],
  });
  assert.equal(resumed.items.length, 2);
  assert.equal(resumed.runs[0]?.status, 'completed');
  assert.equal(resumed.sequence, 6);
});
