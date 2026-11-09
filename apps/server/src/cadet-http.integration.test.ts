import { randomUUID } from 'node:crypto';

import { connectCadetMcp, cookiesOf, signInCadet } from '@campuspilot/api/test/cadet';
import {
  createSchoolStaffSession,
  createTestClient,
  createTestSchool,
} from '@campuspilot/api/test/fixtures';
import {
  authorizeWithConsent,
  exchangeCode,
  registerDynamicClient,
  type TestAuth,
  type TokenResponse,
} from '@campuspilot/auth/__tests__/oauth-test-utils';
import { auth } from '@campuspilot/auth/server';
import { beforeAll, describe, expect, it } from 'vitest';

import { app } from './http';

const ORIGIN = 'http://localhost:3000';
const CADET_ORIGIN = 'http://localhost:3004';
const CADET_RESOURCE = `${ORIGIN}/cadet/mcp`;
const CADET_ISSUER = `${ORIGIN}/api/cadet/auth`;
const CADET_PRM_URL = `${ORIGIN}/.well-known/oauth-protected-resource/cadet/mcp`;

let schoolId: string;
let admissionId: string;
let credentials: { schoolSlug: string; admissionNo: string; password: string };
let cadetCookie: string;
let cadetToken: string;
let staffToken: string;
let staffCookie: string;

beforeAll(async () => {
  const school = await createTestSchool();
  schoolId = school.id;
  const principal = await createSchoolStaffSession(school.id, [{ role: 'principal', meta: null }]);
  const created = await createTestClient(principal.session).school.createAdmission({
    schoolId: school.id,
    name: 'Ravi Verma',
    admissionNo: `SRV-${randomUUID().slice(0, 6)}`,
    address: 'Test address',
    phoneNo: '9999999999',
    whatsappSameAsPhone: true,
    dob: '2016-05-06',
    fatherName: 'Father',
    motherName: 'Mother',
    generateCadetPassword: true,
  });
  admissionId = created.id;
  credentials = created.cadetPassword!;
  cadetCookie = (await signInCadet(credentials)).cookie;
  cadetToken = (await connectCadetMcp(credentials)).accessToken;

  const testAuth = auth as unknown as TestAuth;
  const registration = await registerDynamicClient(testAuth);
  const client = { clientId: registration.clientId, redirectUri: 'http://127.0.0.1:51234/oauth/callback' };
  const completed = await authorizeWithConsent(testAuth, client);
  staffToken = ((await (await exchangeCode(testAuth, completed, client)).json()) as TokenResponse).access_token;
  staffCookie = completed.user.cookie;
});

async function mcp(path: '/mcp' | '/cadet/mcp', headers: Record<string, string>, method: string, params: Record<string, unknown> = {}) {
  const response = await app.fetch(
    new Request(`${ORIGIN}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-protocol-version': '2025-11-25',
        ...headers,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    }),
  );
  const text = await response.text();
  const json = text.startsWith('{')
    ? JSON.parse(text)
    : JSON.parse(text.split('\n').find((line) => line.startsWith('data:'))!.slice(5));
  return { response, json };
}

function rpc(path: string, headers: Record<string, string>, input?: unknown) {
  return app.fetch(
    new Request(`${ORIGIN}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(input === undefined ? {} : { json: input }),
    }),
  );
}

describe('cadet discovery documents', () => {
  it('serves the cadet resource metadata before the staff wildcard, publicly', async () => {
    const response = await app.fetch(new Request(CADET_PRM_URL, { headers: { origin: 'https://claude.ai' } }));
    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(await response.json()).toMatchObject({
      resource: CADET_RESOURCE,
      authorization_servers: [CADET_ISSUER],
      scopes_supported: ['mcp:read'],
    });
    const staff = await app.fetch(new Request(`${ORIGIN}/.well-known/oauth-protected-resource/mcp`));
    expect(((await staff.json()) as { resource: string }).resource).toBe(`${ORIGIN}/mcp`);
  });

  it('serves the cadet issuer at the authorization-server discovery URLs', async () => {
    for (const path of [
      '/.well-known/oauth-authorization-server/api/cadet/auth',
      '/.well-known/openid-configuration/api/cadet/auth',
      '/api/cadet/auth/.well-known/oauth-authorization-server',
    ]) {
      const response = await app.fetch(new Request(`${ORIGIN}${path}`, { headers: { origin: 'https://chatgpt.com' } }));
      expect(response.status, path).toBe(200);
      expect(response.headers.get('access-control-allow-origin'), path).toBe('*');
      expect(((await response.json()) as { issuer: string }).issuer, path).toBe(CADET_ISSUER);
    }
  });
});

describe('/cadet/mcp', () => {
  it('challenges without a credential and refuses API keys and cookies', async () => {
    const anonymous = await mcp('/cadet/mcp', {}, 'tools/list');
    expect(anonymous.response.status).toBe(401);
    expect(anonymous.response.headers.get('www-authenticate')).toBe(
      `Bearer resource_metadata="${CADET_PRM_URL}", scope="mcp:read"`,
    );
    expect((await mcp('/cadet/mcp', { 'x-api-key': 'cp_anything' }, 'tools/list')).response.status).toBe(401);
    expect((await mcp('/cadet/mcp', { cookie: cadetCookie }, 'tools/list')).response.status).toBe(401);
  });

  it("lists and runs the cadet tools for a cadet token, returning the student's own admission", async () => {
    const auth = { authorization: `Bearer ${cadetToken}` };
    const list = await mcp('/cadet/mcp', auth, 'tools/list');
    expect(list.response.status).toBe(200);
    expect((list.json.result.tools as Array<{ name: string }>).map((tool) => tool.name)).toEqual(['getAdmission']);

    const call = await mcp('/cadet/mcp', auth, 'tools/call', { name: 'getAdmission', arguments: {} });
    expect(call.json.result.isError).not.toBe(true);
    expect(JSON.parse(call.json.result.content[0].text)).toMatchObject({ id: admissionId, schoolId, name: 'Ravi Verma' });
  });

  it('never accepts a staff token, and the staff MCP never accepts a cadet token', async () => {
    expect((await mcp('/cadet/mcp', { authorization: `Bearer ${staffToken}` }, 'tools/list')).response.status).toBe(401);
    expect((await mcp('/mcp', { authorization: `Bearer ${cadetToken}` }, 'tools/list')).response.status).toBe(401);
  });
});

describe('/api/cadet/rpc and /api/cadet/auth', () => {
  it('serves getAdmission for a cadet cookie only', async () => {
    const own = await rpc('/api/cadet/rpc/getAdmission', { cookie: cadetCookie });
    expect(own.status).toBe(200);
    expect(((await own.json()) as { json: { id: string } }).json.id).toBe(admissionId);

    expect((await rpc('/api/cadet/rpc/getAdmission', {})).status).toBe(401);
    expect((await rpc('/api/cadet/rpc/getAdmission', { cookie: staffCookie })).status).toBe(401);
    // Staff procedures are not reachable through the cadet handler.
    expect((await rpc('/api/cadet/rpc/school/getAdmission', { cookie: staffCookie }, { schoolId, admissionId })).status).toBe(404);
  });

  it('allows the cadet origin on /api/cadet/* only, never on staff routes', async () => {
    const preflight = (path: string) =>
      app.fetch(
        new Request(`${ORIGIN}${path}`, {
          method: 'OPTIONS',
          headers: { origin: CADET_ORIGIN, 'access-control-request-method': 'POST' },
        }),
      );
    for (const path of ['/rpc/school/getAdmission', '/mcp', `/api/blob/schools/${schoolId}/logo`, '/api/auth/sign-in/email']) {
      expect((await preflight(path)).headers.get('access-control-allow-origin'), path).toBeNull();
      const actual = await rpc(path, { origin: CADET_ORIGIN, cookie: cadetCookie }, {});
      expect(actual.headers.get('access-control-allow-origin'), path).toBeNull();
    }
    for (const path of ['/api/cadet/rpc/getAdmission', '/api/cadet/auth/sign-in/admission', '/cadet/mcp']) {
      expect((await preflight(path)).headers.get('access-control-allow-origin'), path).toBe(CADET_ORIGIN);
    }
  });

  it('rejects a cadet cookie on staff RPC', async () => {
    const response = await rpc('/rpc/school/getAdmission', { cookie: cadetCookie }, { schoolId, admissionId });
    expect(response.status).toBe(401);
  });

  it('signs in through the server with CORS for the cadet origin only', async () => {
    const response = await app.fetch(
      new Request(`${ORIGIN}/api/cadet/auth/sign-in/admission`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: CADET_ORIGIN, 'x-forwarded-for': '198.51.100.77' },
        body: JSON.stringify(credentials),
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBe(CADET_ORIGIN);
    expect(cookiesOf(response)).toMatch(/^cpc_\./);

  });
});
