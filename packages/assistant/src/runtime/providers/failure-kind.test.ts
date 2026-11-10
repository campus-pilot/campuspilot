import Anthropic from '@anthropic-ai/sdk';
import { ApiError } from '@google/genai';
import { describe, expect, it } from 'vitest';

import { anthropicFailureKind } from './anthropic';
import { geminiFailureKind } from './gemini';

/**
 * How each adapter classifies a failed model request. The errors are built
 * the way the SDKs build them, so the classification is tested against the
 * classes a real request throws.
 */

/**
 * An Anthropic API error for an HTTP status, through the factory the SDK
 * itself uses on a response (`APIError.generate`), which picks the subclass.
 */
function anthropicStatusError(status: number, type: string) {
  const message = `${type}: test`;
  return Anthropic.APIError.generate(status, { type: 'error', error: { type, message } }, message, new Headers());
}

describe('anthropicFailureKind', () => {
  it('treats a 400 as rejected', () => {
    const error = anthropicStatusError(400, 'invalid_request_error');
    expect(error).toBeInstanceOf(Anthropic.BadRequestError);
    expect(anthropicFailureKind(error)).toBe('rejected');
  });

  it.each([
    [401, 'authentication_error'],
    [403, 'permission_error'],
    [404, 'not_found_error'],
  ])('treats a %i as unavailable', (status, type) => {
    expect(anthropicFailureKind(anthropicStatusError(status, type))).toBe('unavailable');
  });

  it.each([
    [429, 'rate_limit_error'],
    [503, 'api_error'],
    [529, 'overloaded_error'],
  ])('treats a %i as busy', (status, type) => {
    expect(anthropicFailureKind(anthropicStatusError(status, type))).toBe('busy');
  });

  it('treats a network error as unknown', () => {
    // What the SDK throws when the request never got a response.
    expect(anthropicFailureKind(new Anthropic.APIConnectionError({ message: 'Connection error.' }))).toBe('unknown');
    expect(anthropicFailureKind(new Anthropic.APIConnectionTimeoutError())).toBe('unknown');
    // `generate` without a status is the same connection error.
    expect(anthropicFailureKind(Anthropic.APIError.generate(undefined, undefined, 'fetch failed', undefined))).toBe('unknown');
    expect(anthropicFailureKind(new TypeError('fetch failed'))).toBe('unknown');
  });

  it('treats other statuses and foreign errors as unknown', () => {
    expect(anthropicFailureKind(anthropicStatusError(500, 'api_error'))).toBe('unknown');
    expect(anthropicFailureKind(anthropicStatusError(413, 'request_too_large'))).toBe('unknown');
    // A status on an error that is not the SDK's says nothing about the Claude API.
    expect(anthropicFailureKind(Object.assign(new Error('rate limited'), { status: 429 }))).toBe('unknown');
    expect(anthropicFailureKind('boom')).toBe('unknown');
  });
});

/** A Gemini API error as `@google/genai` throws it for a non-OK response. */
const geminiStatusError = (status: number) =>
  new ApiError({ status, message: JSON.stringify({ error: { code: status, message: 'test', status: 'TEST' } }) });

describe('geminiFailureKind', () => {
  it('treats a 400 as rejected', () => {
    expect(geminiFailureKind(geminiStatusError(400))).toBe('rejected');
  });

  it.each([401, 403, 404])('treats a %i as unavailable', (status) => {
    expect(geminiFailureKind(geminiStatusError(status))).toBe('unavailable');
  });

  it.each([429, 503])('treats a %i as busy', (status) => {
    expect(geminiFailureKind(geminiStatusError(status))).toBe('busy');
  });

  it('treats a network error as unknown', () => {
    // fetch rejects with a TypeError when no response arrives; the SDK lets it through.
    expect(geminiFailureKind(new TypeError('fetch failed'))).toBe('unknown');
  });

  it('treats other statuses and foreign errors as unknown', () => {
    expect(geminiFailureKind(geminiStatusError(500))).toBe('unknown');
    expect(geminiFailureKind(geminiStatusError(529))).toBe('unknown');
    expect(geminiFailureKind(Object.assign(new Error('rate limited'), { status: 429 }))).toBe('unknown');
  });
});
