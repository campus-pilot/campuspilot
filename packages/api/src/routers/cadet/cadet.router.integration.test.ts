import { cadetAuth } from '@campuspilot/auth/cadet';
import { registerDynamicClient, type TestAuth } from '@campuspilot/auth/__tests__/oauth-test-utils';
import { auth as staffAuth } from '@campuspilot/auth/server';
import { db } from '@campuspilot/db';
import { admissionTable } from '@campuspilot/db/schema/admission';
import { createRouterClient } from '@orpc/server';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  connectCadetMcp,
  cookiesOf,
  createCadetTestClient,
  signInCadet,
} from '../../../test/cadet';
import { expectRpcCode } from '../../../test/finance/assertions';
import { expectFeatureDisabled } from '../../../test/feature-flags';
import {
  createSchoolStaffSession,
  createTestClient,
  createTestSchool,
  setTestSchoolFeature,
} from '../../../test/fixtures';
import { createCadetContextFromHeaders, createCadetOAuthContext } from '../../cadet/context';
import { createContextFromHeaders } from '../../context';
import { appRouter } from '../index';
import { cadetRouter } from './cadet.router';

async function cadetWithLogin() {
  const school = await createTestSchool({ features: ['cadet'] });
  const principal = await createSchoolStaffSession(school.id, [{ role: 'principal', meta: null }]);
  const principalClient = createTestClient(principal.session);
  const created = await principalClient.school.createAdmission({
    schoolId: school.id,
    name: 'Meera Singh',
    admissionNo: `CAD-${randomUUID().slice(0, 6)}`,
    address: 'Test address',
    phoneNo: '9999999999',
    whatsappSameAsPhone: true,
    dob: '2017-02-03',
    fatherName: 'Father',
    motherName: 'Mother',
    generateCadetPassword: true,
  });
  const { cookie, response } = await signInCadet(created.cadetPassword!);
  expect(response.status).toBe(200);
  return { school, principal, principalClient, created, cookie };
}

/** A real staff browser session (cp_ cookie) from the staff auth instance. */
async function staffCookie() {
  const response = await staffAuth.api.signUpEmail({
    body: { email: `staff_${randomUUID()}@example.com`, password: 'Password123!', name: 'Staff' },
    asResponse: true,
  });
  return cookiesOf(response);
}

describe('cadetRouter.getAdmission', () => {
  it("returns the signed-in student's admission exactly as management's getAdmission does", async () => {
    const { school, principalClient, created, cookie } = await cadetWithLogin();
    const mine = await createCadetTestClient(new Headers({ cookie })).getAdmission();
    const staffView = await principalClient.school.getAdmission({ schoolId: school.id, admissionId: created.id });
    expect(JSON.parse(JSON.stringify(mine))).toEqual(staffView);
    expect(mine.name).toBe('Meera Singh');
  });

  it('follows the live admission record, including after unregistering', async () => {
    const { school, principalClient, created, cookie } = await cadetWithLogin();
    await db.update(admissionTable).set({ name: 'Meera S.' }).where(eq(admissionTable.id, created.id));
    await principalClient.school.unregisterAdmission({ schoolId: school.id, admissionId: created.id, confirmationName: 'Meera S.' });
    const mine = await createCadetTestClient(new Headers({ cookie })).getAdmission();
    expect(mine).toMatchObject({ name: 'Meera S.', registered: false });
  });

  it('rejects anonymous callers', async () => {
    await expectRpcCode(createCadetTestClient(new Headers()).getAdmission(), 'UNAUTHORIZED');
  });

  it('accepts a read-only cadet MCP grant', async () => {
    const { created } = await cadetWithLogin();
    const { claims } = await connectCadetMcp(created.cadetPassword!);
    const context = await createCadetOAuthContext({
      headers: new Headers(),
      userId: claims.userId,
      oauthGrant: { clientId: claims.clientId, scopes: claims.scopes, grantId: 'grant' },
    });
    const client = createRouterClient(cadetRouter, { context: context! });
    expect((await client.getAdmission()).id).toBe(created.id);

    const noScope = createRouterClient(cadetRouter, {
      context: { ...context!, principal: { authMethod: 'oauth', oauthGrant: { clientId: claims.clientId, scopes: [], grantId: 'grant' } } },
    });
    await expectRpcCode(noScope.getAdmission(), 'FORBIDDEN');
  });
});

describe('the cadet feature flag', () => {
  it('stops an existing session at once with the portal-unavailable error and resumes when re-enabled', async () => {
    const { school, cookie } = await cadetWithLogin();
    const client = createCadetTestClient(new Headers({ cookie }));
    expect((await client.getAdmission()).name).toBe('Meera Singh');

    await setTestSchoolFeature(school.id, 'cadet', false);
    // FORBIDDEN with the feature data, never UNAUTHORIZED: the login is
    // still valid, the school just has no portal.
    await expectFeatureDisabled(client.getAdmission(), 'cadet');
    await expectFeatureDisabled(client.getProfile(), 'cadet');
    await expectFeatureDisabled(client.getUnreadNotificationCount(), 'cadet');
    // Anonymous callers still get UNAUTHORIZED, not a feature answer.
    await expectRpcCode(createCadetTestClient(new Headers()).getAdmission(), 'UNAUTHORIZED');

    await setTestSchoolFeature(school.id, 'cadet', true);
    expect((await client.getAdmission()).name).toBe('Meera Singh');
  });

  it('refuses sign-in like wrong credentials while the feature is off', async () => {
    const { school, created } = await cadetWithLogin();
    await setTestSchoolFeature(school.id, 'cadet', false);
    const refused = await signInCadet(created.cadetPassword!);
    expect(refused.response.status).toBe(401);
    expect(((await refused.response.json()) as { code: string }).code).toBe('INVALID_CADET_CREDENTIALS');
    expect(refused.cookie).toBe('');

    await setTestSchoolFeature(school.id, 'cadet', true);
    expect((await signInCadet(created.cadetPassword!)).response.status).toBe(200);
  });

  it('closes the Cadet MCP for a connected app while the feature is off, keeping the grant', async () => {
    const { school, created } = await cadetWithLogin();
    const { claims } = await connectCadetMcp(created.cadetPassword!);
    const oauthInput = {
      headers: new Headers(),
      userId: claims.userId,
      oauthGrant: { clientId: claims.clientId, scopes: claims.scopes, grantId: 'grant' },
    };
    const context = await createCadetOAuthContext(oauthInput);
    expect(context).not.toBeNull();

    await setTestSchoolFeature(school.id, 'cadet', false);
    // The gate gets no context (it answers as for a revoked connection)...
    expect(await createCadetOAuthContext(oauthInput)).toBeNull();
    // ...and a context resolved just before the switch is refused per call.
    await expectFeatureDisabled(createRouterClient(cadetRouter, { context: context! }).getAdmission(), 'cadet');

    await setTestSchoolFeature(school.id, 'cadet', true);
    const again = await createCadetOAuthContext(oauthInput);
    expect((await createRouterClient(cadetRouter, { context: again! }).getAdmission()).id).toBe(created.id);
  });
});

describe('cadetRouter.getOAuthConsentClient', () => {
  it('returns a cadet client for a signed-in student and never a staff client', async () => {
    const { created, cookie } = await cadetWithLogin();
    const { claims } = await connectCadetMcp(created.cadetPassword!);
    const client = createCadetTestClient(new Headers({ cookie }));
    expect(await client.getOAuthConsentClient({ clientId: claims.clientId })).toMatchObject({
      clientId: claims.clientId,
      name: 'Cadet test app',
      registrationMethod: 'dynamic',
      verifiedHost: null,
    });

    const staffClient = await registerDynamicClient(staffAuth as unknown as TestAuth);
    await expectRpcCode(client.getOAuthConsentClient({ clientId: staffClient.clientId }), 'NOT_FOUND');
    await expectRpcCode(client.getOAuthConsentClient({ clientId: 'unknown-client' }), 'NOT_FOUND');
    await expectRpcCode(createCadetTestClient(new Headers()).getOAuthConsentClient({ clientId: claims.clientId }), 'UNAUTHORIZED');
    await expectRpcCode(client.getOAuthConsentClient({ clientId: '' }), 'BAD_REQUEST');
  });
});

describe('cadet and staff sessions are isolated', () => {
  it('staff procedures reject a cadet session', async () => {
    const { school, created, cookie } = await cadetWithLogin();
    const staffContext = await createContextFromHeaders(new Headers({ cookie }));
    expect(staffContext.session).toBeNull();
    expect(staffContext.principal.authMethod).toBe('anonymous');
    const client = createRouterClient(appRouter, { context: staffContext });
    await expectRpcCode(client.school.getAdmission({ schoolId: school.id, admissionId: created.id }), 'UNAUTHORIZED');
    await expectRpcCode(client.school.listAdmissions({ schoolId: school.id }), 'UNAUTHORIZED');
  });

  it('cadet procedures reject a staff session and a staff session token in a cadet cookie', async () => {
    const cookie = await staffCookie();
    expect(await staffAuth.api.getSession({ headers: new Headers({ cookie }) })).not.toBeNull();
    const context = await createCadetContextFromHeaders(new Headers({ cookie }));
    expect(context.login).toBeNull();
    await expectRpcCode(createCadetTestClient(new Headers({ cookie })).getAdmission(), 'UNAUTHORIZED');

    // The same signed staff token under the cadet cookie name is not a cadet session.
    const forged = cookie.replace(/^cp_\./, 'cpc_.');
    expect(await cadetAuth.api.getSession({ headers: new Headers({ cookie: forged }) })).toBeNull();
    await expectRpcCode(createCadetTestClient(new Headers({ cookie: forged })).getAdmission(), 'UNAUTHORIZED');
  });

  it('keeps both sessions valid side by side for the same browser', async () => {
    const { cookie: cadetCookie } = await cadetWithLogin();
    const both = `${await staffCookie()}; ${cadetCookie}`;
    expect(await staffAuth.api.getSession({ headers: new Headers({ cookie: both }) })).not.toBeNull();
    expect((await createCadetTestClient(new Headers({ cookie: both })).getAdmission()).name).toBe('Meera Singh');
  });

  it('keeps cadet procedures out of the staff router and staff procedures out of the cadet router', () => {
    expect(Object.keys(cadetRouter).sort()).toEqual([
      'dismissNotifications',
      'getAdmission',
      'getBill',
      'getExam',
      'getExamResult',
      'getFeeSummary',
      'getGrowth',
      'getOAuthConsentClient',
      'getProfile',
      'getPushSubscription',
      'getSchool',
      'getUnreadNotificationCount',
      'listExams',
      'listFeeLedger',
      'listNotifications',
      'listRemarks',
      'markAllNotificationsRead',
      'markNotificationsRead',
      'subscribePush',
      'unsubscribePush',
    ]);
    // Same-named staff inbox procedures live under `school`, scoped by membership.
    expect(appRouter).not.toHaveProperty('listNotifications');
    expect(appRouter).not.toHaveProperty('getAdmission');
    expect(appRouter).not.toHaveProperty('getOAuthConsentClient');
    expect(Object.values(appRouter)).not.toContain(cadetRouter);
  });
});
