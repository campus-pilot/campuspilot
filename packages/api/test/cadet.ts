import { cadetAuth, cadetOauthIssuer } from '@campuspilot/auth/cadet';
import { verifyMcpAccessToken } from '@campuspilot/auth/mcp-credential';
import { env } from '@campuspilot/env/server';
import { createRouterClient } from '@orpc/server';
import { createHash, randomBytes } from 'node:crypto';

import { createCadetContextFromHeaders } from '../src/cadet/context';
import { cadetRouter, type CadetRouterClient } from '../src/routers/cadet/cadet.router';

/** Requests reach the cadet instance as the API server would receive them. */
const CADET_AUTH_URL = `${env.BETTER_AUTH_URL}/api/cadet/auth`;
const CADET_ORIGIN = new URL(env.CADET_APP_URL).origin;

export type CadetCredentials = {
  schoolSlug: string;
  admissionNo: string;
  password: string;
};

export function cookiesOf(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0])
    .join('; ');
}

/**
 * A per-call client address, so the per-IP failure limit (shared Redis) of
 * one test never locks out another.
 */
function testClientIp() {
  return `198.51.100.${1 + Math.floor(Math.random() * 250)}`;
}

/** Posts the Cadet Portal sign-in form; returns the response and its cookies. */
export async function signInCadet(
  credentials: CadetCredentials,
  extraBody: Record<string, unknown> = {},
  ip = testClientIp(),
) {
  const response = await cadetAuth.handler(
    new Request(`${CADET_AUTH_URL}/sign-in/admission`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: CADET_ORIGIN, 'x-forwarded-for': ip },
      body: JSON.stringify({ ...credentials, ...extraBody }),
    }),
  );
  return { response, cookie: cookiesOf(response) };
}

/** A cadet router client authenticated by exactly the given request headers. */
export function createCadetTestClient(headers: Headers): CadetRouterClient {
  return createRouterClient(cadetRouter, {
    context: async () => createCadetContextFromHeaders(headers),
  });
}

/**
 * Connects an AI app to the cadet MCP the way a client would: dynamic
 * registration, authorization, sign-in with the signed query, consent and
 * code exchange. Returns the access token and its verified claims.
 */
export async function connectCadetMcp(credentials: CadetCredentials) {
  const redirectUri = 'http://127.0.0.1:43123/oauth/callback';
  const registration = await cadetAuth.handler(
    new Request(`${CADET_AUTH_URL}/oauth2/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        client_name: 'Cadet test app',
        redirect_uris: [redirectUri],
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
      }),
    }),
  );
  const clientId = ((await registration.json()) as { client_id: string }).client_id;

  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const authorize = new URL(`${CADET_AUTH_URL}/oauth2/authorize`);
  for (const [key, value] of Object.entries({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: 'mcp:read offline_access',
    state: 'state',
    resource: env.CADET_MCP_RESOURCE_URL,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  })) authorize.searchParams.set(key, value);
  const login = await cadetAuth.handler(
    new Request(authorize, {
      headers: { accept: 'text/html', 'sec-fetch-mode': 'navigate' },
      redirect: 'manual',
    }),
  );
  const loginQuery = new URL(login.headers.get('location')!).search.slice(1);

  const signedIn = await signInCadet(credentials, { oauth_query: loginQuery });
  const consentUrl = new URL(((await signedIn.response.json()) as { url: string }).url);
  const consent = await cadetAuth.handler(
    new Request(`${CADET_AUTH_URL}/oauth2/consent`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: CADET_ORIGIN,
        cookie: signedIn.cookie,
      },
      body: JSON.stringify({ accept: true, oauth_query: consentUrl.search.slice(1) }),
    }),
  );
  const code = new URL(((await consent.json()) as { url: string }).url).searchParams.get('code')!;

  const token = await cadetAuth.handler(
    new Request(`${CADET_AUTH_URL}/oauth2/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: clientId,
        code_verifier: verifier,
        resource: env.CADET_MCP_RESOURCE_URL,
      }).toString(),
    }),
  );
  const { access_token: accessToken } = (await token.json()) as { access_token: string };
  const claims = await verifyMcpAccessToken(cadetAuth, accessToken, {
    issuer: cadetOauthIssuer(),
    audience: env.CADET_MCP_RESOURCE_URL,
  });
  if (!claims) throw new Error('The cadet MCP access token did not verify.');
  return { accessToken, claims, sessionCookie: signedIn.cookie };
}
