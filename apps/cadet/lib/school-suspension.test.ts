import { describe, expect, it } from 'vitest';

import { CADET_SCHOOL_SUSPENDED_MESSAGE, suspendedOr } from './school-suspension';

describe('suspendedOr', () => {
  it('says the school is suspended for the server\'s suspended-school refusal only', () => {
    const suspended = Object.assign(new Error('This school is suspended. Contact CampusPilot support.'), {
      code: 'FORBIDDEN',
      data: { reason: 'SCHOOL_SUSPENDED' },
    });
    expect(suspendedOr(suspended, 'Try again.')).toBe(CADET_SCHOOL_SUSPENDED_MESSAGE);
    // A switched-off feature, a plain refusal and a network failure keep the screen's own words.
    expect(suspendedOr({ code: 'FORBIDDEN', data: { reason: 'SCHOOL_FEATURE_DISABLED', feature: 'cadet' } }, 'Try again.')).toBe('Try again.');
    expect(suspendedOr({ code: 'FORBIDDEN' }, 'Try again.')).toBe('Try again.');
    expect(suspendedOr(new Error('Failed to fetch'), 'Try again.')).toBe('Try again.');
  });
});
