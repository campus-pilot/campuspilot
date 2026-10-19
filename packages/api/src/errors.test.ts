import { describe, expect, it } from 'vitest';

import { rpcError, rpcErrorResponse, toRpcError } from './errors';

describe('RPC errors', () => {
  it.each([
    ['badRequest', rpcError.badRequest('Bad input'), 'BAD_REQUEST', 400],
    ['unauthorized', rpcError.unauthorized(), 'UNAUTHORIZED', 401],
    ['forbidden', rpcError.forbidden('Denied'), 'FORBIDDEN', 403],
    ['notFound', rpcError.notFound('Student'), 'NOT_FOUND', 404],
    ['conflict', rpcError.conflict('Duplicate'), 'CONFLICT', 409],
    [
      'payloadTooLarge',
      rpcError.payloadTooLarge('Too large'),
      'PAYLOAD_TOO_LARGE',
      413,
    ],
    [
      'unsupportedMediaType',
      rpcError.unsupportedMediaType('Wrong type'),
      'UNSUPPORTED_MEDIA_TYPE',
      415,
    ],
    [
      'internal',
      rpcError.internal(new Error('private')),
      'INTERNAL_SERVER_ERROR',
      500,
    ],
  ])('%s creates a stable code and HTTP status', (_name, error, code, status) => {
    expect(error).toMatchObject({ code, status });
  });

  it('formats resource-specific not-found messages', () => {
    expect(rpcError.notFound('School session').message).toBe(
      'School session was not found.',
    );
  });

  it('returns an existing ORPC error unchanged', () => {
    const original = rpcError.badRequest('Keep this error');

    expect(toRpcError(original)).toBe(original);
  });

  it('converts direct PostgreSQL unique violations into conflicts', () => {
    const databaseError = { code: '23505', constraint: 'school_slug_unique' };

    expect(toRpcError(databaseError)).toMatchObject({
      code: 'CONFLICT',
      status: 409,
      message: 'A resource with those unique values already exists.',
      cause: databaseError,
    });
  });

  it('finds a PostgreSQL unique violation through nested causes', () => {
    const databaseError = { code: '23505', constraint: 'student_roll_unique' };
    const wrapped = new Error('query failed', {
      cause: { code: 'DRIZZLE_QUERY_ERROR', cause: databaseError },
    });

    expect(toRpcError(wrapped)).toMatchObject({
      code: 'CONFLICT',
      cause: databaseError,
    });
  });

  it.each(['40001', '40P01'])(
    'maps retryable PostgreSQL concurrency failure %s to conflict',
    (code) => {
      const databaseError = { code };
      const wrapped = new Error('query failed', { cause: databaseError });

      expect(toRpcError(wrapped)).toMatchObject({
        code: 'CONFLICT',
        status: 409,
        message:
          'The operation conflicted with another finance update. Retry the same idempotent command.',
        cause: databaseError,
      });
    },
  );

  it('keeps non-unique database errors private as internal failures', () => {
    const databaseError = { code: '23503', detail: 'private database detail' };

    expect(toRpcError(databaseError)).toMatchObject({
      code: 'INTERNAL_SERVER_ERROR',
      status: 500,
      message: 'An unexpected server error occurred.',
      cause: databaseError,
    });
  });

  it('terminates safely when an error cause chain is cyclic', () => {
    const cyclic: { code: string; cause?: unknown } = { code: 'WRAPPED' };
    cyclic.cause = cyclic;

    expect(toRpcError(cyclic)).toMatchObject({
      code: 'INTERNAL_SERVER_ERROR',
      cause: cyclic,
    });
  });

  it('serializes only the public code and message in HTTP responses', async () => {
    const response = rpcErrorResponse(
      rpcError.conflict('Already exists', new Error('private detail')),
    );

    expect(response.status).toBe(409);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(await response.json()).toEqual({
      code: 'CONFLICT',
      message: 'Already exists',
    });
  });

  it('normalizes unknown HTTP handler failures before responding', async () => {
    const response = rpcErrorResponse(new Error('database credentials'));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected server error occurred.',
    });
  });
});
