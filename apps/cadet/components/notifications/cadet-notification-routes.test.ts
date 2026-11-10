import { describe, expect, it } from 'vitest';

import { cadetRouteFromLink } from './cadet-notification-routes';

describe('cadetRouteFromLink', () => {
  it('opens a bill on the Fees screen, a payment on Fees and a result on its exam result screen', () => {
    expect(cadetRouteFromLink(new URLSearchParams('type=bill.issued&billId=fbill_1&sessionId=sess_1'))).toBe('/fees/fbill_1');
    expect(cadetRouteFromLink(new URLSearchParams('type=payment.received&paymentId=fpay_1&sessionId=sess_1'))).toBe('/fees');
    expect(
      cadetRouteFromLink(new URLSearchParams('type=exam.results_published&sessionId=sess_1&examSlug=half-yearly&studentId=stu_b&classId=cls7')),
    ).toBe('/results/stu_b.cls7.half-yearly');
  });

  it('encodes identifiers as one path segment', () => {
    expect(cadetRouteFromLink(new URLSearchParams('type=bill.issued&billId=a%2Fb&sessionId=s'))).toBe('/fees/a%2Fb');
  });

  it('opens the inbox for unknown, staff or incomplete links', () => {
    expect(cadetRouteFromLink(new URLSearchParams(''))).toBe('/notifications');
    expect(cadetRouteFromLink(new URLSearchParams('type=retired.type'))).toBe('/notifications');
    expect(cadetRouteFromLink(new URLSearchParams('type=billing.run_posted&billRunId=r&sessionId=s'))).toBe('/notifications');
    expect(cadetRouteFromLink(new URLSearchParams('type=bill.issued&billId=fbill_1'))).toBe('/notifications');
    expect(cadetRouteFromLink(new URLSearchParams('type=exam.results_published&sessionId=s&examSlug=final'))).toBe('/notifications');
  });
});
