import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { cadetReleaseAction, examActionDescription, examActionLabel, isRemarkEditable, reopenBlockedReason } from './exam-model';

const released = new Date('2026-10-04T00:00:00Z');

test('release applies only to a completed exam and withdraw to any released one', () => {
  assert.equal(cadetReleaseAction({ status: null, cadetReleasedAt: null }), null);
  assert.equal(cadetReleaseAction({ status: 'ready', cadetReleasedAt: null }), null);
  assert.equal(cadetReleaseAction({ status: 'active', cadetReleasedAt: null }), null);
  assert.equal(cadetReleaseAction({ status: 'completed', cadetReleasedAt: null }), 'release');
  assert.equal(cadetReleaseAction({ status: 'completed', cadetReleasedAt: released }), 'withdraw');
  // Release is its own fact: a released exam stays withdrawable whatever its status says.
  assert.equal(cadetReleaseAction({ status: 'active', cadetReleasedAt: released.toISOString() }), 'withdraw');
});

test('remarks are editable after the start, in the active session, while not released', () => {
  assert.equal(isRemarkEditable(true, { status: 'active', cadetReleasedAt: null }), true);
  assert.equal(isRemarkEditable(true, { status: 'completed', cadetReleasedAt: null }), true);
  assert.equal(isRemarkEditable(true, { status: 'ready', cadetReleasedAt: null }), false);
  assert.equal(isRemarkEditable(true, { status: 'completed', cadetReleasedAt: released }), false);
  assert.equal(isRemarkEditable(false, { status: 'completed', cadetReleasedAt: null }), false);
  assert.equal(isRemarkEditable(true, undefined), false);
});

test('reopen is blocked with its reason only while released', () => {
  assert.equal(reopenBlockedReason({ status: 'completed', cadetReleasedAt: released }), 'Withdraw from Cadet Portal before reopening.');
  assert.equal(reopenBlockedReason({ status: 'completed', cadetReleasedAt: null }), null);
});

test('the release confirmation explains what students see and what it locks', () => {
  const release = examActionDescription('release', false);
  assert.match(release, /marks, grades, attendance, activities and teacher remarks/);
  assert.match(release, /cannot be reopened until you withdraw/);
  assert.match(examActionDescription('reopen', true), /Withdraw them from the Cadet Portal before reopening/);
  assert.equal(examActionLabel('release'), 'Release results to Cadet Portal');
  // The navbar uses short labels so they fit a phone.
  assert.equal(examActionLabel('release', true), 'Release to Cadet');
  assert.equal(examActionLabel('withdraw', true), 'Withdraw from Cadet');
  assert.equal(examActionLabel('reopen', true), 'Reopen examination');
});
