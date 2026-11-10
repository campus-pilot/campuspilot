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

  it('opens a notice on its own screen, and the inbox when the notice is not named', () => {
    expect(cadetRouteFromLink(new URLSearchParams('type=notice.published&noticeId=ntc_1'))).toBe('/notices/ntc_1');
    expect(cadetRouteFromLink(new URLSearchParams('type=notice.published&noticeId=a%2Fb'))).toBe('/notices/a%2Fb');
    expect(cadetRouteFromLink(new URLSearchParams('type=notice.published'))).toBe('/notifications');
    // The staff copy of a notice is not a Cadet Portal link.
    expect(cadetRouteFromLink(new URLSearchParams('type=notice.published_staff&noticeId=ntc_1&sessionId=s'))).toBe('/notifications');
  });

  it('opens a published timetable from its session and exam', () => {
    expect(cadetRouteFromLink(new URLSearchParams('type=exam.timetable_published&sessionId=sess_1&examSlug=half-yearly'))).toBe(
      '/timetables/sess_1/half-yearly',
    );
    expect(cadetRouteFromLink(new URLSearchParams('type=exam.timetable_published&sessionId=sess_1'))).toBe('/notifications');
    expect(cadetRouteFromLink(new URLSearchParams('type=exam.timetable_published_staff&sessionId=sess_1&examSlug=x'))).toBe('/notifications');
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
