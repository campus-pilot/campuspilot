import { describe, expect, it } from 'vitest';

import { phoneSearchDigits } from './admission-phone-search';

describe('admission phone search', () => {
  it('reduces phone-like queries to their digits without a trunk 0', () => {
    expect(phoneSearchDigits('98765 43210')).toBe('9876543210');
    expect(phoneSearchDigits('098765 43210')).toBe('9876543210');
    expect(phoneSearchDigits('+91 98765-43210')).toBe('919876543210');
    expect(phoneSearchDigits('(0) 98765')).toBe('98765');
  });

  it('leaves names, admission numbers and short numbers to the text match', () => {
    expect(phoneSearchDigits('Clara')).toBeNull();
    expect(phoneSearchDigits('ADM/2026/12')).toBeNull();
    expect(phoneSearchDigits('12')).toBeNull();
    expect(phoneSearchDigits('000')).toBeNull();
  });
});
