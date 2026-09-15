import { auth } from '@campuspilot/auth/server';
import { db } from '@campuspilot/db';
import { account } from '@campuspilot/db/schema/auth';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import {
  createRegularUserSession,
  createTestClient,
} from '../../../test/fixtures';

describe('auth.setPassword integration', () => {
  it('sets a password for an authenticated account without credentials', async () => {
    const email = `set-password-${crypto.randomUUID()}@example.com`;
    const password = 'NewPassword456!';
    const response = await auth.api.signUpEmail({
      body: { email, password: 'TemporaryPassword123!', name: 'Password User' },
      asResponse: true,
    });
    const setCookie = response.headers.get('set-cookie');
    expect(setCookie).toBeTruthy();

    const headers = new Headers({ cookie: setCookie! });
    const session = await auth.api.getSession({ headers });
    expect(session).toBeTruthy();
    await db
      .delete(account)
      .where(eq(account.userId, session!.user.id));

    await expect(
      createTestClient(session, headers).auth.setPassword({
        newPassword: password,
      }),
    ).resolves.toEqual({ success: true });

    await expect(
      auth.api.signInEmail({ body: { email, password } }),
    ).resolves.toMatchObject({ user: { email } });
  });

  it('rejects anonymous callers', async () => {
    await expect(
      createTestClient(null).auth.setPassword({
        newPassword: 'NewPassword456!',
      }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('rejects passwords shorter than the configured minimum', async () => {
    const session = await createRegularUserSession();

    await expect(
      createTestClient(session).auth.setPassword({ newPassword: 'short' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });
});
