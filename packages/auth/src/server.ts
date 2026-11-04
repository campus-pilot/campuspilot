import { createDb, type DatabaseExecutor } from '@campuspilot/db';
import * as schema from '@campuspilot/db/schema/auth';
import { env } from '@campuspilot/env/server';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import {
  APIError,
  createAuthMiddleware,
  getSessionFromCtx,
} from 'better-auth/api';
import { admin } from 'better-auth/plugins';
import { and, count, eq, gt, isNull, ne, or } from 'drizzle-orm';

import { getRedisClient } from '@campuspilot/redis/client';
import { log } from './log';

import { redisStorage } from '@better-auth/redis-storage';
import { apiKey } from '@better-auth/api-key';
import {
  API_KEY_DEFAULT_EXPIRES_IN_SECONDS,
  API_KEY_MAX_ACTIVE_PER_USER,
  API_KEY_MAX_EXPIRY_DAYS,
  API_KEY_MIN_EXPIRY_DAYS,
  API_KEY_NAME_MAX_LENGTH,
} from './api-key-policy';
import {
  googlePictureFromIdToken,
  importGoogleProfileImage,
} from './profile-image';

const redis = getRedisClient();

export function createAuth(db: DatabaseExecutor = createDb()) {
  const roleForEmail = (email: string) =>
    email.toLowerCase() === env.SYSTEM_ADMIN_EMAIL ? 'admin' : 'user';

  /**
   * Provider images seed an account only while it has no CampusPilot image.
   * A later user upload therefore always takes precedence over Google.
   */
  const persistGoogleProfileImageIfMissing = async (
    userId: string,
    sourceUrl: string | null | undefined,
  ) => {
    if (!sourceUrl) return;

    const [currentUser] = await db
      .select({ profileImageS3Key: schema.user.profileImageS3Key })
      .from(schema.user)
      .where(eq(schema.user.id, userId))
      .limit(1);
    if (!currentUser || currentUser.profileImageS3Key) return;

    try {
      const profileImageS3Key = await importGoogleProfileImage(
        userId,
        sourceUrl,
      );
      await db
        .update(schema.user)
        .set({ profileImageS3Key, updatedAt: new Date() })
        .where(
          and(
            eq(schema.user.id, userId),
            isNull(schema.user.profileImageS3Key),
          ),
        );
    } catch (error) {
      // Profile-image import is enrichment; it must never prevent authentication.
      log.warn({ err: error, userId }, 'auth.google.profile-image.import-failed');
    }
  };

  /** Counts a user's keys that can still authenticate (enabled, unexpired). */
  const countActiveApiKeys = async (userId: string) => {
    const [result] = await db
      .select({ value: count() })
      .from(schema.apikey)
      .where(
        and(
          eq(schema.apikey.referenceId, userId),
          or(isNull(schema.apikey.enabled), ne(schema.apikey.enabled, false)),
          or(
            isNull(schema.apikey.expiresAt),
            gt(schema.apikey.expiresAt, new Date()),
          ),
        ),
      );
    return result?.value ?? 0;
  };

  /**
   * Enforces the API-key policy the plugin has no option for. Creating a key
   * is refused once the owner holds API_KEY_MAX_ACTIVE_PER_USER active keys;
   * this check-then-insert is a per-user cap, not a lock, so simultaneous
   * creates can briefly exceed it by the number of racing requests. Updating
   * a key to `expiresIn: null` is refused because it would make the key
   * permanent, which the plugin's update endpoint otherwise allows.
   */
  const apiKeyPolicy = createAuthMiddleware(async (ctx) => {
    if (ctx.path === '/api-key/update' && ctx.body?.expiresIn === null) {
      throw new APIError('BAD_REQUEST', {
        code: 'API_KEY_EXPIRY_REQUIRED',
        message: `API keys must expire within ${API_KEY_MAX_EXPIRY_DAYS} days.`,
      });
    }
    if (ctx.path !== '/api-key/create') return;

    const session = await getSessionFromCtx(ctx);
    // Server-side calls without a request may name the owner explicitly,
    // exactly as the plugin itself accepts.
    const ownerId =
      session?.user.id ??
      (ctx.request || ctx.headers ? undefined : ctx.body?.userId);
    if (typeof ownerId !== 'string') return;

    if ((await countActiveApiKeys(ownerId)) >= API_KEY_MAX_ACTIVE_PER_USER) {
      throw new APIError('BAD_REQUEST', {
        code: 'API_KEY_LIMIT_REACHED',
        message: `You can have at most ${API_KEY_MAX_ACTIVE_PER_USER} active API keys. Delete one you no longer use first.`,
      });
    }
  });

  return betterAuth({
    logger: {
      disabled: false,
      level: 'info',
      log: (level, message, ...args) => {
        const payload = args.length > 0 ? { args } : {};
        switch (level) {
          case 'error':
            log.error(payload, message);
            break;
          case 'warn':
            log.warn(payload, message);
            break;
          case 'info':
            log.info(payload, message);
            break;
          case 'debug':
            log.debug(payload, message);
            break;
          default:
            log.info(payload, message);
        }
      },
    },

    database: drizzleAdapter(db, {
      provider: 'pg',
      schema: schema,
    }),

    trustedOrigins: env.CORS_ORIGIN.split(','),

    // System roles are derived exclusively from SYSTEM_ADMIN_EMAIL, while
    // provisioning is exposed through the school-scoped oRPC mutation. Keep
    // the underlying admin endpoints unreachable from public HTTP clients.
    disabledPaths: ['/admin/create-user', '/admin/set-role'],

    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
    },
    socialProviders: {
      google: {
        clientId: env.GOOGLE_CLIENT_ID as string,
        clientSecret: env.GOOGLE_CLIENT_SECRET as string,
      },
    },
    account: {
      accountLinking: {
        enabled: true,
        trustedProviders: ['google'],
      },
    },

    ...(env.PUBLIC_APP_URL && {
      onAPIError: {
        errorURL: new URL('/auth/error', env.PUBLIC_APP_URL).toString(),
      },
    }),

    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    hooks: { before: apiKeyPolicy },
    advanced: {
      cookiePrefix: 'cp_',
      defaultCookieAttributes: {
        sameSite: env.SAME_SITE_COOKIE,
        secure: env.SECURE_COOKIES,
        httpOnly: true,
        domain: env.COOKIE_DOMAIN,
      },
      cookies: {
        // The OAuth state cookie must survive the full IdP round-trip: the
        // redirect back is a cross-site navigation after an interactive login,
        // so anything stricter than lax strands every first SSO sign-in in a
        // state_mismatch, and the default 5-minute lifetime is shorter than
        // the 10-minute server-side state TTL (slow MFA logins hit it).
        state: { attributes: { sameSite: 'lax', maxAge: 600 } },
      },
    },

    user: {
      additionalFields: {
        setupStatus: { type: 'json', required: false, input: false },
        profileImageS3Key: { type: 'string', required: false, input: false },
      },
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user) => ({
            data: { ...user, role: roleForEmail(user.email) },
          }),
          after: async (user) => {
            await persistGoogleProfileImageIfMissing(user.id, user.image);
          },
        },
      },
      account: {
        create: {
          after: async (account) => {
            if (account.providerId !== 'google') return;
            await persistGoogleProfileImageIfMissing(
              account.userId,
              googlePictureFromIdToken(account.idToken),
            );
          },
        },
      },
      session: {
        create: {
          before: async (session) => {
            const signedInUser = await db.query.user.findFirst({
              columns: { email: true, profileImageS3Key: true, role: true },
              where: eq(schema.user.id, session.userId),
            });

            if (signedInUser) {
              const role = roleForEmail(signedInUser.email);
              if (signedInUser.role !== role) {
                await db
                  .update(schema.user)
                  .set({ role })
                  .where(eq(schema.user.id, session.userId));
              }

              if (!signedInUser.profileImageS3Key) {
                const googleAccount = await db.query.account.findFirst({
                  columns: { idToken: true },
                  where: and(
                    eq(schema.account.userId, session.userId),
                    eq(schema.account.providerId, 'google'),
                  ),
                });
                await persistGoogleProfileImageIfMissing(
                  session.userId,
                  googlePictureFromIdToken(googleAccount?.idToken),
                );
              }
            }

            return { data: session };
          },
        },
      },
    },
    session: {
      // For some use cases we query db for retrieving session data,
      // ref: revokeOrganizationScopedSessions @gos1/auth/src/revoke-sessions.ts
      storeSessionInDatabase: true,

      additionalFields: {
        authMethod: { type: 'string', required: false, input: false },
        // Reserved for persisted sessions that explicitly record their
        // authentication source. Better Auth's API-key plugin creates a
        // request-scoped mock session and does not populate this field.
        apiKeyId: { type: 'string', required: false, input: false },
      },
    },

    secondaryStorage: redisStorage({
      client: redis,
      keyPrefix: 'server:auth:',
    }),

    plugins: [
      admin({ defaultRole: 'user', adminRoles: ['admin'] }),
      apiKey({
        references: 'user',
        defaultPrefix: 'cp_',
        enableSessionForAPIKeys: true,
        maximumNameLength: API_KEY_NAME_MAX_LENGTH,
        /**
         * Every key expires. `defaultExpiresIn` is in seconds (the plugin's
         * doc comment says milliseconds, but it is applied as seconds) and
         * applies when a client sends no expiry; min/max are in days.
         */
        keyExpiration: {
          defaultExpiresIn: API_KEY_DEFAULT_EXPIRES_IN_SECONDS,
          minExpiresIn: API_KEY_MIN_EXPIRY_DAYS,
          maxExpiresIn: API_KEY_MAX_EXPIRY_DAYS,
        },
        /**
         * No per-key rate limiting. This global switch is checked before each
         * key's own flag, so it also covers keys created while limiting was
         * on. Request limits, if ever needed, belong at the API or gateway
         * level rather than in a per-request key counter.
         */
        rateLimit: { enabled: false },
      }),
    ],
  });
}

export const auth = createAuth();
