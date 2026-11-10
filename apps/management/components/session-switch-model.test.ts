import assert from 'node:assert/strict';
import { test } from 'node:test';

import { sessionSwitchSuffix } from './session-switch-model';

test('pages that exist in every session are kept when the session changes', () => {
  for (const suffix of ['', '/admissions', '/exam', '/notices', '/notices/new', '/classes/cls_1']) assert.equal(sessionSwitchSuffix(suffix), suffix);
});

test('a record of one session returns to its list in the new session (review U4)', () => {
  assert.equal(sessionSwitchSuffix('/exam/term-1/results'), '/exam');
  assert.equal(sessionSwitchSuffix('/notices/ntc_1'), '/notices');
  assert.equal(sessionSwitchSuffix('/notices/ntc_1/edit'), '/notices');
});
