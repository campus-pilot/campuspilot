import { describe, expect, it } from 'vitest';
import {
  buildAuthCallbackURL,
  buildAuthErrorPath,
  buildSignInRedirectPath,
  sanitizeAuthRedirectPath,
} from '../redirects';

describe('authentication redirects', () => {
  it('preserves an internal deep link', () => {
    expect(sanitizeAuthRedirectPath('/reports/42?tab=fees#late')).toBe(
      '/reports/42?tab=fees#late',
    );
  });

  it.each([
    'https://evil.example/path',
    '//evil.example/path',
    '/\\evil.example/path',
    '/%2f%2fevil.example/path',
  ])('rejects unsafe redirect path %s', (value) => {
    expect(sanitizeAuthRedirectPath(value)).toBe('/dashboard');
  });

  it('carries the return path through the sign-in URL', () => {
    expect(buildSignInRedirectPath('/reports/42?tab=fees')).toBe(
      '/sign-in?redirect=%2Freports%2F42%3Ftab%3Dfees',
    );
  });

  it('builds an absolute callback on the frontend origin', () => {
    expect(
      buildAuthCallbackURL(
        'http://localhost:3003',
        '/reports/42?tab=fees',
      ),
    ).toBe('http://localhost:3003/reports/42?tab=fees');
  });

  it('routes provider errors through the auth error screen', () => {
    expect(buildAuthErrorPath('/reports/42?tab=fees')).toBe(
      '/auth/error?redirect=%2Freports%2F42%3Ftab%3Dfees',
    );
  });
});
