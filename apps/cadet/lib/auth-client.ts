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

/** Better Auth answers OAuth-flow requests with the next URL to open. */
export function oauthRedirectUrl(data: unknown): string | null {
  const url = (data as { url?: unknown } | null)?.url;
  return typeof url === 'string' ? url : null;
}
