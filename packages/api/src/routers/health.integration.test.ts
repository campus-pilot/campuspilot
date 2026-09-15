import { describe, expect, it } from 'vitest';

import { createAdminSession, createTestClient } from '../../test/fixtures';

describe('healthCheck integration test', () => {
  it('returns OK for unauthenticated public requests', async () => {
    const anonymousClient = createTestClient(null);
    const result = await anonymousClient.healthCheck();

    expect(result).toBe('OK');
  });

  it('returns OK for authenticated requests', async () => {
    const adminSession = await createAdminSession();
    const client = createTestClient(adminSession);
    const result = await client.healthCheck();

    expect(result).toBe('OK');
  });
});
