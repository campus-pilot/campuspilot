import assert from 'node:assert/strict';
import { test } from 'node:test';

import { chatKeyOf, INITIAL_CHAT_KEY_STATE, nextChatKeyState, type ChatKeyState } from './assistant-chat-key';

/** The keys a surface renders while it shows each of `steps` in turn; a `started:` step marks the open chat's first send. */
function keysFor(steps: (string | null)[]): string[] {
  let state: ChatKeyState = INITIAL_CHAT_KEY_STATE;
  const keys: string[] = [];
  for (const step of steps) {
    if (step?.startsWith('started:')) {
      state = { ...state, started: step.slice('started:'.length) };
      continue;
    }
    state = nextChatKeyState(state, step);
    keys.push(chatKeyOf(state));
  }
  return keys;
}

test('a new conversation keeps its chat when its first message starts the conversation', () => {
  const [fresh, waiting, arrived] = keysFor([null, 'started:c1', null, 'c1']);
  assert.equal(waiting, fresh);
  assert.equal(arrived, fresh);
});

test('opening another conversation, or a new one after starting one, gives a chat no earlier chat had', () => {
  const keys = keysFor([null, 'started:c1', 'c1', null, 'c2', null]);
  assert.equal(new Set(keys).size, keys.length - 1, 'only the arrival in c1 reuses a key');
  assert.equal(keys[1], keys[0], 'the arrival in c1 keeps the chat');
  assert.notEqual(keys[2], keys[0], 'back to a new conversation remounts');
  assert.equal(keys[3], 'c2');
  assert.notEqual(keys[4], keys[2], 'each new conversation is its own chat');
});

test('a conversation opened from the history is keyed by its id, and a later start does not touch it', () => {
  assert.deepEqual(keysFor(['c1', 'c2']), ['c1', 'c2']);
  // Leaving before the started conversation arrived: opening it later is a new chat with its own key.
  const [, other, back] = keysFor([null, 'started:c1', 'c2', 'c1']);
  assert.equal(other, 'c2');
  assert.equal(back, 'c1');
});

test('nothing changes while the same conversation stays open', () => {
  const state = nextChatKeyState(INITIAL_CHAT_KEY_STATE, 'c1');
  assert.equal(nextChatKeyState(state, 'c1'), state);
  assert.equal(nextChatKeyState(INITIAL_CHAT_KEY_STATE, null), INITIAL_CHAT_KEY_STATE);
});
