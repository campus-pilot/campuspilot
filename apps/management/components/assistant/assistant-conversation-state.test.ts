import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { AssistantItemDto, AssistantRunDto } from '@campuspilot/assistant-contract/dto';

import {
  applyAssistantEvent,
  EMPTY_CONVERSATION_STATE,
  eventChangedConversationList,
  eventChangedSchoolData,
  hasSucceededWriteAfter,
  withConnectionLost, mayStopTurn } from './assistant-conversation-state';

const at = new Date('2026-11-05T00:00:00Z');
const conversation = { id: 'c', schoolId: 's', userId: 'u', title: 't', sharedWithPaper: false, lastSequence: 3, createdAt: at, updatedAt: at };
const reply = (sequence: number, status: 'streaming' | 'complete', text = ''): AssistantItemDto => ({
  id: 'i2', conversationId: 'c', runId: 'r', position: 2, sequence, createdAt: at, updatedAt: at,
  kind: 'assistant_message', status, body: { text },
});
const user: AssistantItemDto = {
  id: 'i1', conversationId: 'c', runId: 'r', position: 1, sequence: 1, createdAt: at, updatedAt: at,
  kind: 'user_message', status: 'complete', body: { text: 'hi' },
};
const run = (sequence: number, status: AssistantRunDto['status']): AssistantRunDto => ({
  id: 'r', conversationId: 'c', userId: 'u', status, surface: 'panel', stopRequestedAt: null, errorCode: null,
  errorMessage: null, sequence, createdAt: at, startedAt: null, completedAt: null, diagnostics: null,
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

test('a dropped connection is not synchronized until the next one catches up', () => {
  const live = applyAssistantEvent(snapshot, { type: 'synchronized' });
  assert.equal(live.synchronized, true);
  const dropped = withConnectionLost(live);
  assert.equal(dropped.synchronized, false);
  assert.equal(dropped.items, live.items);
  assert.equal(withConnectionLost(dropped), dropped);
  const resumed = applyAssistantEvent(dropped, { type: 'resume', conversation, items: [], runs: [] });
  assert.equal(resumed.synchronized, false);
  assert.equal(applyAssistantEvent(resumed, { type: 'synchronized' }).synchronized, true);
});

test('only writes that went through after the cursor count as missed changes', () => {
  const write = (sequence: number, status: 'succeeded' | 'failed', access: 'read' | 'write' = 'write'): AssistantItemDto => ({
    id: `t${sequence}`, conversationId: 'c', runId: 'r', position: sequence, sequence, createdAt: at, updatedAt: at,
    kind: 'tool_call', status,
    body: { toolUseId: 'u', toolName: 'n', title: 't', access, destructive: false, module: 'm', input: {} },
  });
  assert.equal(hasSucceededWriteAfter([write(5, 'succeeded')], 4), true);
  assert.equal(hasSucceededWriteAfter([write(4, 'succeeded')], 4), false);
  assert.equal(hasSucceededWriteAfter([write(5, 'failed')], 4), false);
  assert.equal(hasSucceededWriteAfter([write(5, 'succeeded', 'read'), user], 4), false);

  // Live: a change going through refreshes at once.
  assert.equal(eventChangedSchoolData({ type: 'item', item: write(5, 'succeeded') }, null), true);
  assert.equal(eventChangedSchoolData({ type: 'item', item: write(5, 'failed') }, null), false);
  // Catch-up after a reconnect: only for changes newer than the cursor held before it.
  const catchUp = (type: 'resume' | 'snapshot') => ({ type, conversation, items: [write(5, 'succeeded')], runs: [] });
  assert.equal(eventChangedSchoolData(catchUp('resume'), 4), true);
  assert.equal(eventChangedSchoolData(catchUp('snapshot'), 4), true);
  assert.equal(eventChangedSchoolData(catchUp('resume'), 5), false);
  // A first load is history, not a change made while away.
  assert.equal(eventChangedSchoolData(catchUp('snapshot'), null), false);
});

test('the history list refreshes for conversation changes and for runs reaching a state its rows show', () => {
  assert.equal(eventChangedConversationList({ type: 'conversation', conversation }), true);
  // A run ending, a new run in the queue and a run pausing for approval each change a row's dot.
  for (const status of ['completed', 'failed', 'cancelled', 'queued', 'awaiting_approval'] as const) {
    assert.equal(eventChangedConversationList({ type: 'run', run: run(4, status) }), true);
  }
  // A running run reports every step; the list's own refresh covers it.
  assert.equal(eventChangedConversationList({ type: 'run', run: run(4, 'running') }), false);
  assert.equal(eventChangedConversationList({ type: 'item', item: user }), false);
  assert.equal(eventChangedConversationList({ type: 'heartbeat' }), false);
});

test('the first snapshot marks where the conversation was opened; later ones keep it', () => {
  assert.equal(snapshot.openedSequence, 3);
  const resumed = applyAssistantEvent(snapshot, {
    type: 'resume', conversation: { ...conversation, lastSequence: 6 }, items: [reply(5, 'complete', 'Done')], runs: [],
  });
  assert.equal(resumed.openedSequence, 3);
  const again = applyAssistantEvent(resumed, {
    type: 'snapshot', conversation: { ...conversation, lastSequence: 9 }, items: [user], runs: [],
  });
  assert.equal(again.openedSequence, 3);
  assert.equal(again.sequence, 9);
});

test('a turn is stopped by its sender, or by whoever may write in the conversation', () => {
  assert.equal(mayStopTurn({ canWrite: false, userId: 'me', ownerId: 'me' }), true);
  assert.equal(mayStopTurn({ canWrite: false, userId: 'me', ownerId: 'ravi' }), false);
  assert.equal(mayStopTurn({ canWrite: true, userId: 'me', ownerId: 'ravi' }), true);
  // Before the session is known, or for a message that does not say whose it is, only the right to write counts.
  assert.equal(mayStopTurn({ canWrite: false, userId: null, ownerId: undefined }), false);
});
