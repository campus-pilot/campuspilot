import { describe, expect, it } from 'vitest';

import { changesOwnPhoneNumber } from '../staff-login-policy';

describe('changesOwnPhoneNumber', () => {
  it('refuses removing your own number, which the phone-number plugin lets through', () => {
    expect(changesOwnPhoneNumber('/update-user', { phoneNumber: null })).toBe(true);
  });

  it('refuses setting your own number', () => {
    expect(changesOwnPhoneNumber('/update-user', { phoneNumber: '+919876543210' })).toBe(true);
  });

  it('leaves other profile updates and other endpoints alone', () => {
    expect(changesOwnPhoneNumber('/update-user', { name: 'Asha' })).toBe(false);
    expect(changesOwnPhoneNumber('/update-user', undefined)).toBe(false);
    expect(changesOwnPhoneNumber('/admin/update-user', { phoneNumber: null })).toBe(false);
  });
});
