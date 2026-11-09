import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { cadetReleaseAction, isRemarkEditable } from './exam-model';

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
