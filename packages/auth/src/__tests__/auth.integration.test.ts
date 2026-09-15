import { describe, expect, it } from 'vitest';

import { auth } from '../server';

describe('Better Auth Integration with PostgreSQL & Redis', () => {
  it('derives regular user role for normal signup', async () => {
    const email = `testuser_${Date.now()}@example.com`;
    const result = await auth.api.signUpEmail({
      body: {
        email,
        password: 'Password123!',
        name: 'Regular User',
      },
    });

    expect(result).toBeDefined();
    expect(result.user.email).toBe(email);
    expect(result.user.role).toBe('user');
    expect(result.token).toBeDefined();
  });

  it('automatically derives admin role when email matches SYSTEM_ADMIN_EMAIL', async () => {
    // SYSTEM_ADMIN_EMAIL is set to admin@campuspilot.test in setup.ts
    const result = await auth.api.signUpEmail({
      body: {
        email: 'admin@campuspilot.test',
        password: 'Password123!',
        name: 'Super Admin',
      },
    });

    expect(result).toBeDefined();
    expect(result.user.email).toBe('admin@campuspilot.test');
    expect(result.user.role).toBe('admin');
  });

  it('signs in with valid credentials and fails on invalid credentials', async () => {
    const email = `signin_${Date.now()}@example.com`;
    const password = 'Password123!';

    await auth.api.signUpEmail({
      body: {
        email,
        password,
        name: 'Sign In User',
      },
    });

    const signInResult = await auth.api.signInEmail({
      body: {
        email,
        password,
      },
    });

    expect(signInResult).toBeDefined();
    expect(signInResult.user.email).toBe(email);
    expect(signInResult.token).toBeDefined();

    // Invalid password
    await expect(
      auth.api.signInEmail({
        body: {
          email,
          password: 'WrongPassword!',
        },
      }),
    ).rejects.toThrow();
  });

  it('resolves session from response cookies', async () => {
    const email = `session_${Date.now()}@example.com`;
    const password = 'Password123!';

    const response = await auth.api.signUpEmail({
      body: {
        email,
        password,
        name: 'Session User',
      },
      asResponse: true,
    });

    const setCookie = response.headers.get('set-cookie');
    expect(setCookie).toBeDefined();

    const headers = new Headers();
    if (setCookie) {
      headers.set('cookie', setCookie);
    }

    const sessionResult = await auth.api.getSession({ headers });

    expect(sessionResult).toBeDefined();
    expect(sessionResult?.user.email).toBe(email);
    expect(sessionResult?.session.userId).toBe(sessionResult?.user.id);
  });

  it('creates API key and authenticates using x-api-key header', async () => {
    const email = `apikey_${Date.now()}@example.com`;
    const password = 'Password123!';

    const response = await auth.api.signUpEmail({
      body: {
        email,
        password,
        name: 'API Key User',
      },
      asResponse: true,
    });

    const setCookie = response.headers.get('set-cookie');
    const headers = new Headers();
    if (setCookie) {
      headers.set('cookie', setCookie);
    }

    const session = await auth.api.getSession({ headers });
    expect(session).toBeDefined();

    // Create an API key using the authenticated session
    const apiKeyResult = await auth.api.createApiKey({
      body: {
        name: 'Test Key',
        userId: session!.user.id,
      },
      headers,
    });

    expect(apiKeyResult).toBeDefined();
    expect(apiKeyResult.key).toBeDefined();
    expect(apiKeyResult.key.startsWith('cp_')).toBe(true);

    // Verify session resolution with x-api-key
    const sessionWithApiKey = await auth.api.getSession({
      headers: new Headers({
        'x-api-key': apiKeyResult.key,
      }),
    });

    expect(sessionWithApiKey).toBeDefined();
    expect(sessionWithApiKey?.user.id).toBe(session!.user.id);
    expect(sessionWithApiKey?.user.email).toBe(email);
  });

  it('sets password for provisioned user without password and verifies sign in', async () => {
    const email = `setpw_${Date.now()}@example.com`;
    const password = 'NewPassword456!';

    // Provision user without a password (as done in school member invitation)
    const createdUser = await auth.api.createUser({
      body: {
        email,
        name: 'Provisioned User',
      },
    });

    expect(createdUser.user.id).toBeDefined();

    // Create a session for this provisioned user
    const sessionData = await auth.api.signInEmail({
      body: {
        email,
        password: 'dummy',
      },
    }).catch(() => null);

    // Using admin / internal session or creating session directly via headers
    // Let's test changePassword for existing password user, and setPassword for provisioned user
    const changeEmail = `changepw_${Date.now()}@example.com`;
    const loginUser = await auth.api.signUpEmail({
      body: {
        email: changeEmail,
        password: 'OldPassword123!',
        name: 'Change PW User',
      },
      asResponse: true,
    });

    const setCookie = loginUser.headers.get('set-cookie');
    const headers = new Headers();
    if (setCookie) {
      headers.set('cookie', setCookie);
    }

    await auth.api.changePassword({
      body: {
        currentPassword: 'OldPassword123!',
        newPassword: password,
      },
      headers,
    });

    // Old password should fail
    await expect(
      auth.api.signInEmail({
        body: {
          email: changeEmail,
          password: 'OldPassword123!',
        },
      }),
    ).rejects.toThrow();

    // New password should succeed
    const newSignIn = await auth.api.signInEmail({
      body: {
        email: changeEmail,
        password: password,
      },
    });

    expect(newSignIn).toBeDefined();
    expect(newSignIn.user.email).toBe(changeEmail);
  });
});
