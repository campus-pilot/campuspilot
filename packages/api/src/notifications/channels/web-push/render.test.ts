import { describe, expect, it } from 'vitest';

import { formatMinorAmount, formatPeriodKey } from '../format';
import { parseRetryAfter } from '../retry-after';
import { isAllowedPushEndpoint } from './endpoints';
import { renderWebPushMessage } from './render';

describe('web push rendering', () => {
  it('names the student and links to the open page with identifiers only', () => {
    const message = renderWebPushMessage('ntf_1', 'bill.issued', {
      billId: 'fbill_1',
      sessionId: 'sess_1',
      admissionId: 'adm_1',
      billNumber: 'BILL/1',
      totalAmountMinor: '250000',
      currency: 'INR',
      issueDate: '2026-10-01',
      studentName: 'Meera Singh',
      periodKey: '2026-10',
    });
    expect(message).toEqual({
      title: 'New bill for Meera Singh',
      body: '₹2,500.00 for October 2026 (bill BILL/1).',
      url: '/notifications/open?type=bill.issued&billId=fbill_1&sessionId=sess_1',
      tag: 'ntf_1',
    });
    expect(message!.url).not.toContain('Meera');
    expect(renderWebPushMessage('ntf_2', 'billing.run_posted', { billRunId: 'x', sessionId: 's', periodKey: 'p', billCount: 1 })).toBeNull();
  });

  it('formats exact minor amounts in Indian grouping', () => {
    expect(formatMinorAmount('1234567805', 'INR')).toBe('₹1,23,45,678.05');
    expect(formatMinorAmount('5', 'INR')).toBe('₹0.05');
    expect(formatMinorAmount('1500', 'JPY')).toBe('JP¥1,500');
    expect(formatMinorAmount('12', 'XXX')).toBe('XXX 12');
    expect(formatPeriodKey('2026-03')).toBe('March 2026');
    expect(formatPeriodKey('term-1')).toBe('term-1');
  });
});

describe('push endpoint allowlist', () => {
  it('accepts the browser push services and nothing else', () => {
    expect(isAllowedPushEndpoint('https://fcm.googleapis.com/fcm/send/abc')).toBe(true);
    expect(isAllowedPushEndpoint('https://updates.push.services.mozilla.com/wpush/v2/abc')).toBe(true);
    expect(isAllowedPushEndpoint('https://web.push.apple.com/abc')).toBe(true);
    expect(isAllowedPushEndpoint('https://wns2-db5p.notify.windows.com/w/?token=abc')).toBe(true);
    expect(isAllowedPushEndpoint('https://localhost/abc')).toBe(false);
    expect(isAllowedPushEndpoint('https://evilfcm.googleapis.com.attacker.test/abc')).toBe(false);
    expect(isAllowedPushEndpoint('https://user:pw@fcm.googleapis.com/abc')).toBe(false);
    expect(isAllowedPushEndpoint('not a url')).toBe(false);
  });
});

describe('Retry-After', () => {
  it('reads seconds and HTTP dates and caps long waits', () => {
    expect(parseRetryAfter('120')).toBe(120_000);
    expect(parseRetryAfter(new Date(1_000_000 + 30_000).toUTCString(), 1_000_000)).toBe(30_000);
    expect(parseRetryAfter('999999')).toBe(6 * 60 * 60 * 1000);
    expect(parseRetryAfter(null)).toBeUndefined();
    expect(parseRetryAfter('soon')).toBeUndefined();
  });
});
