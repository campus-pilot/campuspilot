import { describe, expect, it } from 'vitest';

import { isOAuthRequestExpired, isSignedOAuthRequest } from './auth-client';

const NOW = Date.UTC(2026, 10, 8, 12, 0, 0);
const nowSeconds = NOW / 1000;

function query(params: Record<string, string>) {
  return new URLSearchParams(params);
}

describe('isSignedOAuthRequest', () => {
  it('is true only when the authorization server signed the query', () => {
    expect(isSignedOAuthRequest(query({ client_id: 'app', sig: 'signature' }))).toBe(true);
    expect(isSignedOAuthRequest(query({ client_id: 'app' }))).toBe(false);
    expect(isSignedOAuthRequest(query({}))).toBe(false);
  });
});

describe('isOAuthRequestExpired', () => {
  it('is expired once exp is in the past or exactly now', () => {
    expect(isOAuthRequestExpired(query({ sig: 's', exp: String(nowSeconds - 1) }), NOW)).toBe(true);
    expect(isOAuthRequestExpired(query({ sig: 's', exp: String(nowSeconds) }), NOW)).toBe(true);
  });

  it('is not expired while exp is in the future', () => {
    expect(isOAuthRequestExpired(query({ sig: 's', exp: String(nowSeconds + 600) }), NOW)).toBe(false);
  });

  it('leaves a missing or unreadable exp to the server', () => {
    for (const exp of [undefined, '', 'soon', '0', '-5', 'Infinity']) {
      const params = exp === undefined ? query({ sig: 's' }) : query({ sig: 's', exp });
      expect(isOAuthRequestExpired(params, NOW), `exp=${String(exp)}`).toBe(false);
    }
  });
});
