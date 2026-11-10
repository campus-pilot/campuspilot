import { createDb } from '@campuspilot/db';
import { cadetPushSubscriptionTable } from '@campuspilot/db/schema/notification';
import { admissionTable } from '@campuspilot/db/schema/admission';
import * as staffSchema from '@campuspilot/db/schema/auth';
import * as cadetSchema from '@campuspilot/db/schema/cadet';
import { schoolTable } from '@campuspilot/db/schema/school';
import { schoolFeatureFlagTable } from '@campuspilot/db/schema/school-feature-flag';
import { generateId } from '@campuspilot/db/id';
import { eq, inArray } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';

import {
  cadetOauthIssuer,
  createCadetAuth,
  revokeCadetLoginAccess,
} from '../cadet';
import { issueCadetLogin } from '../cadet-login';
import { CADET_PASSWORD_WORDS, generateCadetPassword } from '../cadet-password';
import {
  CADET_ADMISSION_MAX_FAILURES,
  cadetPlaceholderEmail,
} from '../cadet-policy';
import type { SignInLimiter } from '../cadet-sign-in-limits';
import {
  CADET_OAUTH_GRANT_TABLES,
  findLiveOAuthGrant,
  verifyMcpAccessToken,
} from '../mcp-credential';
import { auth as staffAuth } from '../server';
import { pkce, StubMetadataHost } from './oauth-test-utils';

const API_ORIGIN = 'http://localhost:3000';
const CADET_ORIGIN = 'http://localhost:3004';
const CADET_BASE = `${API_ORIGIN}/api/cadet/auth`;
const CADET_RESOURCE = 'http://localhost:3000/cadet/mcp';

/** In-memory limiter so tests control lockout without sharing Redis keys. */
function memoryLimiter(): SignInLimiter {
  const failures = new Map<string, number>();
  const locks = new Map<string, number>();
  return {
    lockedFor: async (key) => {
      const until = locks.get(key) ?? 0;
      return until > Date.now() ? Math.ceil((until - Date.now()) / 1000) : 0;
    },
    recordFailure: async (key, limit) => {
      const count = (failures.get(key) ?? 0) + 1;
      if (count < limit.maxFailures) {
        failures.set(key, count);
        return false;
      }
      failures.delete(key);
      locks.set(key, Date.now() + limit.lockSeconds * 1000);
      return true;
    },
    clearFailures: async (key) => {
      failures.delete(key);
    },
  };
}

const db = createDb();
const metadataHost = new StubMetadataHost();
const cadetAuth = createCadetAuth(db, {
  fetchClientMetadataResource: metadataHost.fetch,
  limiter: memoryLimiter(),
});

afterAll(async () => {
  await db.$client.end();
});

function cookiesOf(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0])
    .join('; ');
}

async function staffUserId() {
  const result = await staffAuth.api.signUpEmail({
    body: {
      email: `staff_${randomUUID()}@example.com`,
      password: 'Password123!',
      name: 'Staff',
    },
  });
  return result.user.id;
}

async function createAdmissionWithLogin(options: { registered?: boolean } = {}) {
  const slug = `cadet-${randomUUID().slice(0, 8)}`;
  const [school] = await db
    .insert(schoolTable)
    .values({ slug, name: `School ${slug}`, location: 'Town' })
    .returning();
  // A new school has no platform feature; these suites test the portal of
  // a school that has the Cadet Portal.
  await db
    .insert(schoolFeatureFlagTable)
    .values({ schoolId: school!.id, feature: 'cadet', enabled: true });
  const admissionNo = `ADM-${randomUUID().slice(0, 6)}`;
  const [admission] = await db
    .insert(admissionTable)
    .values({
      id: generateId('admission'),
      schoolId: school!.id,
      name: 'Asha Kumari',
      admissionNo,
      address: 'Main road',
      phoneNo: '9999999999',
      whatsappSameAsPhone: true,
      dob: '2018-04-01',
      fatherName: 'Father',
      motherName: 'Mother',
      registered: options.registered ?? true,
    })
    .returning();
  const issued = await issueCadetLogin(db, {
    admissionId: admission!.id,
    issuedBy: await staffUserId(),
  });
  return { school: school!, admission: admission!, ...issued };
}

function signIn(
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
) {
  return cadetAuth.handler(
    new Request(`${CADET_BASE}/sign-in/admission`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: CADET_ORIGIN,
        ...headers,
      },
      body: JSON.stringify(body),
    }),
  );
}

describe('cadet password generator', () => {
  it('generates two different list words and a two-digit number', () => {
    for (let index = 0; index < 200; index += 1) {
      const [first, second, number, ...rest] = generateCadetPassword().split('-');
      expect(rest).toEqual([]);
      expect(CADET_PASSWORD_WORDS).toContain(first);
      expect(CADET_PASSWORD_WORDS).toContain(second);
      expect(first).not.toBe(second);
      expect(Number(number)).toBeGreaterThanOrEqual(10);
      expect(Number(number)).toBeLessThanOrEqual(99);
    }
  });

  it('keeps the word list unique, simple and free of one-edit neighbours', () => {
    expect(new Set(CADET_PASSWORD_WORDS).size).toBe(CADET_PASSWORD_WORDS.length);
    expect(CADET_PASSWORD_WORDS.length).toBeGreaterThanOrEqual(500);
    for (const word of CADET_PASSWORD_WORDS) {
      expect(word).toMatch(/^[a-z]{3,9}$/);
    }
    const oneEditApart = (a: string, b: string) => {
      if (Math.abs(a.length - b.length) > 1) return false;
      let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
      for (let i = 1; i <= a.length; i += 1) {
        const current = [i];
        for (let j = 1; j <= b.length; j += 1) {
          current[j] = Math.min(
            previous[j]! + 1,
            current[j - 1]! + 1,
            previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
          );
        }
        previous = current;
      }
      return previous[b.length]! <= 1;
    };
    const words = [...CADET_PASSWORD_WORDS];
    const neighbours = words.flatMap((word, index) =>
      words.slice(index + 1).filter((other) => oneEditApart(word, other)).map((other) => `${word}/${other}`),
    );
    expect(neighbours).toEqual([]);
  });
});

describe('cadet admission sign-in', () => {
  it('signs in with school code, admission number and password and sets a cpc_ cookie', async () => {
    const { school, admission, password, userId } = await createAdmissionWithLogin();
    const response = await signIn({
      schoolSlug: school.slug.toUpperCase(),
      admissionNo: ` ${admission.admissionNo} `,
      password,
    });
    expect(response.status).toBe(200);
    const cookie = cookiesOf(response);
    expect(cookie).toMatch(/^cpc_\.session_token=/);
    expect(cookie).not.toMatch(/(^|; )cp_\./);

    const session = await cadetAuth.api.getSession({ headers: new Headers({ cookie }) });
    expect(session?.user.id).toBe(userId);
    expect(session?.user.email).toBe(cadetPlaceholderEmail(admission.id));
    // The staff instance never sees the cadet session.
    expect(await staffAuth.api.getSession({ headers: new Headers({ cookie }) })).toBeNull();
  });

  it('rejects a wrong password, an unknown admission and an unknown school with one message', async () => {
    const { school, admission } = await createAdmissionWithLogin();
    const attempts = [
      { schoolSlug: school.slug, admissionNo: admission.admissionNo, password: 'wrong-word-11' },
      { schoolSlug: school.slug, admissionNo: 'NOPE', password: 'wrong-word-11' },
      { schoolSlug: 'no-such-school', admissionNo: admission.admissionNo, password: 'wrong-word-11' },
    ];
    for (const body of attempts) {
      const response = await signIn(body);
      expect(response.status).toBe(401);
      expect(((await response.json()) as { code: string }).code).toBe('INVALID_CADET_CREDENTIALS');
    }
  });

  it('treats a school without the cadet feature like an unknown school, even with the right password', async () => {
    const { school, admission, password } = await createAdmissionWithLogin();
    const credentials = { schoolSlug: school.slug, admissionNo: admission.admissionNo, password };
    const setCadetFeature = (enabled: boolean) =>
      db
        .update(schoolFeatureFlagTable)
        .set({ enabled })
        .where(eq(schoolFeatureFlagTable.schoolId, school.id));

    await setCadetFeature(false);
    // More attempts than the per-admission limit: a disabled school's
    // admissions are not resolved, so none of them counts or locks.
    for (let attempt = 0; attempt <= CADET_ADMISSION_MAX_FAILURES; attempt += 1) {
      const response = await signIn(credentials);
      expect(response.status).toBe(401);
      expect(((await response.json()) as { code: string }).code).toBe('INVALID_CADET_CREDENTIALS');
      expect(cookiesOf(response)).toBe('');
    }

    // The login was kept: it works again once the feature is enabled.
    await setCadetFeature(true);
    expect((await signIn(credentials)).status).toBe(200);

    // A school that never had a flag row is disabled too (missing row = off).
    await db.delete(schoolFeatureFlagTable).where(eq(schoolFeatureFlagTable.schoolId, school.id));
    const missing = await signIn(credentials);
    expect(missing.status).toBe(401);
    expect(((await missing.json()) as { code: string }).code).toBe('INVALID_CADET_CREDENTIALS');
  });

  it('locks an admission after repeated failures, even for the right password', async () => {
    const { school, admission, password } = await createAdmissionWithLogin();
    for (let index = 0; index < CADET_ADMISSION_MAX_FAILURES; index += 1) {
      const response = await signIn({ schoolSlug: school.slug, admissionNo: admission.admissionNo, password: 'wrong-word-11' });
      expect(response.status).toBe(401);
    }
    const locked = await signIn({ schoolSlug: school.slug, admissionNo: admission.admissionNo, password });
    expect(locked.status).toBe(429);
    expect(((await locked.json()) as { code: string }).code).toBe('CADET_SIGN_IN_LOCKED');
  });

  it('locks an admission without a cadet login exactly like one with a login', async () => {
    const { school } = await createAdmissionWithLogin();
    const [withoutLogin] = await db
      .insert(admissionTable)
      .values({
        id: generateId('admission'),
        schoolId: school.id,
        name: 'No Login',
        admissionNo: `NOLOGIN-${randomUUID().slice(0, 6)}`,
        address: 'Main road',
        phoneNo: '9999999999',
        whatsappSameAsPhone: true,
        dob: '2018-04-01',
        fatherName: 'Father',
        motherName: 'Mother',
      })
      .returning();
    const body = { schoolSlug: school.slug, admissionNo: withoutLogin!.admissionNo, password: 'wrong-word-11' };
    const statuses: number[] = [];
    for (let index = 0; index <= CADET_ADMISSION_MAX_FAILURES; index += 1) {
      statuses.push((await signIn(body)).status);
    }
    expect(statuses).toEqual([...Array(CADET_ADMISSION_MAX_FAILURES).fill(401), 429]);
  });

  it('follows the live admission number: the new one works and the old one stops', async () => {
    const { school, admission, password } = await createAdmissionWithLogin();
    const renamed = `${admission.admissionNo}-R`;
    await db.update(admissionTable).set({ admissionNo: renamed }).where(eq(admissionTable.id, admission.id));

    expect((await signIn({ schoolSlug: school.slug, admissionNo: renamed, password })).status).toBe(200);
    expect((await signIn({ schoolSlug: school.slug, admissionNo: admission.admissionNo, password })).status).toBe(401);
  });

  it('still signs in an unregistered admission', async () => {
    const { school, admission, password } = await createAdmissionWithLogin({ registered: false });
    expect((await signIn({ schoolSlug: school.slug, admissionNo: admission.admissionNo, password })).status).toBe(200);
  });

  it('disables email sign-in and sign-up, so the placeholder email cannot be used', async () => {
    const { admission, password } = await createAdmissionWithLogin();
    for (const [path, body] of [
      ['/sign-in/email', { email: cadetPlaceholderEmail(admission.id), password }],
      ['/sign-up/email', { email: `x_${randomUUID()}@example.com`, password: 'Password123!', name: 'X' }],
    ] as const) {
      const response = await cadetAuth.handler(
        new Request(`${CADET_BASE}${path}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', origin: CADET_ORIGIN },
          body: JSON.stringify(body),
        }),
      );
      expect(response.status).toBe(404);
    }
  });

  it('trusts only the cadet app origin', async () => {
    // Better Auth skips its origin check under NODE_ENV=test, so the
    // configuration itself is asserted.
    const context = await cadetAuth.$context;
    expect(context.trustedOrigins).toEqual(expect.arrayContaining([CADET_ORIGIN]));
    expect(context.trustedOrigins).not.toContain('http://localhost:3001');
    expect((await staffAuth.$context).trustedOrigins).not.toContain(CADET_ORIGIN);
  });

  it('never stores the admission number at the auth level', async () => {
    const { admission, userId } = await createAdmissionWithLogin();
    const [login] = await db.select().from(cadetSchema.cadetUser).where(eq(cadetSchema.cadetUser.id, userId));
    expect(JSON.stringify(login)).not.toContain(admission.admissionNo);
    expect(login).toMatchObject({ admissionId: admission.id, passwordSource: 'issued' });
    expect(login?.issuedAt).toBeInstanceOf(Date);
    expect(login?.issuedBy).toEqual(expect.any(String));
  });
});

describe('cadet MCP OAuth stores everything in cadet_* tables', () => {
  it('runs a full authorization in cadet tables only and issues tokens staff never accepts', async () => {
    const { school, admission, password, userId } = await createAdmissionWithLogin();

    const registration = await cadetAuth.handler(
      new Request(`${CADET_BASE}/oauth2/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          client_name: 'Cadet CLI',
          redirect_uris: ['http://127.0.0.1:43123/oauth/callback'],
          token_endpoint_auth_method: 'none',
          grant_types: ['authorization_code', 'refresh_token'],
          response_types: ['code'],
        }),
      }),
    );
    expect(registration.status).toBe(201);
    const clientId = ((await registration.json()) as { client_id: string }).client_id;
    const redirectUri = 'http://127.0.0.1:43123/oauth/callback';

    const { verifier, challenge } = pkce();
    const authorize = new URL(`${CADET_BASE}/oauth2/authorize`);
    for (const [key, value] of Object.entries({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: 'mcp:read offline_access',
      state: 'state-1',
      resource: CADET_RESOURCE,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    })) authorize.searchParams.set(key, value);
    const login = await cadetAuth.handler(
      new Request(authorize, { headers: { accept: 'text/html', 'sec-fetch-mode': 'navigate' }, redirect: 'manual' }),
    );
    const loginLocation = login.headers.get('location') ?? '';
    expect(loginLocation.startsWith(`${CADET_ORIGIN}/sign-in`)).toBe(true);

    const signedIn = await signIn({
      schoolSlug: school.slug,
      admissionNo: admission.admissionNo,
      password,
      oauth_query: new URL(loginLocation).search.slice(1),
    });
    const consentUrl = ((await signedIn.json()) as { url?: string }).url ?? '';
    expect(consentUrl.startsWith(`${CADET_ORIGIN}/oauth/consent`)).toBe(true);
    const cookie = cookiesOf(signedIn);

    const consent = await cadetAuth.handler(
      new Request(`${CADET_BASE}/oauth2/consent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: CADET_ORIGIN, cookie },
        body: JSON.stringify({ accept: true, oauth_query: new URL(consentUrl).search.slice(1) }),
      }),
    );
    const callback = new URL(((await consent.json()) as { url: string }).url);
    const code = callback.searchParams.get('code')!;

    const token = await cadetAuth.handler(
      new Request(`${CADET_BASE}/oauth2/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: redirectUri,
          client_id: clientId,
          code_verifier: verifier,
          resource: CADET_RESOURCE,
        }).toString(),
      }),
    );
    expect(token.status).toBe(200);
    const tokens = (await token.json()) as { access_token: string; refresh_token: string };

    // Rows exist in the cadet tables...
    const [cadetClients, cadetConsents, cadetRefresh, cadetSessions, cadetKeys] = await Promise.all([
      db.select().from(cadetSchema.cadetOauthClient).where(eq(cadetSchema.cadetOauthClient.clientId, clientId)),
      db.select().from(cadetSchema.cadetOauthConsent).where(eq(cadetSchema.cadetOauthConsent.userId, userId)),
      db.select().from(cadetSchema.cadetOauthRefreshToken).where(eq(cadetSchema.cadetOauthRefreshToken.userId, userId)),
      db.select().from(cadetSchema.cadetSession).where(eq(cadetSchema.cadetSession.userId, userId)),
      db.select().from(cadetSchema.cadetJwks),
    ]);
    expect(cadetClients).toHaveLength(1);
    expect(cadetConsents).toHaveLength(1);
    expect(cadetRefresh).toHaveLength(1);
    expect(cadetSessions.length).toBeGreaterThan(0);
    expect(cadetKeys.length).toBeGreaterThan(0);

    // ...and none in the staff tables.
    const [staffClients, staffConsents, staffRefresh, staffSessions, staffUsers, staffKeys] = await Promise.all([
      db.select().from(staffSchema.oauthClient).where(eq(staffSchema.oauthClient.clientId, clientId)),
      db.select().from(staffSchema.oauthConsent).where(eq(staffSchema.oauthConsent.userId, userId)),
      db.select().from(staffSchema.oauthRefreshToken).where(eq(staffSchema.oauthRefreshToken.userId, userId)),
      db.select().from(staffSchema.session).where(eq(staffSchema.session.userId, userId)),
      db.select().from(staffSchema.user).where(eq(staffSchema.user.id, userId)),
      db.select().from(staffSchema.jwks).where(inArray(staffSchema.jwks.id, cadetKeys.map((key) => key.id))),
    ]);
    expect([staffClients, staffConsents, staffRefresh, staffSessions, staffUsers, staffKeys]).toEqual([[], [], [], [], [], []]);

    // The cadet token verifies only against the cadet issuer and resource.
    const claims = await verifyMcpAccessToken(cadetAuth, tokens.access_token, {
      issuer: cadetOauthIssuer(),
      audience: CADET_RESOURCE,
    });
    expect(claims).toMatchObject({ userId, clientId, scopes: expect.arrayContaining(['mcp:read']) });
    expect(claims?.scopes).not.toContain('mcp:write');
    expect(await verifyMcpAccessToken(staffAuth, tokens.access_token)).toBeNull();
    expect(await verifyMcpAccessToken(cadetAuth, tokens.access_token)).toBeNull();
    expect(await findLiveOAuthGrant(db, claims!)).toBeNull();
    expect(await findLiveOAuthGrant(db, claims!, CADET_OAUTH_GRANT_TABLES)).not.toBeNull();

    // Revoking signs the login out everywhere, disconnects the client and
    // stops web push to its devices.
    await db.insert(cadetPushSubscriptionTable).values({ cadetUserId: userId, endpoint: 'https://fcm.googleapis.com/fcm/send/revoke-test', p256dh: 'key', auth: 'secret' });
    await revokeCadetLoginAccess([userId], cadetAuth, db);
    const subscriptions = await db.select().from(cadetPushSubscriptionTable).where(eq(cadetPushSubscriptionTable.cadetUserId, userId));
    expect(subscriptions).toHaveLength(1);
    expect(subscriptions[0]!.revokedAt).toBeInstanceOf(Date);
    expect(await cadetAuth.api.getSession({ headers: new Headers({ cookie }) })).toBeNull();
    expect(await findLiveOAuthGrant(db, claims!, CADET_OAUTH_GRANT_TABLES)).toBeNull();
    const refreshAfter = await db.select().from(cadetSchema.cadetOauthRefreshToken).where(eq(cadetSchema.cadetOauthRefreshToken.userId, userId));
    expect(refreshAfter).toEqual([]);
  });

  it('does not offer the write scope', async () => {
    const response = await cadetAuth.handler(
      new Request(`${CADET_BASE}/.well-known/oauth-authorization-server`),
    );
    const metadata = (await response.json()) as { issuer: string; scopes_supported: string[] };
    expect(metadata.issuer).toBe(cadetOauthIssuer());
    expect(metadata.scopes_supported).toContain('mcp:read');
    expect(metadata.scopes_supported).not.toContain('mcp:write');
  });
});
