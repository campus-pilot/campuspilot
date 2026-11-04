import { generateKeyPairSync, sign } from 'node:crypto';

import {
  createTestSchool,
  createTestSchoolMember,
} from '@campuspilot/api/test/fixtures';
import {
  authorizeWithConsent,
  exchangeCode,
  ISSUER,
  MCP_RESOURCE,
  registerDynamicClient,
  type TestAuth,
  type TokenResponse,
} from '@campuspilot/auth/__tests__/oauth-test-utils';
import { auth } from '@campuspilot/auth/server';
import { db } from '@campuspilot/db';
import * as schema from '@campuspilot/db/schema/auth';
import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import { app } from './http';

const ORIGIN = 'http://localhost:3000';
const PRM_URL = `${ORIGIN}/.well-known/oauth-protected-resource/api/mcp`;
const testAuth = auth as unknown as TestAuth;

type Grant = {
  clientId: string;
  userId: string;
  tokens: TokenResponse;
};

/** Connects a DCR client through the full browser flow and returns its tokens. */
async function connectClient(consent: { scope?: string } = {}): Promise<Grant> {
  const registration = await registerDynamicClient(testAuth);
  const client = {
    clientId: registration.clientId,
    redirectUri: 'http://127.0.0.1:51234/oauth/callback',
  };
  const completed = await authorizeWithConsent(testAuth, client, consent);
  const response = await exchangeCode(testAuth, completed, client);
  expect(response.status).toBe(200);
  return {
    clientId: client.clientId,
    userId: completed.user.userId,
    tokens: (await response.json()) as TokenResponse,
  };
}

let schoolId: string;
let otherSchoolId: string;
let writer: Grant;
let reader: Grant;

beforeAll(async () => {
  schoolId = (await createTestSchool()).id;
  otherSchoolId = (await createTestSchool()).id;
  writer = await connectClient();
  reader = await connectClient({ scope: 'mcp:read offline_access' });
  for (const grant of [writer, reader]) {
    await createTestSchoolMember({
      schoolId,
      userId: grant.userId,
      roles: [{ role: 'principal' }],
    });
  }
});

let nextId = 1;

/** Posts one JSON-RPC request to /api/mcp through the real Hono app. */
async function mcp(
  headers: Record<string, string>,
  method: string,
  params: Record<string, unknown> = {},
) {
  const response = await app.fetch(
    new Request(`${ORIGIN}/api/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-protocol-version': '2025-11-25',
        ...headers,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method, params }),
    }),
  );
  const text = await response.text();
  const json = text.startsWith('{')
    ? JSON.parse(text)
    : JSON.parse(text.split('\n').find((line) => line.startsWith('data:'))!.slice(5));
  return { response, json };
}

function bearer(token: string) {
  return { authorization: `Bearer ${token}` };
}

function toolResult(json: { result?: { content?: Array<{ text: string }>; isError?: boolean } }) {
  return {
    isError: json.result?.isError === true,
    body: JSON.parse(json.result!.content![0]!.text),
  };
}

/** A JWT signed with this server's real key but chosen claims. */
async function signWithServerKey(claims: Record<string, unknown>) {
  const now = Math.floor(Date.now() / 1000);
  const { token } = await auth.api.signJWT({
    body: {
      payload: {
        iss: ISSUER,
        aud: MCP_RESOURCE,
        sub: writer.userId,
        azp: writer.clientId,
        scope: 'mcp:read mcp:write',
        iat: now,
        exp: now + 600,
        ...claims,
      },
    },
  });
  return token;
}

describe('discovery documents', () => {
  it('serves protected-resource metadata at both URLs, publicly', async () => {
    for (const path of [
      '/.well-known/oauth-protected-resource',
      '/.well-known/oauth-protected-resource/api/mcp',
    ]) {
      const response = await app.fetch(
        new Request(`${ORIGIN}${path}`, {
          headers: { origin: 'https://claude.ai' },
        }),
      );
      expect(response.status, path).toBe(200);
      expect(response.headers.get('access-control-allow-origin')).toBe('*');
      expect(await response.json()).toMatchObject({
        resource: MCP_RESOURCE,
        authorization_servers: [ISSUER],
        scopes_supported: ['mcp:read', 'mcp:write'],
      });
    }
  });

  it('serves the same issuer at every authorization-server discovery URL', async () => {
    for (const path of [
      '/.well-known/oauth-authorization-server/api/auth',
      '/.well-known/openid-configuration/api/auth',
      '/api/auth/.well-known/oauth-authorization-server',
      '/api/auth/.well-known/openid-configuration',
    ]) {
      const response = await app.fetch(
        new Request(`${ORIGIN}${path}`, {
          headers: { origin: 'https://chatgpt.com' },
        }),
      );
      expect(response.status, path).toBe(200);
      expect(response.headers.get('access-control-allow-origin'), path).toBe('*');
      expect(((await response.json()) as { issuer: string }).issuer, path).toBe(ISSUER);
    }
  });
});

describe('MCP endpoint authentication', () => {
  it('challenges requests without a credential with 401 and resource metadata', async () => {
    const { response, json } = await mcp({}, 'tools/list');

    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toBe(
      `Bearer resource_metadata="${PRM_URL}", scope="mcp:read mcp:write"`,
    );
    expect(json.error).toBeDefined();
  });

  it('does not accept a browser session cookie', async () => {
    const signUp = await auth.api.signUpEmail({
      body: {
        email: `cookie_${crypto.randomUUID()}@example.com`,
        password: 'Password123!',
        name: 'Cookie user',
      },
      asResponse: true,
    });

    const { response } = await mcp(
      { cookie: signUp.headers.get('set-cookie') ?? '' },
      'tools/list',
    );

    expect(response.status).toBe(401);
  });

  it('runs tools for an OAuth connection with the user’s OPA permissions', async () => {
    const own = await mcp(bearer(writer.tokens.access_token), 'tools/call', {
      name: 'school.getSchool',
      arguments: { schoolId },
    });
    const other = await mcp(bearer(writer.tokens.access_token), 'tools/call', {
      name: 'school.getSchool',
      arguments: { schoolId: otherSchoolId },
    });

    expect(toolResult(own.json)).toMatchObject({
      isError: false,
      body: { id: schoolId },
    });
    expect(toolResult(other.json)).toMatchObject({
      isError: true,
      body: { code: 'FORBIDDEN' },
    });
  });

  it.each([
    ['another audience', { aud: 'https://other.example/api/mcp' }],
    ['another issuer', { iss: 'https://evil.example/api/auth' }],
    ['an expired token', { exp: Math.floor(Date.now() / 1000) - 60 }],
  ])('rejects %s with 401 invalid_token', async (_label, claims) => {
    const token = await signWithServerKey(claims);

    const { response } = await mcp(bearer(token), 'tools/list');

    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toContain(
      'error="invalid_token"',
    );
  });

  it('rejects a JWT from a third-party issuer', async () => {
    const { privateKey } = generateKeyPairSync('ed25519');
    const encode = (value: unknown) =>
      Buffer.from(JSON.stringify(value)).toString('base64url');
    const unsigned = `${encode({ alg: 'EdDSA', typ: 'at+jwt' })}.${encode({
      iss: 'https://accounts.example.com',
      aud: MCP_RESOURCE,
      sub: writer.userId,
      azp: writer.clientId,
      scope: 'mcp:read mcp:write',
      exp: Math.floor(Date.now() / 1000) + 600,
    })}`;
    const token = `${unsigned}.${sign(null, Buffer.from(unsigned), privateKey).toString('base64url')}`;

    const { response } = await mcp(bearer(token), 'tools/list');

    expect(response.status).toBe(401);
  });

  it('answers a write tool on a read-only connection with 403 insufficient_scope and the ChatGPT hint', async () => {
    const write = await mcp(bearer(reader.tokens.access_token), 'tools/call', {
      name: 'school.recordPayment',
      arguments: {},
    });
    const runner = await mcp(bearer(reader.tokens.access_token), 'tools/call', {
      name: 'runAdvancedWriteTool',
      arguments: { name: 'school.deleteClass', arguments: {} },
    });
    const read = await mcp(bearer(reader.tokens.access_token), 'tools/call', {
      name: 'school.getSchool',
      arguments: { schoolId },
    });

    for (const { response, json } of [write, runner]) {
      const header = response.headers.get('www-authenticate')!;
      expect(response.status).toBe(403);
      expect(header).toContain('error="insufficient_scope"');
      expect(header).toContain('scope="mcp:read mcp:write"');
      expect(header).toContain(`resource_metadata="${PRM_URL}"`);
      expect(json.result).toMatchObject({
        isError: true,
        _meta: { 'mcp/www_authenticate': [header] },
      });
    }
    expect(read.response.status).toBe(200);
    expect(toolResult(read.json).body).toMatchObject({ id: schoolId });
  });

  it('lists write tools only for connections that may write', async () => {
    const readOnly = await mcp(bearer(reader.tokens.access_token), 'tools/list');
    const readWrite = await mcp(bearer(writer.tokens.access_token), 'tools/list');
    const names = (json: { result: { tools: Array<{ name: string }> } }) =>
      json.result.tools.map(({ name }) => name);

    expect(names(readOnly.json)).not.toContain('school.recordPayment');
    expect(names(readOnly.json)).not.toContain('runAdvancedWriteTool');
    expect(names(readOnly.json)).toContain('school.getSchool');
    expect(names(readWrite.json)).toContain('school.recordPayment');
    expect(names(readWrite.json)).toContain('runAdvancedWriteTool');
  });

  it('records when a connection was last used', async () => {
    const grant = await connectClient();
    const consent = () =>
      db
        .select({ lastUsedAt: schema.oauthConsent.lastUsedAt })
        .from(schema.oauthConsent)
        .where(
          and(
            eq(schema.oauthConsent.clientId, grant.clientId),
            eq(schema.oauthConsent.userId, grant.userId),
          ),
        );
    expect((await consent())[0]?.lastUsedAt).toBeNull();

    await mcp(bearer(grant.tokens.access_token), 'tools/list');

    expect((await consent())[0]?.lastUsedAt).toBeInstanceOf(Date);
  });

  it('stops every connection of a client an administrator disables', async () => {
    const grant = await connectClient();
    await db
      .update(schema.oauthClient)
      .set({ disabled: true })
      .where(eq(schema.oauthClient.clientId, grant.clientId));

    const { response } = await mcp(bearer(grant.tokens.access_token), 'tools/list');

    expect(response.status).toBe(401);
  });

  it('stops a connection immediately when the user disconnects it', async () => {
    const grant = await connectClient();
    await createTestSchoolMember({
      schoolId,
      userId: grant.userId,
      roles: [{ role: 'principal' }],
    });
    expect(
      (await mcp(bearer(grant.tokens.access_token), 'tools/list')).response.status,
    ).toBe(200);

    await db
      .delete(schema.oauthConsent)
      .where(
        and(
          eq(schema.oauthConsent.clientId, grant.clientId),
          eq(schema.oauthConsent.userId, grant.userId),
        ),
      );
    const { response } = await mcp(bearer(grant.tokens.access_token), 'tools/list');

    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toContain(
      'error="invalid_token"',
    );
  });
});

describe('API keys on the MCP endpoint', () => {
  let apiKey: string;
  let keyUserId: string;

  beforeAll(async () => {
    const signUp = await auth.api.signUpEmail({
      body: {
        email: `mcpkey_${crypto.randomUUID()}@example.com`,
        password: 'Password123!',
        name: 'Key user',
      },
      asResponse: true,
    });
    const cookie = signUp.headers.get('set-cookie') ?? '';
    const session = await auth.api.getSession({ headers: new Headers({ cookie }) });
    keyUserId = session!.user.id;
    await createTestSchoolMember({
      schoolId,
      userId: keyUserId,
      roles: [{ role: 'principal' }],
    });
    apiKey = (
      await auth.api.createApiKey({
        body: { name: 'MCP' },
        headers: new Headers({ cookie }),
      })
    ).key;
  });

  it.each([
    ['x-api-key', () => ({ 'x-api-key': apiKey })],
    ['Authorization: Bearer', () => bearer(apiKey)],
  ])('accepts the key as %s', async (_label, headers) => {
    const { response, json } = await mcp(headers(), 'tools/call', {
      name: 'school.getSchool',
      arguments: { schoolId },
    });

    expect(response.status).toBe(200);
    expect(toolResult(json).body).toMatchObject({ id: schoolId });
  });

  it('lets x-api-key win over a Bearer credential', async () => {
    const validKeyWins = await mcp(
      { 'x-api-key': apiKey, authorization: 'Bearer not-a-real-token' },
      'tools/list',
    );
    const invalidKeyWins = await mcp(
      {
        'x-api-key': 'cp_invalid',
        ...bearer(writer.tokens.access_token),
      },
      'tools/list',
    );

    expect(validKeyWins.response.status).toBe(200);
    expect(invalidKeyWins.response.status).toBe(401);
  });

  it('skips OAuth scope checks for API keys, which carry the user’s rights', async () => {
    const { response, json } = await mcp({ 'x-api-key': apiKey }, 'tools/call', {
      name: 'runAdvancedWriteTool',
      arguments: { name: 'school.deleteClass', arguments: { schoolId } },
    });

    expect(response.status).toBe(200);
    // Reaches the procedure: input validation answers, not the scope gate.
    expect(toolResult(json)).toMatchObject({
      isError: true,
      body: { code: 'BAD_REQUEST' },
    });
  });
});
