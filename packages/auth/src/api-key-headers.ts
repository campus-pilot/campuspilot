const API_KEY_HEADER = 'x-api-key';

/**
 * Returns cloned headers where a bearer credential is also available through
 * Better Auth's API-key header. An explicit x-api-key value always wins.
 */
export function normalizeApiKeyHeaders(headers: Headers): Headers {
  const normalized = new Headers(headers);

  if (!normalized.has(API_KEY_HEADER)) {
    const authorization = normalized.get('authorization');
    const match = authorization
      ? /^\s*Bearer\s+(.+?)\s*$/i.exec(authorization)
      : null;

    if (match?.[1]) normalized.set(API_KEY_HEADER, match[1]);
  }

  return normalized;
}

/** Creates a normalized request without consuming or mutating the original. */
export function normalizeApiKeyRequest(request: Request): Request {
  return new Request(request.clone(), {
    headers: normalizeApiKeyHeaders(request.headers),
  });
}
