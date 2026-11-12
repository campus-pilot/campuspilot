import { describe, expect, it } from 'vitest';

import { describeError } from './error-detail';

class FakeApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

describe('describeError', () => {
  it('unwraps the Gemini body and keeps the HTTP status', () => {
    const message = JSON.stringify({
      error: { message: JSON.stringify({ error: { code: 400, message: 'Request contains an invalid argument.', status: 'INVALID_ARGUMENT' } }), code: 400, status: 'Bad Request' },
    });
    expect(describeError(new FakeApiError(message, 400))).toBe('ApiError HTTP 400 INVALID_ARGUMENT: Request contains an invalid argument.');
  });

  it('unwraps the Anthropic body and keeps the request id', () => {
    const message = `400 ${JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'output_config.format.schema: too complex' }, request_id: 'req_011' })}`;
    expect(describeError(new FakeApiError(message, 400))).toBe('ApiError HTTP 400 invalid_request_error: output_config.format.schema: too complex (request req_011)');
  });

  it('falls back to the plain message and cuts database parameters', () => {
    expect(describeError(new Error('insert failed\nparams: secret-row-value'))).toBe('Error: insert failed');
    expect(describeError('plain')).toBe('plain');
  });
});
