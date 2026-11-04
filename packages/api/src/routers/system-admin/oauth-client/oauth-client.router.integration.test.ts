import { auth } from '@campuspilot/auth/server';
import { PLATFORM_OAUTH_CLIENT_OWNER } from '@campuspilot/auth/mcp-oauth-policy';
import { db } from '@campuspilot/db';
import { oauthClient, oauthConsent } from '@campuspilot/db/schema/auth';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  createAdminSession,
  createRegularUserSession,
  createSchoolStaffSession,
  createTestClient,
  createTestSchool,
  createTestUser,
  type TestClient,
  type UserSession,
} from '../../../../test/fixtures';

/**
 * The procedures call Better Auth's client endpoints with the caller's
 * headers, so administrators authenticate those calls with a real API key.
 */
async function adminClient(session: UserSession): Promise<TestClient> {
  const { key } = await auth.api.createApiKey({
    body: { name: 'OAuth admin test', userId: session.user.id },
  });
  return createTestClient(session, new Headers({ 'x-api-key': key }));
}

async function insertClient(values: {
  name?: string;
  clientDiscoveryId?: string | null;
  metadata?: Record<string, unknown> | null;
  clientId?: string;
}) {
  const clientId = values.clientId ?? `client_${crypto.randomUUID()}`;
  await db.insert(oauthClient).values({
    id: crypto.randomUUID(),
    clientId,
    name: values.name ?? 'Self-registered',
    redirectUris: ['https://client.example/callback'],
    clientDiscoveryId: values.clientDiscoveryId ?? null,
    metadata: values.metadata ?? null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  return clientId;
}

const validClient = {
  name: 'Gemini Enterprise',
  redirectUris: ['https://vertexaisearch.cloud.google.com/oauth-redirect'],
};

let admin: TestClient;

beforeAll(async () => {
  admin = await adminClient(await createAdminSession());
});

describe('system-admin OAuth clients: authorization and validation', () => {
  it('rejects anonymous callers, regular users and school principals', async () => {
    const school = await createTestSchool();
    const principal = await createSchoolStaffSession(school.id, [
      { role: 'principal' },
    ]);
    const clientId = await insertClient({});

    await expect(
      createTestClient(null).systemAdmin.listOAuthClients({}),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    for (const session of [await createRegularUserSession(), principal.session]) {
      const client = createTestClient(session);
      await expect(client.systemAdmin.listOAuthClients({})).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
      await expect(client.systemAdmin.createOAuthClient(validClient)).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
      await expect(
        client.systemAdmin.setOAuthClientDisabled({ clientId, disabled: true }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(
        client.systemAdmin.deleteOAuthClient({ clientId }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    }
  });

  it('validates new clients before creating them', async () => {
    for (const input of [
      { ...validClient, name: '' },
      { ...validClient, redirectUris: [] },
      { ...validClient, redirectUris: ['ftp://client.example/cb'] },
      { ...validClient, redirectUris: ['https://a.example/cb', 'https://a.example/cb'] },
    ]) {
      await expect(admin.systemAdmin.createOAuthClient(input)).rejects.toMatchObject({
        code: 'BAD_REQUEST',
      });
    }
  });
});

describe('pre-registered clients', () => {
  it('creates a platform-owned client and returns its secret once', async () => {
    const created = await admin.systemAdmin.createOAuthClient({
      ...validClient,
      tokenEndpointAuthMethod: 'client_secret_post',
    });

    const [stored] = await db
      .select()
      .from(oauthClient)
      .where(eq(oauthClient.clientId, created.clientId));
    expect(created.clientSecret.length).toBeGreaterThan(20);
    expect(stored).toMatchObject({
      referenceId: PLATFORM_OAUTH_CLIENT_OWNER,
      userId: null,
      tokenEndpointAuthMethod: 'client_secret_post',
      redirectUris: validClient.redirectUris,
      metadata: expect.objectContaining({ registrationMethod: 'pre_registered' }),
    });
    expect(stored?.skipConsent).not.toBe(true);
    expect(stored?.clientSecret).not.toBe(created.clientSecret);

    const listed = await admin.systemAdmin.listOAuthClients({
      filters: { registrationMethod: 'pre_registered' },
      searchQuery: created.clientId,
    });
    expect(listed.items).toEqual([
      expect.objectContaining({
        clientId: created.clientId,
        name: 'Gemini Enterprise',
        registrationMethod: 'pre_registered',
        verifiedHost: null,
        disabled: false,
        connectionCount: 0,
      }),
    ]);
    expect(listed.items[0]).not.toHaveProperty('clientSecret');
  });

  it('lets any platform administrator rotate the secret', async () => {
    const created = await admin.systemAdmin.createOAuthClient(validClient);
    const [before] = await db
      .select({ secret: oauthClient.clientSecret })
      .from(oauthClient)
      .where(eq(oauthClient.clientId, created.clientId));
    // Another platform administrator than the one who created the client.
    const firstAdmin = await createAdminSession();
    const secondAdminUser = await createTestUser({ role: 'admin' });
    const secondAdmin = await adminClient({
      ...firstAdmin,
      user: { ...firstAdmin.user, id: secondAdminUser.id, email: secondAdminUser.email },
    });

    const rotated = await secondAdmin.systemAdmin.rotateOAuthClientSecret({
      clientId: created.clientId,
    });

    const [after] = await db
      .select({ secret: oauthClient.clientSecret })
      .from(oauthClient)
      .where(eq(oauthClient.clientId, created.clientId));
    expect(rotated.clientSecret).not.toBe(created.clientSecret);
    expect(after?.secret).not.toBe(before?.secret);
  });

  it('deletes a pre-registered client with its connections', async () => {
    const created = await admin.systemAdmin.createOAuthClient(validClient);
    const connected = await createRegularUserSession();
    await db.insert(oauthConsent).values({
      id: crypto.randomUUID(),
      clientId: created.clientId,
      userId: connected.user.id,
      scopes: ['mcp:read'],
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await expect(
      admin.systemAdmin.deleteOAuthClient({ clientId: created.clientId }),
    ).resolves.toEqual({ success: true });

    expect(
      await db.select().from(oauthClient).where(eq(oauthClient.clientId, created.clientId)),
    ).toEqual([]);
    expect(
      await db.select().from(oauthConsent).where(eq(oauthConsent.clientId, created.clientId)),
    ).toEqual([]);
  });

  it('refuses to rotate or delete clients that were not pre-registered', async () => {
    const dynamic = await insertClient({ metadata: { registrationMethod: 'dynamic' } });
    const cimd = await insertClient({
      clientId: `https://assistant.example/${crypto.randomUUID()}.json`,
      clientDiscoveryId: 'cimd',
    });

    for (const clientId of [dynamic, cimd]) {
      await expect(
        admin.systemAdmin.rotateOAuthClientSecret({ clientId }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      await expect(admin.systemAdmin.deleteOAuthClient({ clientId })).rejects.toMatchObject({
        code: 'BAD_REQUEST',
      });
    }
    await expect(
      admin.systemAdmin.deleteOAuthClient({ clientId: 'missing-client' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('listing and disabling any client', () => {
  it('filters by registration method and counts connections', async () => {
    const marker = crypto.randomUUID();
    const cimd = await insertClient({
      clientId: `https://filter.example/${marker}.json`,
      name: `Filter ${marker}`,
      clientDiscoveryId: 'cimd',
    });
    const dynamic = await insertClient({
      name: `Filter ${marker}`,
      metadata: { registrationMethod: 'dynamic' },
    });
    const unknown = await insertClient({ name: `Filter ${marker}` });
    const connected = await createRegularUserSession();
    await db.insert(oauthConsent).values({
      id: crypto.randomUUID(),
      clientId: dynamic,
      userId: connected.user.id,
      scopes: ['mcp:read'],
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const byMethod = async (registrationMethod: 'client_id_metadata_document' | 'dynamic' | 'unknown') =>
      (
        await admin.systemAdmin.listOAuthClients({
          searchQuery: marker,
          filters: { registrationMethod },
        })
      ).items.map(({ clientId, connectionCount, verifiedHost }) => ({
        clientId,
        connectionCount,
        verifiedHost,
      }));

    expect(await byMethod('client_id_metadata_document')).toEqual([
      { clientId: cimd, connectionCount: 0, verifiedHost: 'filter.example' },
    ]);
    expect(await byMethod('dynamic')).toEqual([
      { clientId: dynamic, connectionCount: 1, verifiedHost: null },
    ]);
    expect(await byMethod('unknown')).toEqual([
      { clientId: unknown, connectionCount: 0, verifiedHost: null },
    ]);
  });

  it('disables and re-enables a client', async () => {
    const clientId = await insertClient({ metadata: { registrationMethod: 'dynamic' } });

    await admin.systemAdmin.setOAuthClientDisabled({ clientId, disabled: true });
    const disabled = await admin.systemAdmin.listOAuthClients({
      searchQuery: clientId,
      filters: { disabled: true },
    });
    await admin.systemAdmin.setOAuthClientDisabled({ clientId, disabled: false });
    const [stored] = await db
      .select({ disabled: oauthClient.disabled })
      .from(oauthClient)
      .where(eq(oauthClient.clientId, clientId));

    expect(disabled.items.map(({ clientId: id }) => id)).toEqual([clientId]);
    expect(stored?.disabled).toBe(false);
    await expect(
      admin.systemAdmin.setOAuthClientDisabled({ clientId: 'missing', disabled: true }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
