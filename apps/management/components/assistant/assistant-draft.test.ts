import assert from 'node:assert/strict';
import { test } from 'node:test';

import { draftKey, readDraft, writeDraft, type DraftStorage } from './assistant-draft';

function memoryStorage(): DraftStorage & { entries: Map<string, string> } {
  const entries = new Map<string, string>();
  return {
    entries,
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => void entries.set(key, value),
    removeItem: (key) => void entries.delete(key),
  };
}

const failingStorage: DraftStorage = {
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

test('a draft is kept per school and conversation', () => {
  assert.equal(draftKey('s1', 'c1'), 'assistant:draft:s1:c1');
  assert.notEqual(draftKey('s1', 'c1'), draftKey('s1', 'c2'));
  assert.notEqual(draftKey('s1', 'c1'), draftKey('s2', 'c1'));
});

test('new conversations in a school share one draft', () => {
  assert.equal(draftKey('s1', null), 'assistant:draft:s1:new');
});

test('a saved draft is read back as written', () => {
  const storage = memoryStorage();
  writeDraft(storage, draftKey('s', 'c'), '  Move Asha to 4B\nfrom Monday ');
  assert.equal(readDraft(storage, draftKey('s', 'c')), '  Move Asha to 4B\nfrom Monday ');
  assert.equal(readDraft(storage, draftKey('s', 'other')), '');
});

test('an empty or blank draft removes the entry', () => {
  const storage = memoryStorage();
  const key = draftKey('s', 'c');
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
});
