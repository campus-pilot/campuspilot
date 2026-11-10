import assert from 'node:assert/strict';
import { test } from 'node:test';

import { draftKey, forgetDrafts, readDraft, writeDraft, type DraftStorage } from './assistant-draft';

function memoryStorage(): DraftStorage & { entries: Map<string, string> } {
  const entries = new Map<string, string>();
  return {
    entries,
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => void entries.set(key, value),
    removeItem: (key) => void entries.delete(key),
    key: (index) => [...entries.keys()][index] ?? null,
    get length() {
      return entries.size;
    },
  };
}

const failingStorage: DraftStorage = {
  length: 0,
  key: () => {
    throw new Error('blocked');
  },
  getItem: () => {
    throw new Error('blocked');
  },
  setItem: () => {
    throw new Error('full');
  },
  removeItem: () => {
    throw new Error('blocked');
  },
};

test('a draft is kept per user, school and conversation', () => {
  assert.equal(draftKey('u1', 's1', 'c1'), 'assistant:draft:u1:s1:c1');
  assert.notEqual(draftKey('u1', 's1', 'c1'), draftKey('u1', 's1', 'c2'));
  assert.notEqual(draftKey('u1', 's1', 'c1'), draftKey('u1', 's2', 'c1'));
});

test('the next person on a shared tab never reads the last one’s draft', () => {
  const storage = memoryStorage();
  writeDraft(storage, draftKey('u1', 's1', null), 'Confidential note about Asha');
  assert.equal(readDraft(storage, draftKey('u2', 's1', null)), '');
});

test('a user’s new conversations in a school share one draft', () => {
  assert.equal(draftKey('u1', 's1', null), 'assistant:draft:u1:s1:new');
});

test('signing out forgets every assistant draft and nothing else', () => {
  const storage = memoryStorage();
  writeDraft(storage, draftKey('u1', 's1', null), 'one');
  writeDraft(storage, draftKey('u2', 's1', 'c1'), 'two');
  storage.setItem('theme', 'dark');
  forgetDrafts(storage);
  assert.deepEqual([...storage.entries.keys()], ['theme']);
});

test('a saved draft is read back as written', () => {
  const storage = memoryStorage();
  writeDraft(storage, draftKey('u', 's', 'c'), '  Move Asha to 4B\nfrom Monday ');
  assert.equal(readDraft(storage, draftKey('u', 's', 'c')), '  Move Asha to 4B\nfrom Monday ');
  assert.equal(readDraft(storage, draftKey('u', 's', 'other')), '');
});

test('an empty or blank draft removes the entry', () => {
  const storage = memoryStorage();
  const key = draftKey('u', 's', 'c');
  writeDraft(storage, key, 'hello');
  writeDraft(storage, key, '');
  assert.equal(storage.entries.has(key), false);
  writeDraft(storage, key, 'hello');
  writeDraft(storage, key, '  \n ');
  assert.equal(storage.entries.has(key), false);
  assert.equal(readDraft(storage, key), '');
});

test('missing or failing storage reads as no draft and never throws', () => {
  assert.equal(readDraft(null, 'k'), '');
  assert.equal(readDraft(failingStorage, 'k'), '');
  assert.doesNotThrow(() => writeDraft(null, 'k', 'text'));
  assert.doesNotThrow(() => writeDraft(failingStorage, 'k', 'text'));
  assert.doesNotThrow(() => writeDraft(failingStorage, 'k', ''));
  assert.doesNotThrow(() => forgetDrafts(null));
  assert.doesNotThrow(() => forgetDrafts(failingStorage));
});
