import { auth } from '@campuspilot/auth/server';
import { normalizeApiKeyHeaders } from '@campuspilot/auth/api-key-headers';
import { db } from '@campuspilot/db';
import type { Context as HonoContext } from 'hono';

export type CreateContextOptions = {
  context: HonoContext;
};

/**
 * Creates the shared oRPC context from transport-neutral request headers.
 * Keeping session resolution here ensures cookies and user-owned API keys
 * produce the same authorization context for HTTP, RPC, OpenAPI, and MCP.
 */
export async function createContextFromHeaders(headers: Headers) {
  const normalizedHeaders = normalizeApiKeyHeaders(headers);
  let session = null;
  try {
    session = await auth.api.getSession({
      headers: normalizedHeaders,
    });
  } catch {
    session = null;
  }
  return {
    db,
    headers: normalizedHeaders,
    session,
  };
}

export async function createContext({ context }: CreateContextOptions) {
  return createContextFromHeaders(context.req.raw.headers);
}

export type Context = Awaited<ReturnType<typeof createContext>>;
