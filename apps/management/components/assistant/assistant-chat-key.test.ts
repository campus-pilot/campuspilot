import assert from 'node:assert/strict';
import { test } from 'node:test';

import { chatKeyOf, INITIAL_CHAT_KEY_STATE, nextChatKeyState, type ChatKeyState } from './assistant-chat-key';

/**
 * One render of a surface: the conversation it shows and whether a move to a
 * started conversation is under way, or `{ started }` for the open chat's
 * first send (which begins such a move).
 */
type Step = { show: string | null; moving?: boolean } | { started: string };

/** The keys a surface renders for each `show` step in turn. */
function keysFor(steps: Step[]): string[] {
  let state: ChatKeyState = INITIAL_CHAT_KEY_STATE;
  const keys: string[] = [];
  for (const step of steps) {
    if ('started' in step) {
      state = { ...state, started: step.started };
      continue;
    }
    state = nextChatKeyState(state, step.show, step.moving ?? false);
    keys.push(chatKeyOf(state));
  }
  return keys;
}

test('a new conversation keeps its chat when its first message starts the conversation', () => {
  const [fresh, waiting, arrived] = keysFor([{ show: null }, { started: 'c1' }, { show: null, moving: true }, { show: 'c1' }]);
  assert.equal(waiting, fresh);
  assert.equal(arrived, fresh);
});

test('a move that ends without arriving gives the new conversation a chat of its own', () => {
  // The user followed a link to the new-conversation page while the address change was pending: Next replaced
  // that navigation with theirs, so the page stays on a new conversation and the chat must not keep the started one.
  const [fresh, waiting, cancelled] = keysFor([{ show: null }, { started: 'c1' }, { show: null, moving: true }, { show: null }]);
  assert.equal(waiting, fresh);
  assert.notEqual(cancelled, fresh);
  // Opening the started conversation afterwards is just another conversation.
  assert.deepEqual(keysFor([{ show: null }, { started: 'c1' }, { show: null, moving: true }, { show: null }, { show: 'c1' }]).at(-1), 'c1');
});

test('opening another conversation, or a new one after starting one, gives a chat no earlier chat had', () => {
  const keys = keysFor([{ show: null }, { started: 'c1' }, { show: 'c1' }, { show: null }, { show: 'c2' }, { show: null }]);
  assert.equal(new Set(keys).size, keys.length - 1, 'only the arrival in c1 reuses a key');
  assert.equal(keys[1], keys[0], 'the arrival in c1 keeps the chat');
  assert.notEqual(keys[2], keys[0], 'back to a new conversation remounts');
  assert.equal(keys[3], 'c2');
  assert.notEqual(keys[4], keys[2], 'each new conversation is its own chat');
});

test('a conversation opened from the history is keyed by its id, and a start it interrupts is forgotten', () => {
  assert.deepEqual(keysFor([{ show: 'c1' }, { show: 'c2' }]), ['c1', 'c2']);
  const [, other, back] = keysFor([{ show: null }, { started: 'c1' }, { show: 'c2' }, { show: 'c1' }]);
  assert.equal(other, 'c2');
  assert.equal(back, 'c1');
});

test('nothing changes while the same conversation stays open', () => {
  const state = nextChatKeyState(INITIAL_CHAT_KEY_STATE, 'c1', false);
  assert.equal(nextChatKeyState(state, 'c1', false), state);
  assert.equal(nextChatKeyState(INITIAL_CHAT_KEY_STATE, null, false), INITIAL_CHAT_KEY_STATE);
});
