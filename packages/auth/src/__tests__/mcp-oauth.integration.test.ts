import { createDb, db } from '@campuspilot/db';
import * as schema from '@campuspilot/db/schema/auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { betterAuth } from 'better-auth';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  deleteUnusedDynamicOAuthClients,
  mcpOAuthPlugins,
} from '../mcp-oauth';
import {
  MCP_ACCESS_TOKEN_TTL_SECONDS,
  MCP_REFRESH_TOKEN_TTL_SECONDS,
} from '../mcp-oauth-policy';
import { createAuth } from '../server';
import {
  APP_ORIGIN,
  authorizeUrl,
  authorizeWithConsent,
  decodeJwt,
  exchangeCode,
  ISSUER,
  MCP_RESOURCE,
  navigate,
  pkce,
  postForm,
  refresh,
  registerDynamicClient,
  signUpUser,
  StubMetadataHost,
  type TestAuth,
  type TokenResponse,
} from './oauth-test-utils';

const DAY_MS = 24 * 60 * 60 * 1000;

const metadataHost = new StubMetadataHost();
const auth = createAuth(createDb(), {
  fetchClientMetadataResource: metadataHost.fetch,
});

afterEach(() => {
  vi.useRealTimers();
});

async function tokensFor(
  testAuth: TestAuth,
  client: { clientId: string; redirectUri: string },
  consent: { scope?: string } = {},
) {
  const completed = await authorizeWithConsent(testAuth, client, consent);
  const response = await exchangeCode(testAuth, completed, client);
  expect(response.status).toBe(200);
  return {
    completed,
    tokens: (await response.json()) as TokenResponse,
  };
}

describe('MCP authorization server metadata', () => {
  it('advertises CIMD, DCR, S256, iss and public clients under one issuer', async () => {
    const [server, openId] = await Promise.all(
      [
        `${ISSUER}/.well-known/oauth-authorization-server`,
        `${ISSUER}/.well-known/openid-configuration`,
      ].map(async (url) =>
        (await auth.handler(new Request(url))).json() as Promise<
          Record<string, unknown>
        >,
      ),
    );

    for (const metadata of [server!, openId!]) {
      expect(metadata).toMatchObject({
        issuer: ISSUER,
        client_id_metadata_document_supported: true,
        authorization_response_iss_parameter_supported: true,
        registration_endpoint: `${ISSUER}/oauth2/register`,
        revocation_endpoint: `${ISSUER}/oauth2/revoke`,
        code_challenge_methods_supported: ['S256'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
      });
      expect(metadata.token_endpoint_auth_methods_supported).toContain('none');
      expect(metadata.scopes_supported).toEqual(
        expect.arrayContaining(['mcp:read', 'mcp:write', 'offline_access']),
      );
    }
  });
});

describe('Client ID Metadata Documents', () => {
  it('authorizes a CIMD client and issues a 1-hour token bound to the MCP resource', async () => {
    const client = metadataHost.publish('/cimd-happy.json');
    const { completed, tokens } = await tokensFor(auth, client);

    const claims = decodeJwt(tokens.access_token);
    expect(completed.iss).toBe(ISSUER);
    expect(completed.state).toBe('state-123');
    expect(claims).toMatchObject({
      iss: ISSUER,
      aud: MCP_RESOURCE,
      sub: completed.user.userId,
      azp: client.clientId,
      scope: 'mcp:read mcp:write offline_access',
    });
    expect((claims.exp as number) - (claims.iat as number)).toBe(
      MCP_ACCESS_TOKEN_TTL_SECONDS,
    );
    expect(tokens.refresh_token).toBeTruthy();

    const [stored] = await db
      .select()
      .from(schema.oauthClient)
      .where(eq(schema.oauthClient.clientId, client.clientId));
    expect(stored?.clientDiscoveryId).toBe('cimd');
    expect(stored?.skipConsent).not.toBe(true);
    const consents = await db
      .select()
      .from(schema.oauthConsent)
      .where(eq(schema.oauthConsent.clientId, client.clientId));
    expect(consents.map(({ userId }) => userId)).toEqual([completed.user.userId]);
  });

  it('narrows the grant to read-only when the user unticks write', async () => {
    const client = metadataHost.publish('/cimd-read-only.json');
    const { tokens } = await tokensFor(auth, client, {
      scope: 'mcp:read offline_access',
    });

    expect(decodeJwt(tokens.access_token).scope).toBe('mcp:read offline_access');
  });

  it('rejects a metadata document whose client_id does not match its URL', async () => {
    const client = metadataHost.publish('/cimd-mismatch.json', {
      client_id: 'https://client.example/other.json',
    });
    const user = await signUpUser(auth, 'mismatch');

    const response = await navigate(
      auth,
      authorizeUrl({ ...client, codeChallenge: pkce().challenge }),
      user.cookie,
    );

    // No client identity can be trusted, so nothing is redirected anywhere.
    expect(response.status).toBe(400);
    expect(response.headers.get('location')).toBeNull();
    expect(await response.json()).toMatchObject({ error: 'invalid_client' });
  });

  it('rejects a redirect URI the client did not register, without redirecting to it', async () => {
    const client = metadataHost.publish('/cimd-redirect.json');
    const user = await signUpUser(auth, 'redirect');

    const response = await navigate(
      auth,
      authorizeUrl({
        ...client,
        redirectUri: 'https://attacker.example/callback',
        codeChallenge: pkce().challenge,
      }),
      user.cookie,
    );

    expect(response.headers.get('location')).not.toContain('attacker.example');
    expect(response.headers.get('location')).toContain('invalid_redirect');
  });

  it('requires PKCE', async () => {
    const client = metadataHost.publish('/cimd-pkce.json');
    const user = await signUpUser(auth, 'pkce');

    const response = await navigate(
      auth,
      authorizeUrl({ ...client, codeChallenge: '' }),
      user.cookie,
    );
    const location = new URL(response.headers.get('location')!);

    expect(location.origin + location.pathname).toBe(client.redirectUri);
    expect(location.searchParams.get('error')).toBe('invalid_request');
    expect(location.searchParams.get('iss')).toBe(ISSUER);
  });

  it('refuses tokens for a resource other than the MCP endpoint', async () => {
    const client = metadataHost.publish('/cimd-resource.json');
    const user = await signUpUser(auth, 'resource');

    const response = await navigate(
      auth,
      authorizeUrl({
        ...client,
        resource: 'https://evil.example/api/mcp',
        codeChallenge: pkce().challenge,
      }),
      user.cookie,
    );

    expect(response.headers.get('location')).toMatch(/invalid_target|invalid_request/);
    const completed = await authorizeWithConsent(auth, client);
    const token = await exchangeCode(auth, completed, {
      ...client,
      resource: 'https://evil.example/api/mcp',
    });
    expect(token.status).toBe(400);
  });
});

describe('Dynamic Client Registration', () => {
  it('registers a public client, records the method, and still asks for consent', async () => {
    const registration = await registerDynamicClient(auth, {
      metadata: { registrationMethod: 'pre_registered' },
    });

    expect(registration.response.status).toBe(201);
    const [stored] = await db
      .select()
      .from(schema.oauthClient)
      .where(eq(schema.oauthClient.clientId, registration.clientId));
    expect(stored?.metadata).toMatchObject({ registrationMethod: 'dynamic' });
    expect(stored?.clientDiscoveryId).toBeNull();
    expect(stored?.skipConsent).not.toBe(true);

    const { tokens } = await tokensFor(auth, {
      clientId: registration.clientId,
      redirectUri: 'http://127.0.0.1:59999/oauth/callback',
    });
    expect(decodeJwt(tokens.access_token).azp).toBe(registration.clientId);
  });

  it('rate-limits registration per IP', async () => {
    const limited = betterAuth({
      database: drizzleAdapter(db, { provider: 'pg', schema }),
      secret: 'a-super-secret-key-that-is-at-least-32-chars-long!',
      baseURL: 'http://localhost:3000',
      rateLimit: { enabled: true },
      plugins: mcpOAuthPlugins({
        fetchClientMetadataResource: metadataHost.fetch,
      }),
    }) as unknown as TestAuth;
    const ip = { 'x-forwarded-for': `203.0.113.${Math.floor(Math.random() * 200)}` };

    const statuses: number[] = [];
    for (let index = 0; index < 6; index += 1) {
      statuses.push((await registerDynamicClient(limited, {}, ip)).response.status);
    }

    expect(statuses.slice(0, 5)).toEqual([201, 201, 201, 201, 201]);
    expect(statuses[5]).toBe(429);
  });

  it('deletes unused dynamic clients after 30 days and keeps clients with grants', async () => {
    const unused = await registerDynamicClient(auth);
    const used = await registerDynamicClient(auth);
    await tokensFor(auth, {
      clientId: used.clientId,
      redirectUri: 'http://127.0.0.1:59999/oauth/callback',
    });
    const cimdClient = metadataHost.publish('/cimd-old.json');
    await tokensFor(auth, cimdClient);
    const old = new Date(Date.now() - 31 * DAY_MS);
    await db.update(schema.oauthClient).set({ createdAt: old });

    await deleteUnusedDynamicOAuthClients(db);
    const remaining = new Set(
      (await db.select({ id: schema.oauthClient.clientId }).from(schema.oauthClient)).map(
        ({ id }) => id,
      ),
    );

    expect(remaining.has(unused.clientId)).toBe(false);
    expect(remaining.has(used.clientId)).toBe(true);
    expect(remaining.has(cimdClient.clientId)).toBe(true);
  });
});

describe('refresh tokens', () => {
  it('rotates on every use and gives each new token a fresh 90 days', async () => {
    const client = metadataHost.publish('/refresh-rotation.json');
    const { tokens } = await tokensFor(auth, client);

    vi.useFakeTimers({ now: Date.now() + 10 * DAY_MS, toFake: ['Date'] });
    const rotated = (await (
      await refresh(auth, client.clientId, tokens.refresh_token!)
    ).json()) as TokenResponse;

    expect(rotated.refresh_token).toBeTruthy();
    expect(rotated.refresh_token).not.toBe(tokens.refresh_token);
    const rows = await db
      .select()
      .from(schema.oauthRefreshToken)
      .where(eq(schema.oauthRefreshToken.clientId, client.clientId));
    const newest = rows.find((row) => row.rotatedAt === null && row.revoked === null)!;
    expect(newest.expiresAt!.getTime() - Date.now()).toBeGreaterThan(
      MCP_REFRESH_TOKEN_TTL_SECONDS * 1000 - 60_000,
    );

    vi.setSystemTime(Date.now() + 31_000);
    const replay = await refresh(auth, client.clientId, tokens.refresh_token!);
    expect(replay.status).toBe(400);
  });

  it('keeps the grant alive through parallel refreshes and replays a retry within 30 seconds', async () => {
    const client = metadataHost.publish('/refresh-parallel.json');
    const { tokens } = await tokensFor(auth, client);

    const responses = await Promise.all([
      refresh(auth, client.clientId, tokens.refresh_token!),
      refresh(auth, client.clientId, tokens.refresh_token!),
    ]);
    const winner = responses.find((response) => response.status === 200)!;
    const rotated = (await winner.json()) as TokenResponse;

    // A request racing the rotation may lose, but the token family is not
    // revoked: the winner's token works and a retry gets the same response.
    expect(
      (await refresh(auth, client.clientId, rotated.refresh_token!)).status,
    ).toBe(200);
    const retry = await refresh(auth, client.clientId, tokens.refresh_token!);
    expect(retry.status).toBe(200);
  });

  it('keeps a connection working after the user signs out of CampusPilot', async () => {
    const client = metadataHost.publish('/refresh-signed-out.json');
    const { completed, tokens } = await tokensFor(auth, client);

    await db
      .delete(schema.session)
      .where(eq(schema.session.userId, completed.user.userId));

    expect(
      (await refresh(auth, client.clientId, tokens.refresh_token!)).status,
    ).toBe(200);
  });

  it('stops refreshing after the refresh token is revoked', async () => {
    const client = metadataHost.publish('/refresh-revoke.json');
    const { tokens } = await tokensFor(auth, client);

    const revoke = await postForm(auth, '/oauth2/revoke', {
      token: tokens.refresh_token!,
      token_type_hint: 'refresh_token',
      client_id: client.clientId,
    });

    expect(revoke.status).toBe(200);
    expect((await refresh(auth, client.clientId, tokens.refresh_token!)).status).toBe(400);
  });
});

describe('OAuth client administration endpoints', () => {
  it('lets only platform administrators create clients through the OAuth endpoints', async () => {
    const user = await signUpUser(auth, 'not-admin');

    const response = await auth.handler(
      new Request(`${ISSUER}/oauth2/create-client`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: APP_ORIGIN,
          cookie: user.cookie,
        },
        body: JSON.stringify({
          client_name: 'Sneaky',
          redirect_uris: ['https://client.example/cb'],
        }),
      }),
    );

    expect(response.status).toBe(401);
  });
});
