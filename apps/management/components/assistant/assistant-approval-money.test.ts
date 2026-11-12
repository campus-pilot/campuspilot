import assert from 'node:assert/strict';
import { test } from 'node:test';

import { approvalMoneyPlan, TOOL_MONEY } from './assistant-approval-money';

test('a payment discount and an adjustment use the currency their input names', () => {
  assert.deepEqual(approvalMoneyPlan('school.recordPaymentWithDiscount', { currency: 'INR', sessionId: 'ses_1' }), {
    inputCurrency: 'INR',
    lookupSessionId: undefined,
    moneyMaps: undefined,
  });
  assert.equal(approvalMoneyPlan('school.recordAdjustment', { currency: 'USD' }).inputCurrency, 'USD');
});

test('manual bills, billing runs and admission fee values look up the session currency', () => {
  assert.deepEqual(approvalMoneyPlan('school.createManualBill', { sessionId: 'ses_1' }), {
    inputCurrency: undefined,
    lookupSessionId: 'ses_1',
    moneyMaps: undefined,
  });
  assert.deepEqual(approvalMoneyPlan('school.postBillingRun', { sessionId: 'ses_1', currency: 'USD' }), {
    // A run's input has no currency of its own; a stray field is not trusted.
    inputCurrency: undefined,
    lookupSessionId: 'ses_1',
    moneyMaps: [['runValues', 'session'], ['runValues', 'classes', '*']],
  });
  assert.deepEqual(approvalMoneyPlan('school.updateAdmissionFinanceValues', { sessionId: 'ses_1' }).moneyMaps, [['values']]);
});

test('a session finance update prefers the currency it writes, else the session lookup', () => {
  assert.deepEqual(
    approvalMoneyPlan('school.updateSessionFinance', { sessionId: 'ses_1', financeConfig: { currency: 'INR' } }),
    { inputCurrency: 'INR', lookupSessionId: undefined, moneyMaps: [['classOverrides', '*']] },
  );
  assert.deepEqual(approvalMoneyPlan('school.updateSessionFinance', { sessionId: 'ses_1', classOverrides: {} }), {
    inputCurrency: undefined,
    lookupSessionId: 'ses_1',
    moneyMaps: [['classOverrides', '*']],
  });
});

test('tools not declared, refunds included, get no currency and no money maps', () => {
  assert.equal(TOOL_MONEY['school.recordRefund'], undefined);
  assert.deepEqual(approvalMoneyPlan('school.recordRefund', { sessionId: 'ses_1', amountMinor: '100' }), {});
  assert.deepEqual(approvalMoneyPlan('school.updateStudent', { sessionId: 'ses_1' }), {});
});
