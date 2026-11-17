import { describe, expect, it } from 'vitest';

import { CADET_SCHOOL_NO_PLAN_MESSAGE, CADET_SCHOOL_SUSPENDED_MESSAGE, readOnlyOr, readOnlySchoolReason } from './read-only-school';

describe('readOnlyOr', () => {
  it('says why the school is read-only for the server\'s suspended-school and no-plan refusals only', () => {
    const suspended = Object.assign(new Error('This school is suspended. Contact CampusPilot support.'), {
      code: 'FORBIDDEN',
      data: { reason: 'SCHOOL_SUSPENDED' },
    });
    expect(readOnlyOr(suspended, 'Try again.')).toBe(CADET_SCHOOL_SUSPENDED_MESSAGE);
    expect(readOnlyOr({ code: 'FORBIDDEN', data: { reason: 'SCHOOL_NO_PLAN' } }, 'Try again.')).toBe(CADET_SCHOOL_NO_PLAN_MESSAGE);
    // A switched-off feature, a plain refusal and a network failure keep the screen's own words.
    expect(readOnlyOr({ code: 'FORBIDDEN', data: { reason: 'SCHOOL_FEATURE_DISABLED', feature: 'cadet' } }, 'Try again.')).toBe('Try again.');
    expect(readOnlyOr({ code: 'FORBIDDEN' }, 'Try again.')).toBe('Try again.');
    expect(readOnlyOr(new Error('Failed to fetch'), 'Try again.')).toBe('Try again.');
  });
});

describe('readOnlySchoolReason', () => {
  it('is the suspension when the school is suspended, else the missing plan, else nothing', () => {
    expect(readOnlySchoolReason({ isSuspended: false, hasActivePlan: true })).toBeNull();
    expect(readOnlySchoolReason({ isSuspended: false, hasActivePlan: false })).toBe('SCHOOL_NO_PLAN');
    expect(readOnlySchoolReason({ isSuspended: true, hasActivePlan: false })).toBe('SCHOOL_SUSPENDED');
  });
});
