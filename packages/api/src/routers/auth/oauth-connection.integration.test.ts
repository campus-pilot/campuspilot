import { db } from '@campuspilot/db';
import {
  oauthAccessToken,
  oauthClient,
  oauthConsent,
  oauthRefreshToken,
} from '@campuspilot/db/schema/auth';
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import {
  createRegularUserSession,
  createTestClient,
  type UserSession,
} from '../../../test/fixtures';

async function insertClient(values: {
  clientId?: string;
  name?: string;
  clientDiscoveryId?: string | null;
  metadata?: Record<string, unknown> | null;
} = {}) {
  const clientId = values.clientId ?? `client_${crypto.randomUUID()}`;
  await db.insert(oauthClient).values({
    id: crypto.randomUUID(),
    clientId,
    name: values.name ?? 'Example Assistant',
    redirectUris: ['https://client.example/callback'],
    clientDiscoveryId: values.clientDiscoveryId ?? null,
    metadata: values.metadata ?? { registrationMethod: 'dynamic' },
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  return clientId;
}

/** A user's grant to a client, with live refresh and access tokens. */
async function connect(
  session: UserSession,
  clientId: string,
  values: { scopes?: string[]; createdAt?: Date; lastUsedAt?: Date | null } = {},
) {
  const userId = session.user.id;
  await db.insert(oauthConsent).values({
    id: crypto.randomUUID(),
    clientId,
    userId,
    scopes: values.scopes ?? ['mcp:read', 'mcp:write', 'offline_access'],
    createdAt: values.createdAt ?? new Date(),
    updatedAt: new Date(),
    lastUsedAt: values.lastUsedAt ?? null,
  });
  const refreshId = crypto.randomUUID();
  await db.insert(oauthRefreshToken).values({
    id: refreshId,
    token: crypto.randomUUID(),
    clientId,
    userId,
    scopes: ['mcp:read'],
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 86_400_000),
  });
  await db.insert(oauthAccessToken).values({
    id: crypto.randomUUID(),
    token: crypto.randomUUID(),
    clientId,
    userId,
    refreshId,
    scopes: ['mcp:read'],
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 3_600_000),
  });
}

describe('auth.listOAuthConnections', () => {
  it('requires a signed-in user', async () => {
    await expect(
      createTestClient(null).auth.listOAuthConnections({}),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('rejects a cursor together with a page', async () => {
    const client = createTestClient(await createRegularUserSession());

    await expect(
      client.auth.listOAuthConnections({ cursor: '2', page: 2 }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('lists only the user’s own connections with their identity facts, newest first', async () => {
    const session = await createRegularUserSession();
    const other = await createRegularUserSession();
    const cimdClientId = await insertClient({
      clientId: `https://claude.example/oauth/${crypto.randomUUID()}.json`,
      name: 'Claude',
      clientDiscoveryId: 'cimd',
      metadata: null,
    });
    const dynamicClientId = await insertClient({ name: 'Gemini CLI' });
    const lastUsedAt = new Date('2026-11-01T10:00:00.000Z');
    await connect(session, cimdClientId, {
      createdAt: new Date('2026-10-01T10:00:00.000Z'),
      lastUsedAt,
    });
    await connect(session, dynamicClientId, {
      scopes: ['mcp:read'],
      createdAt: new Date('2026-10-02T10:00:00.000Z'),
    });
    await connect(other, dynamicClientId);

    const result = await createTestClient(session).auth.listOAuthConnections({});

    expect(result.pagination).toMatchObject({ totalItems: 2, currentPage: 1 });
    expect(result.items).toEqual([
      {
        clientId: dynamicClientId,
        name: 'Gemini CLI',
        registrationMethod: 'dynamic',
        verifiedHost: null,
        scopes: ['mcp:read'],
        connectedAt: '2026-10-02T10:00:00.000Z',
        lastUsedAt: null,
      },
      {
        clientId: cimdClientId,
        name: 'Claude',
        registrationMethod: 'client_id_metadata_document',
        verifiedHost: 'claude.example',
        scopes: ['mcp:read', 'mcp:write', 'offline_access'],
        connectedAt: '2026-10-01T10:00:00.000Z',
        lastUsedAt: lastUsedAt.toISOString(),
      },
    ]);
  });
});

describe('auth.disconnectOAuthConnection', () => {
  it('requires a signed-in user and a client id', async () => {
    await expect(
      createTestClient(null).auth.disconnectOAuthConnection({ clientId: 'x' }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    await expect(
      createTestClient(await createRegularUserSession()).auth.disconnectOAuthConnection({
        clientId: '',
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('deletes the grant and revokes its tokens, leaving other users connected', async () => {
    const session = await createRegularUserSession();
    const other = await createRegularUserSession();
    const clientId = await insertClient();
    await connect(session, clientId);
    await connect(other, clientId);

    await expect(
      createTestClient(session).auth.disconnectOAuthConnection({ clientId }),
    ).resolves.toEqual({ success: true });

    const consents = await db
      .select({ userId: oauthConsent.userId })
      .from(oauthConsent)
      .where(eq(oauthConsent.clientId, clientId));
    expect(consents).toEqual([{ userId: other.user.id }]);
    for (const table of [oauthRefreshToken, oauthAccessToken]) {
      const mine = await db
        .select({ revoked: table.revoked })
        .from(table)
        .where(and(eq(table.clientId, clientId), eq(table.userId, session.user.id)));
      const theirs = await db
        .select({ revoked: table.revoked })
        .from(table)
        .where(and(eq(table.clientId, clientId), eq(table.userId, other.user.id)));
      expect(mine.every(({ revoked }) => revoked instanceof Date)).toBe(true);
      expect(theirs.every(({ revoked }) => revoked === null)).toBe(true);
    }
  });

  it('cannot disconnect another user’s connection', async () => {
    const session = await createRegularUserSession();
    const other = await createRegularUserSession();
    const clientId = await insertClient();
    await connect(other, clientId);

    await expect(
      createTestClient(session).auth.disconnectOAuthConnection({ clientId }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const consents = await db
      .select()
      .from(oauthConsent)
      .where(eq(oauthConsent.clientId, clientId));
    expect(consents).toHaveLength(1);
  });
});
