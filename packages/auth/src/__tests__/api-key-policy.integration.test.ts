import { db } from '@campuspilot/db';
import { apikey } from '@campuspilot/db/schema/auth';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import {
  API_KEY_DEFAULT_EXPIRY_DAYS,
  API_KEY_MAX_ACTIVE_PER_USER,
  apiKeyExpiresInSeconds,
} from '../api-key-policy';
import { auth } from '../server';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Signs up a regular (non-admin) user and returns their cookie headers. */
async function signUpRegularUser(label: string) {
  const response = await auth.api.signUpEmail({
    body: {
      email: `${label}_${crypto.randomUUID()}@example.com`,
      password: 'Password123!',
      name: `${label} user`,
    },
    asResponse: true,
  });
  const headers = new Headers({
    cookie: response.headers.get('set-cookie') ?? '',
  });
  const session = await auth.api.getSession({ headers });
  if (!session) throw new Error('Expected a session after sign-up.');
  expect(session.user.role).toBe('user');
  return { headers, userId: session.user.id };
}

async function sessionForKey(key: string) {
  return auth.api.getSession({ headers: new Headers({ 'x-api-key': key }) });
}

describe('user API-key policy', () => {
  it('lets a regular user create, list and delete their own keys', async () => {
    const owner = await signUpRegularUser('owner');

    const created = await auth.api.createApiKey({
      body: { name: 'Claude Code' },
      headers: owner.headers,
    });
    const listed = await auth.api.listApiKeys({ headers: owner.headers });

    expect(created.key.startsWith('cp_')).toBe(true);
    expect(listed.apiKeys.map(({ id }) => id)).toEqual([created.id]);
    expect(listed.apiKeys[0]).not.toHaveProperty('key');

    await auth.api.deleteApiKey({
      body: { keyId: created.id },
      headers: owner.headers,
    });
    expect(
      (await auth.api.listApiKeys({ headers: owner.headers })).apiKeys,
    ).toEqual([]);
  });

  it('never exposes or deletes another user’s keys', async () => {
    const owner = await signUpRegularUser('victim');
    const other = await signUpRegularUser('intruder');
    const created = await auth.api.createApiKey({
      body: { name: 'Owner key' },
      headers: owner.headers,
    });

    const otherList = await auth.api.listApiKeys({ headers: other.headers });
    expect(otherList.apiKeys.map(({ id }) => id)).not.toContain(created.id);
    await expect(
      auth.api.deleteApiKey({
        body: { keyId: created.id },
        headers: other.headers,
      }),
    ).rejects.toMatchObject({ statusCode: 404 });
    await expect(
      auth.api.getApiKey({ query: { id: created.id }, headers: other.headers }),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect((await sessionForKey(created.key))?.user.id).toBe(owner.userId);
  });

  it('expires keys after 90 days by default and refuses longer or permanent keys', async () => {
    const owner = await signUpRegularUser('expiry');

    const before = Date.now();
    const created = await auth.api.createApiKey({
      body: { name: 'Default expiry' },
      headers: owner.headers,
    });
    const explicitNull = await auth.api.createApiKey({
      body: { name: 'Null expiry', expiresIn: null },
      headers: owner.headers,
    });

    for (const key of [created, explicitNull]) {
      const expiresAt = new Date(key.expiresAt!).getTime();
      expect(expiresAt - before).toBeGreaterThanOrEqual(
        API_KEY_DEFAULT_EXPIRY_DAYS * DAY_MS,
      );
      expect(expiresAt - before).toBeLessThan(
        (API_KEY_DEFAULT_EXPIRY_DAYS + 1) * DAY_MS,
      );
    }
    await expect(
      auth.api.createApiKey({
        body: { name: 'Too long', expiresIn: apiKeyExpiresInSeconds(366) },
        headers: owner.headers,
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
    await expect(
      auth.api.updateApiKey({
        body: { keyId: created.id, expiresIn: null },
        headers: owner.headers,
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
    await expect(
      auth.api.createApiKey({
        body: { name: 'One year', expiresIn: apiKeyExpiresInSeconds(365) },
        headers: owner.headers,
      }),
    ).resolves.toMatchObject({ name: 'One year' });
  });

  it('allows at most ten active keys per user, not counting expired keys', async () => {
    const owner = await signUpRegularUser('limit');
    const keys = [];
    for (let index = 0; index < API_KEY_MAX_ACTIVE_PER_USER; index += 1) {
      keys.push(
        await auth.api.createApiKey({
          body: { name: `Key ${index}` },
          headers: owner.headers,
        }),
      );
    }

    await expect(
      auth.api.createApiKey({
        body: { name: 'One too many' },
        headers: owner.headers,
      }),
    ).rejects.toMatchObject({
      statusCode: 400,
      body: { code: 'API_KEY_LIMIT_REACHED' },
    });

    await db
      .update(apikey)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(apikey.id, keys[0]!.id));
    await expect(
      auth.api.createApiKey({
        body: { name: 'Replaces the expired key' },
        headers: owner.headers,
      }),
    ).resolves.toMatchObject({ name: 'Replaces the expired key' });
  });

  it('never rate-limits a key, including keys stored with limiting enabled', async () => {
    const owner = await signUpRegularUser('rapid');
    const created = await auth.api.createApiKey({
      body: { name: 'Busy agent' },
      headers: owner.headers,
    });
    // Simulate a key created while per-key limiting was still configured.
    await db
      .update(apikey)
      .set({ rateLimitEnabled: true, rateLimitMax: 1, rateLimitTimeWindow: 60_000 })
      .where(eq(apikey.id, created.id));

    const results = await Promise.all(
      Array.from({ length: 150 }, () =>
        auth.api.verifyApiKey({ body: { key: created.key } }),
      ),
    );

    expect(results.every(({ valid }) => valid)).toBe(true);
    expect(results.map(({ error }) => error?.code)).not.toContain(
      'RATE_LIMITED',
    );
  });

  it('stops authenticating expired and deleted keys', async () => {
    const owner = await signUpRegularUser('revoked');
    const expired = await auth.api.createApiKey({
      body: { name: 'Expired' },
      headers: owner.headers,
    });
    const deleted = await auth.api.createApiKey({
      body: { name: 'Deleted' },
      headers: owner.headers,
    });
    expect((await sessionForKey(expired.key))?.user.id).toBe(owner.userId);

    await db
      .update(apikey)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(apikey.id, expired.id));
    await auth.api.deleteApiKey({
      body: { keyId: deleted.id },
      headers: owner.headers,
    });

    await expect(sessionForKey(expired.key)).rejects.toMatchObject({
      statusCode: 401,
    });
    await expect(sessionForKey(deleted.key)).rejects.toMatchObject({
      statusCode: 401,
    });
  });
});
