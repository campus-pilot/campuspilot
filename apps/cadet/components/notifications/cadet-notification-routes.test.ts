import { describe, expect, it } from 'vitest';

import { cadetRouteFromLink } from './cadet-notification-routes';

describe('cadetRouteFromLink', () => {
  it('opens the inbox for known types without a page of their own yet', () => {
    expect(cadetRouteFromLink(new URLSearchParams('type=bill.issued&billId=fbill_1&sessionId=sess_1'))).toBe('/notifications');
  });

  it('opens the inbox for unknown, staff or incomplete links', () => {
    expect(cadetRouteFromLink(new URLSearchParams(''))).toBe('/notifications');
    expect(cadetRouteFromLink(new URLSearchParams('type=retired.type'))).toBe('/notifications');
    expect(cadetRouteFromLink(new URLSearchParams('type=billing.run_posted&billRunId=r&sessionId=s'))).toBe('/notifications');
    expect(cadetRouteFromLink(new URLSearchParams('type=bill.issued&billId=fbill_1'))).toBe('/notifications');
  });
});
