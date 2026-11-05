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
  const next = applyAssistantEvent(snapshot, { type: 'text', itemId: 'i2', text: 'Hel' });
  assert.equal(next.items, snapshot.items);
  assert.equal(next.runs, snapshot.runs);
  assert.equal(next.text.i2, 'Hel');
});

test('stale upserts are ignored', () => {
  assert.equal(applyAssistantEvent(snapshot, { type: 'run', run: run(1, 'queued') }), snapshot);
  assert.equal(applyAssistantEvent(snapshot, { type: 'item', item: reply(3, 'complete') }), snapshot);
});

test('completing a message drops its streamed text and late frames', () => {
  const streaming = applyAssistantEvent(snapshot, { type: 'text', itemId: 'i2', text: 'Hel' });
  const done = applyAssistantEvent(streaming, { type: 'item', item: reply(4, 'complete', 'Hello') });
  assert.equal(done.text.i2, undefined);
  assert.equal(applyAssistantEvent(done, { type: 'text', itemId: 'i2', text: 'He' }), done);
});
