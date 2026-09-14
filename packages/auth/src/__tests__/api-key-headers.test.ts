import { describe, expect, it } from 'vitest';

import {
  normalizeApiKeyHeaders,
  normalizeApiKeyRequest,
} from '../api-key-headers';

describe('API-key header normalization', () => {
  it('makes bearer API keys available through x-api-key', () => {
    const original = new Headers({ authorization: 'Bearer cp_bearer_key' });

    const normalized = normalizeApiKeyHeaders(original);

    expect(normalized.get('authorization')).toBe('Bearer cp_bearer_key');
    expect(normalized.get('x-api-key')).toBe('cp_bearer_key');
    expect(original.has('x-api-key')).toBe(false);
  });

  it('preserves an explicitly supplied x-api-key', () => {
    const normalized = normalizeApiKeyHeaders(
      new Headers({
        authorization: 'Bearer cp_bearer_key',
        'x-api-key': 'cp_explicit_key',
      }),
    );

    expect(normalized.get('x-api-key')).toBe('cp_explicit_key');
  });

  it.each([undefined, '', 'Basic abc', 'Bearer   '])(
    'ignores missing or malformed bearer authorization %s',
    (authorization) => {
      const headers = new Headers();
      if (authorization !== undefined) {
        headers.set('authorization', authorization);
      }

      expect(normalizeApiKeyHeaders(headers).has('x-api-key')).toBe(false);
    },
  );

  it('clones requests without consuming or mutating their bodies', async () => {
    const original = new Request('http://localhost/rpc/example', {
      method: 'POST',
      headers: { authorization: 'Bearer cp_request_key' },
      body: '{"value":true}',
    });

    const normalized = normalizeApiKeyRequest(original);

    expect(normalized).not.toBe(original);
    expect(normalized.headers.get('x-api-key')).toBe('cp_request_key');
    expect(original.headers.has('x-api-key')).toBe(false);
    expect(await normalized.text()).toBe('{"value":true}');
    expect(await original.text()).toBe('{"value":true}');
  });
});
