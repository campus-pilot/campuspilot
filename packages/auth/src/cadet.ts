import type { DatabaseExecutor } from '@campuspilot/db';
import {
  cadetAccount,
  cadetJwks,
  cadetOauthAccessToken,
  cadetOauthClient,
  cadetOauthClientAssertion,
  cadetOauthClientResource,
  cadetOauthConsent,
  cadetOauthRefreshToken,
  cadetOauthResource,
  cadetSession,
  cadetUser,
  cadetVerification,
} from '@campuspilot/db/schema/cadet';
import { env } from '@campuspilot/env/server';
import { getRedisClient } from '@campuspilot/redis/client';
import { betterAuth } from 'better-auth';
import { cadetPushSubscriptionTable } from '@campuspilot/db/schema/notification';
import { and, inArray, isNull } from 'drizzle-orm';

import {
  authDb,
  authFoundation,
  SHARED_SESSION_OPTIONS,
  sharedCookieOptions,
} from './auth-foundation';
import {
  CADET_AUTH_BASE_PATH,
  CADET_COOKIE_PREFIX,
  CADET_MCP_DEFAULT_SCOPES,
  CADET_OAUTH_CONSENT_PATH,
  CADET_OAUTH_LOGIN_PATH,
  CADET_OAUTH_SUPPORTED_SCOPES,
} from './cadet-policy';
import { cadetAdmissionSignIn } from './cadet-sign-in';
import {
  createRedisSignInLimiter,
  type SignInLimiter,
} from './cadet-sign-in-limits';
import {
  CADET_OAUTH_SERVER_TABLES,
  issuerFor,
  mcpOAuthPlugins,
  recordDynamicClientRegistration,
  type McpOAuthOptions,
  type McpOAuthServerConfig,
} from './mcp-oauth';

/** Redis key prefix of the cadet instance; never shared with staff auth. */
export const CADET_REDIS_KEY_PREFIX = 'server:cadet-auth:';

/**
 * The cadet instance's Drizzle adapter schema map: Better Auth's default
 * model names as keys, `cadet_*` tables as values. Every plugin keeps its
 * default model names while every read and write lands in a cadet table, so
 * no cadet row can ever be stored in, or read from, a staff auth table. It
 * must cover every model the cadet instance's plugins declare; the adapter
 * fails loudly on a missing one.
 */
export const cadetAuthSchema = {
  user: cadetUser,
  session: cadetSession,
  account: cadetAccount,
  verification: cadetVerification,
  jwks: cadetJwks,
  oauthClient: cadetOauthClient,
  oauthResource: cadetOauthResource,
  oauthClientResource: cadetOauthClientResource,
  oauthRefreshToken: cadetOauthRefreshToken,
  oauthAccessToken: cadetOauthAccessToken,
  oauthConsent: cadetOauthConsent,
  oauthClientAssertion: cadetOauthClientAssertion,
};

/** OAuth issuer of the cadet MCP (`${BETTER_AUTH_URL}/api/cadet/auth`). */
export function cadetOauthIssuer(): string {
  return issuerFor(CADET_AUTH_BASE_PATH);
}

/**
 * The cadet MCP authorization server: resource `CADET_MCP_RESOURCE_URL`,
 * login and consent pages on the Cadet Portal, read-only scopes. Nobody may
 * manage clients through the OAuth CRUD endpoints; cadet connectors arrive
 * through CIMD or DCR only.
 */
export function cadetMcpOAuthConfig(): McpOAuthServerConfig {
  return {
    resource: env.CADET_MCP_RESOURCE_URL,
    loginPage: new URL(CADET_OAUTH_LOGIN_PATH, env.CADET_APP_URL).toString(),
    consentPage: new URL(CADET_OAUTH_CONSENT_PATH, env.CADET_APP_URL).toString(),
    scopes: CADET_OAUTH_SUPPORTED_SCOPES,
    defaultScopes: CADET_MCP_DEFAULT_SCOPES,
    clientPrivileges: () => false,
    clientReference: () => undefined,
  };
}

export type CadetAuthOptions = McpOAuthOptions & {
  /** Failed-sign-in store; defaults to Redis under the cadet key prefix. */
  limiter?: SignInLimiter;
};

/**
 * Builds the Cadet Portal's Better Auth instance. It shares the staff
 * instance's foundation (secret, cookie attributes, logging, session
 * storage) and differs only where decided: its own base path, `cpc_` cookie
 * prefix, `cadet_*` tables, Redis prefix and trusted origin (the cadet app
 * only), and the admission sign-in as its only sign-in method.
 */
export function createCadetAuth(
  db: DatabaseExecutor = authDb,
  options: CadetAuthOptions = {},
) {
  const limiter =
    options.limiter ??
    createRedisSignInLimiter(getRedisClient(), CADET_REDIS_KEY_PREFIX);

  return betterAuth({
    ...authFoundation({
      db,
      schema: cadetAuthSchema,
      basePath: CADET_AUTH_BASE_PATH,
      redisKeyPrefix: CADET_REDIS_KEY_PREFIX,
      trustedOrigins: [new URL(env.CADET_APP_URL).origin],
    }),

    // The admission sign-in plugin is the only sign-in. Email/password stays
    // disabled so the placeholder email can never sign in or sign up, and
    // the account endpoints that would change the login outside the
    // decided issue/reset flow are unreachable (a student changing their own
    // password comes in a later change, which must also record
    // `passwordSource: 'student_set'`).
    emailAndPassword: { enabled: false },
    disabledPaths: [
      '/sign-in/email',
      '/sign-up/email',
      '/update-user',
      '/delete-user',
      '/change-email',
      '/change-password',
      '/set-password',
      '/request-password-reset',
      '/reset-password',
    ],

    advanced: sharedCookieOptions(CADET_COOKIE_PREFIX),
    session: SHARED_SESSION_OPTIONS,
    // Ending a session stops its device's notifications, but not here: the
    // `cadet_session` delete trigger (migration 0052) revokes the session's
    // push subscriptions for `/sign-out`, `/revoke-session(s)`,
    // `/revoke-other-sessions`, expired-session cleanup and every other
    // path, so no endpoint or hook has to remember it.
    hooks: {
      after: recordDynamicClientRegistration(db, CADET_OAUTH_SERVER_TABLES),
    },

    /**
     * CampusPilot columns of `cadet_user`. Declared so Better Auth reads them
     * into the session user (the cadet API binds the admission from
     * `admissionId`); `input: false` keeps them out of every client-writable
     * body. Logins are only ever created by `issueCadetLogin`, never by
     * Better Auth, because sign-up is disabled.
     */
    user: {
      additionalFields: {
        admissionId: { type: 'string', required: true, input: false },
        passwordSource: { type: 'string', required: true, input: false },
        issuedAt: { type: 'date', required: true, input: false },
        issuedBy: { type: 'string', required: false, input: false },
      },
    },

    plugins: [
      cadetAdmissionSignIn({ db, limiter }),
      ...mcpOAuthPlugins(cadetMcpOAuthConfig(), options),
    ],
  });
}

export type CadetAuth = ReturnType<typeof createCadetAuth>;

export const cadetAuth = createCadetAuth(authDb);

/**
 * Signs a cadet login out everywhere and disconnects its AI apps: every
 * session is deleted through the cadet instance (so the Redis copies go too,
 * not only the database rows), and every OAuth consent and refresh/access
 * token is deleted. The cadet MCP gate checks the consent on every request,
 * so an access token that is still unexpired stops working immediately.
 * Every active web push subscription of the login is revoked too (kept as a
 * row with `revoked_at`, like "turn off" on the device), so a device that is
 * no longer signed in stops receiving notifications.
 * Idempotent.
 */
export async function revokeCadetLoginAccess(
  userIds: readonly string[],
  instance: CadetAuth = cadetAuth,
  db: DatabaseExecutor = authDb,
): Promise<void> {
  if (userIds.length === 0) return;
  const context = await instance.$context;
  for (const userId of userIds) {
    await context.internalAdapter.deleteUserSessions(userId);
  }
  const ids = [...userIds];
  await db.transaction(async (transaction) => {
    await transaction
      .delete(cadetOauthAccessToken)
      .where(inArray(cadetOauthAccessToken.userId, ids));
    await transaction
      .delete(cadetOauthRefreshToken)
      .where(inArray(cadetOauthRefreshToken.userId, ids));
    await transaction
      .delete(cadetOauthConsent)
      .where(inArray(cadetOauthConsent.userId, ids));
    const now = new Date();
    await transaction
      .update(cadetPushSubscriptionTable)
      .set({ revokedAt: now, updatedAt: now })
      .where(and(inArray(cadetPushSubscriptionTable.cadetUserId, ids), isNull(cadetPushSubscriptionTable.revokedAt)));
  });
}
