import { describe, expect, it } from 'vitest';

import { shouldRetryQuery } from './query-retry';

describe('shouldRetryQuery', () => {
  it('never retries a client error', () => {
    expect(shouldRetryQuery(0, { status: 404, code: 'NOT_FOUND' })).toBe(false);
    expect(shouldRetryQuery(0, { status: 401 })).toBe(false);
  });

  it('retries server and network failures up to three times', () => {
    expect(shouldRetryQuery(0, { status: 503 })).toBe(true);
    expect(shouldRetryQuery(2, new TypeError('Failed to fetch'))).toBe(true);
    expect(shouldRetryQuery(3, new TypeError('Failed to fetch'))).toBe(false);
  });
});
