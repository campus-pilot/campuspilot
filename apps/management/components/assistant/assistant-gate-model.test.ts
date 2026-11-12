import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { resolveAssistantGate } from './assistant-gate-model';

const on = { status: 'ready', enabled: true } as const;

test('the gate is allowed only when the feature is on and the role may use it', () => {
  assert.equal(resolveAssistantGate(on, { isPending: false, allowed: true }), 'allowed');
  assert.equal(resolveAssistantGate(on, { isPending: false, allowed: false }), 'denied');
});

test('a feature that is off or unreadable denies without asking the role', () => {
  assert.equal(resolveAssistantGate({ status: 'ready', enabled: false }, { isPending: true, allowed: undefined }), 'denied');
  assert.equal(resolveAssistantGate({ status: 'unknown', enabled: false }, { isPending: false, allowed: undefined }), 'denied');
});

test('loading is pending, not denied', () => {
  assert.equal(resolveAssistantGate({ status: 'pending', enabled: false }, { isPending: true, allowed: undefined }), 'pending');
  assert.equal(resolveAssistantGate(on, { isPending: true, allowed: undefined }), 'pending');
});

test('a role answer that failed and was never held denies; a held answer survives a failed refetch', () => {
  assert.equal(resolveAssistantGate(on, { isPending: false, allowed: undefined }), 'denied');
  assert.equal(resolveAssistantGate(on, { isPending: false, allowed: true }), 'allowed');
});
