import { db } from '@campuspilot/db';
import { oauthClient } from '@campuspilot/db/schema/auth';
import { describe, expect, it } from 'vitest';

import {
  createRegularUserSession,
  createTestClient,
} from '../../../test/fixtures';

async function insertClient(values: {
  clientId?: string;
  name?: string;
  disabled?: boolean;
  clientDiscoveryId?: string | null;
  metadata?: Record<string, unknown> | null;
}) {
  const clientId = values.clientId ?? `client_${crypto.randomUUID()}`;
  await db.insert(oauthClient).values({
    id: crypto.randomUUID(),
    clientId,
    name: values.name ?? 'Example Assistant',
    uri: 'https://client.example',
    redirectUris: ['https://client.example/callback'],
    disabled: values.disabled ?? false,
    clientDiscoveryId: values.clientDiscoveryId ?? null,
    metadata: values.metadata ?? null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  return clientId;
}

describe('auth.getOAuthConsentClient', () => {
  it('requires a signed-in user', async () => {
    const clientId = await insertClient({});

    await expect(
      createTestClient(null).auth.getOAuthConsentClient({ clientId }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('validates the client id before reading', async () => {
    const client = createTestClient(await createRegularUserSession());

    await expect(
      client.auth.getOAuthConsentClient({ clientId: '' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('reports a CIMD client with its document host as verified identity', async () => {
    const clientId = await insertClient({
      clientId: `https://assistant.example/oauth/${crypto.randomUUID()}.json`,
      clientDiscoveryId: 'cimd',
    });
    const client = createTestClient(await createRegularUserSession());

    await expect(
      client.auth.getOAuthConsentClient({ clientId }),
    ).resolves.toEqual({
      clientId,
      name: 'Example Assistant',
      uri: 'https://client.example',
      registrationMethod: 'client_id_metadata_document',
      verifiedHost: 'assistant.example',
    });
  });

  it.each([
    ['dynamic', { registrationMethod: 'dynamic' }, 'dynamic'],
    ['pre-registered', { registrationMethod: 'pre_registered' }, 'pre_registered'],
    ['unrecorded', null, 'unknown'],
  ] as const)('reports a %s client without a verified host', async (_label, metadata, method) => {
    const clientId = await insertClient({ metadata });
    const client = createTestClient(await createRegularUserSession());

    await expect(
      client.auth.getOAuthConsentClient({ clientId }),
    ).resolves.toMatchObject({ registrationMethod: method, verifiedHost: null });
  });

  it('treats missing and disabled clients as not found', async () => {
    const disabled = await insertClient({ disabled: true });
    const client = createTestClient(await createRegularUserSession());

    for (const clientId of [disabled, 'missing-client']) {
      await expect(
        client.auth.getOAuthConsentClient({ clientId }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    }
  });
});
