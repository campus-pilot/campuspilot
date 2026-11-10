'use client';

import { CADET_AUTH_BASE_PATH } from '@campuspilot/auth/cadet-policy';
import { env } from '@campuspilot/env/cadet.client';
import { oauthProviderClient } from '@better-auth/oauth-provider/client';
import { createAuthClient } from 'better-auth/react';

const baseURL = new URL(CADET_AUTH_BASE_PATH, env.NEXT_PUBLIC_SERVER_URL).toString();

/** Client of the cadet Better Auth instance (`cpc_` cookies). */
export const authClient = createAuthClient({ baseURL });

/**
 * Auth client for a sign-in that an AI app's authorization sent the student
 * to. Its plugin forwards the authorization server's signed query from the
 * page URL with each request, which is how Better Auth resumes the
 * authorization after sign-in. Kept separate because it attaches the page
 * query to every non-GET request, which other requests must not send.
 */
export const oauthAuthClient = createAuthClient({
  baseURL,
  plugins: [oauthProviderClient()],
});

/** True when the authorization server opened the page with its signed query. */
export function isSignedOAuthRequest(searchParams: URLSearchParams): boolean {
  return searchParams.has('sig');
}

/**
 * True when the signed query's `exp` (Unix seconds) is at or before `now`
 * (ms). Better Auth signs the authorize query with
 * `exp = issuedAt + codeExpiresIn` and refuses it after that, so a sign-in
 * with it can only fail. A query without a readable `exp` is not treated as
 * expired; the server stays the authority.
 */
export function isOAuthRequestExpired(searchParams: URLSearchParams, now: number): boolean {
  const exp = Number(searchParams.get('exp'));
  return Number.isFinite(exp) && exp > 0 && exp * 1000 <= now;
}

/** Better Auth answers OAuth-flow requests with the next URL to open. */
export function oauthRedirectUrl(data: unknown): string | null {
  const url = (data as { url?: unknown } | null)?.url;
  return typeof url === 'string' ? url : null;
}
