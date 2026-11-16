import assert from 'node:assert/strict';
import { test } from 'node:test';
import { permissionGateState } from './require-permissions-model';

test('a check with no answer yet is pending, not denied', () => {
  // What the gate renders for each state is tested in require-permissions.test.tsx.
  assert.equal(permissionGateState({ isPending: true, isError: false, results: undefined }, 1), 'pending');
  assert.equal(permissionGateState({ isPending: true, isError: false, results: undefined }, 2, 'any'), 'pending');
});

test('an answered check is granted or denied by the all/any policy', () => {
  assert.equal(permissionGateState({ isPending: false, isError: false, results: [true, true] }, 2), 'granted');
  assert.equal(permissionGateState({ isPending: false, isError: false, results: [true, false] }, 2), 'denied');
  assert.equal(permissionGateState({ isPending: false, isError: false, results: [true, false] }, 2, 'any'), 'granted');
  assert.equal(permissionGateState({ isPending: false, isError: false, results: [false, false] }, 2, 'any'), 'denied');
});

test('a failed check fails closed only when no answer is held', () => {
  assert.equal(permissionGateState({ isPending: false, isError: true, results: undefined }, 1), 'denied');
  assert.equal(permissionGateState({ isPending: false, isError: true, results: [true] }, 1), 'granted');
});

test('an incomplete answer is denied', () => {
  assert.equal(permissionGateState({ isPending: false, isError: false, results: [true] }, 2), 'denied');
});
