import assert from 'node:assert/strict';
import { test } from 'node:test';

import { seedFromQuery } from './assistant-seed-query';

const paper = 'seed=question_paper&sessionId=sess_1&classId=cls_1&subjectSlug=math&modeSlug=oral';

test('a question paper link seeds the conversation with its paper', () => {
  assert.deepEqual(seedFromQuery(new URLSearchParams(`${paper}&examSlug=term-1`)), {
    kind: 'question_paper',
    sessionId: 'sess_1',
    examSlug: 'term-1',
    classId: 'cls_1',
    subjectSlug: 'math',
    modeSlug: 'oral',
  });
});

test('of a repeated parameter the first value counts, as on the server', () => {
  assert.equal(seedFromQuery(new URLSearchParams(`${paper}&examSlug=term-1&examSlug=term-2`))?.examSlug, 'term-1');
});

test('an address without a complete seed starts a plain conversation', () => {
  assert.equal(seedFromQuery(new URLSearchParams('seed=question_paper&sessionId=sess_1')), null);
  assert.equal(seedFromQuery(new URLSearchParams('')), null);
});
