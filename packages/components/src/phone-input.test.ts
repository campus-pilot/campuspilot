import { describe, expect, it } from 'vitest';

import { phoneInputValueFromStored, phoneInputValueToE164, requiredPhoneInputSchema } from './phone-input';

describe('phone input values', () => {
  it('splits stored E.164 numbers into country and national number', () => {
    expect(phoneInputValueFromStored('+919876543210')).toEqual({ country: 'IN', number: '9876543210' });
    expect(phoneInputValueFromStored('+14155552671')).toEqual({ country: 'US', number: '4155552671' });
    expect(phoneInputValueFromStored(null)).toEqual({ country: 'IN', number: '' });
  });

  it('shows an unmigrated value as stored so staff can correct it', () => {
    expect(phoneInputValueFromStored('+91 ask at the office')).toEqual({ country: 'IN', number: '+91 ask at the office' });
    expect(phoneInputValueFromStored('98765 43210')).toEqual({ country: 'IN', number: '98765 43210' });
  });

  it('reads the typed number in the selected country unless it has its own code', () => {
    expect(phoneInputValueToE164({ country: 'IN', number: '98765 43210' })).toBe('+919876543210');
    expect(phoneInputValueToE164({ country: 'US', number: '(415) 555-2671' })).toBe('+14155552671');
    expect(phoneInputValueToE164({ country: 'US', number: '+91 98765 43210' })).toBe('+919876543210');
    expect(phoneInputValueToE164({ country: 'IN', number: '12345' })).toBeNull();
  });

  it('validates required numbers with field messages', () => {
    const schema = requiredPhoneInputSchema('Phone number is required.');
    expect(schema.parse({ country: 'IN', number: '9876543210' })).toBe('+919876543210');
    expect(schema.safeParse({ country: 'IN', number: '' }).error?.issues[0]?.message).toBe('Phone number is required.');
    expect(schema.safeParse({ country: 'IN', number: '123' }).error?.issues[0]?.message).toBe('Enter a valid phone number for the selected country.');
    expect(schema.safeParse({ country: 'XX', number: '9876543210' }).success).toBe(false);
  });
});
