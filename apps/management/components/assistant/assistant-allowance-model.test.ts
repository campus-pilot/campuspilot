import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { allowanceWarningOf } from './assistant-allowance-model';

/** 17 December in IST (the window ends at the start of that day). */
const resetsAt = new Date('2026-12-16T18:30:00Z');
const at = (usedPercent: number, available = true) => ({ available, allowance: { usedPercent, resetsAt } });

test('warns from 80% of the allowance, with the share and the reset date, never an amount', () => {
  assert.equal(allowanceWarningOf(at(84.6)), 'You’ve used 84% of this period’s AI allowance. It resets on 17 Dec.');
  assert.equal(allowanceWarningOf(at(80)), 'You’ve used 80% of this period’s AI allowance. It resets on 17 Dec.');
  assert.equal(allowanceWarningOf(at(99.9)), 'You’ve used 99% of this period’s AI allowance. It resets on 17 Dec.');
});

test('says nothing below 80%, at the limit (the composer is closed with the refusal) or while sending is unavailable', () => {
  assert.equal(allowanceWarningOf(at(79.9)), null);
  assert.equal(allowanceWarningOf(at(100, false)), null);
  assert.equal(allowanceWarningOf(at(100)), null);
  assert.equal(allowanceWarningOf(at(90, false)), null);
});

test('says nothing for a school without a limit or before the status is known', () => {
  assert.equal(allowanceWarningOf({ available: true, allowance: null }), null);
  assert.equal(allowanceWarningOf(undefined), null);
});
