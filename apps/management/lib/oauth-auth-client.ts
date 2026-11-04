'use client';

import { env } from '@campuspilot/env/management.client';
import { oauthProviderClient } from '@better-auth/oauth-provider/client';
import { createAuthClient } from 'better-auth/react';
import { inferAdditionalFields } from 'better-auth/client/plugins';
import type { auth } from '@campuspilot/auth/server';

/**
 * Auth client for the pages that take part in an OAuth authorization (sign-in
 * and consent). Its plugin forwards the authorization server's signed query
 * from the page URL with each request, which is how Better Auth resumes the
 * authorization after sign-in and binds the consent decision. It is kept
 * separate from `authClient` because the plugin attaches the page query to
 * every non-GET request, which other pages must not send.
 */
export const oauthAuthClient = createAuthClient({
  baseURL: new URL('/api/auth', env.NEXT_PUBLIC_SERVER_URL).toString(),
  plugins: [oauthProviderClient(), inferAdditionalFields<typeof auth>()],
});

/**
 * True when the page was opened by the authorization server with its signed
 * OAuth query (Better Auth signs it with `sig`); the server verifies it.
 */
export function isSignedOAuthRequest(searchParams: URLSearchParams): boolean {
  return searchParams.has('sig');
}

/** Better Auth answers OAuth-flow requests with the next URL to open. */
export function oauthRedirectUrl(data: unknown): string | null {
  const url = (data as { url?: unknown } | null)?.url;
  return typeof url === 'string' ? url : null;
}
