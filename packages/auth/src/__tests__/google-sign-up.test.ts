import { describe, expect, it, vi } from 'vitest';

import { afterUserCreated, isGoogleSignUpEndpoint, registerGoogleSignUpHandler } from '../google-sign-up';

/** What decides whether a new user gets a personal space (docs/personal-space.md). */
describe('isGoogleSignUpEndpoint', () => {
  it('is the Google OAuth callback and the Google ID token sign-in', () => {
    expect(isGoogleSignUpEndpoint({ path: '/callback/:id', params: { id: 'google' } })).toBe(true);
    expect(isGoogleSignUpEndpoint({ path: '/callback/google' })).toBe(true);
    expect(isGoogleSignUpEndpoint({ path: '/sign-in/social', body: { provider: 'google', idToken: { token: 'x' } } })).toBe(true);
  });

  it('is not an invitation, the demo seed, an email sign-up, another provider or no endpoint', () => {
    // `school.inviteMember` and the demo seed create users through the admin plugin.
    expect(isGoogleSignUpEndpoint({ path: '/admin/create-user', body: { email: 'teacher@school.in' } })).toBe(false);
    expect(isGoogleSignUpEndpoint({ path: '/sign-up/email', body: { email: 'a@b.c' } })).toBe(false);
    expect(isGoogleSignUpEndpoint({ path: '/callback/:id', params: { id: 'github' } })).toBe(false);
    expect(isGoogleSignUpEndpoint({ path: '/sign-in/social', body: { provider: 'apple' } })).toBe(false);
    expect(isGoogleSignUpEndpoint(null)).toBe(false);
    expect(isGoogleSignUpEndpoint(undefined)).toBe(false);
  });
});

describe('afterUserCreated', () => {
  it('runs the registered handler only for a Google sign-up, and never fails the sign-in', async () => {
    const handler = vi.fn(async () => {
      throw new Error('boom');
    });
    registerGoogleSignUpHandler(handler);
    await afterUserCreated('u1', { path: '/admin/create-user' });
    expect(handler).not.toHaveBeenCalled();
    await expect(afterUserCreated('u2', { path: '/callback/:id', params: { id: 'google' } })).resolves.toBeUndefined();
    expect(handler).toHaveBeenCalledWith('u2');
  });
});
