import {
  createTestSchool,
  createTestSchoolMember,
} from '@campuspilot/api/test/fixtures';
import { auth } from '@campuspilot/auth/server';
import { db } from '@campuspilot/db';
import { apikey } from '@campuspilot/db/schema/auth';
import {
  Client,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import { app } from './http';

const ORIGIN = 'http://localhost:3000';

type Outcome = { ok: true; schoolId: string } | { ok: false; code: string };

let ownSchoolId: string;
let otherSchoolId: string;
let cookieHeaders: Record<string, string>;
let apiKeyValue: string;

beforeAll(async () => {
  const signUp = await auth.api.signUpEmail({
    body: {
      email: `transport_${crypto.randomUUID()}@example.com`,
      password: 'Password123!',
      name: 'Transport principal',
    },
    asResponse: true,
  });
  cookieHeaders = { cookie: signUp.headers.get('set-cookie') ?? '' };
  const session = await auth.api.getSession({
    headers: new Headers(cookieHeaders),
  });
  const ownSchool = await createTestSchool();
  const otherSchool = await createTestSchool();
  await createTestSchoolMember({
    schoolId: ownSchool.id,
    userId: session!.user.id,
    roles: [{ role: 'principal' }],
  });
  ownSchoolId = ownSchool.id;
  otherSchoolId = otherSchool.id;
  apiKeyValue = (
    await auth.api.createApiKey({
      body: { name: 'Transport test' },
      headers: new Headers(cookieHeaders),
    })
  ).key;
});

async function viaRpc(
  headers: Record<string, string>,
  schoolId: string,
): Promise<Outcome> {
  const response = await app.fetch(
    new Request(`${ORIGIN}/rpc/school/getSchool`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify({ json: { schoolId } }),
    }),
  );
  const { json } = (await response.json()) as {
    json: { id?: string; code?: string };
  };
  return response.ok
    ? { ok: true, schoolId: json.id! }
    : { ok: false, code: json.code! };
}

async function viaOpenApi(
  headers: Record<string, string>,
  schoolId: string,
): Promise<Outcome> {
  const response = await app.fetch(
    new Request(`${ORIGIN}/api-reference/school/getSchool`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify({ schoolId }),
    }),
  );
  const body = (await response.json()) as { id?: string; code?: string };
  return response.ok
    ? { ok: true, schoolId: body.id! }
    : { ok: false, code: body.code! };
}

async function viaMcp(
  headers: Record<string, string>,
  schoolId: string,
): Promise<Outcome> {
  const client = new Client({ name: 'transport-test', version: '0.1.0' });
  let status: number | undefined;
  try {
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`${ORIGIN}/mcp`), {
        requestInit: { headers },
        fetch: async (input, init) => {
          const response = await app.fetch(new Request(input, init));
          status = response.status;
          return response;
        },
      }),
    );
  } catch (error) {
    // The endpoint refuses unauthenticated requests at the HTTP level.
    if (status === 401) return { ok: false, code: 'UNAUTHORIZED' };
    throw error;
  }
  try {
    const result = await client.callTool({
      name: 'school.getSchool',
      arguments: { schoolId },
    });
    const content = result.content as Array<{ type: string; text: string }>;
    const body = JSON.parse(content[0]!.text) as { id?: string; code?: string };
    return result.isError
      ? { ok: false, code: body.code! }
      : { ok: true, schoolId: body.id! };
  } finally {
    await client.close();
  }
}

const transports = { rpc: viaRpc, openapi: viaOpenApi, mcp: viaMcp };

describe('user API keys across transports', () => {
  it.each(Object.keys(transports) as Array<keyof typeof transports>)(
    'gives %s the same OPA outcomes for x-api-key, a Bearer key and (except MCP) a session',
    async (transport) => {
      const call = transports[transport];
      const credentials = {
        session: cookieHeaders,
        xApiKey: { 'x-api-key': apiKeyValue },
        bearer: { authorization: `Bearer ${apiKeyValue}` },
      };

      for (const [name, headers] of Object.entries(credentials)) {
        if (transport === 'mcp' && name === 'session') {
          // The MCP endpoint accepts API keys and OAuth tokens, never cookies.
          expect(await call(headers, ownSchoolId), name).toEqual({
            ok: false,
            code: 'UNAUTHORIZED',
          });
          continue;
        }
        expect(await call(headers, ownSchoolId), name).toEqual({
          ok: true,
          schoolId: ownSchoolId,
        });
        expect(await call(headers, otherSchoolId), name).toEqual({
          ok: false,
          code: 'FORBIDDEN',
        });
      }
    },
  );

  it('rejects expired and deleted keys as unauthenticated on every transport', async () => {
    const owner = new Headers(cookieHeaders);
    const expired = await auth.api.createApiKey({
      body: { name: 'Expired' },
      headers: owner,
    });
    const deleted = await auth.api.createApiKey({
      body: { name: 'Deleted' },
      headers: owner,
    });
    await db
      .update(apikey)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(apikey.id, expired.id));
    await auth.api.deleteApiKey({ body: { keyId: deleted.id }, headers: owner });

    for (const call of Object.values(transports)) {
      for (const key of [expired.key, deleted.key]) {
        expect(await call({ 'x-api-key': key }, ownSchoolId)).toEqual({
          ok: false,
          code: 'UNAUTHORIZED',
        });
      }
    }
  });
});
