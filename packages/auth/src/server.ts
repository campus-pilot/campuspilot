import { createDb, type DatabaseExecutor } from '@campuspilot/db';
import * as schema from '@campuspilot/db/schema/auth';
import { env } from '@campuspilot/env/server';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { admin } from 'better-auth/plugins';
import { and, eq, isNull } from 'drizzle-orm';

import { getRedisClient } from '@campuspilot/redis/client';
import { log } from './log';

import { redisStorage } from '@better-auth/redis-storage';
import { apiKey } from '@better-auth/api-key';
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
        rateLimit: {
          enabled: true,
          timeWindow: 1000, // 1 sec
          maxRequests: 100, // 10 requests per day
        },
      }),
    ],
  });
}

export const auth = createAuth();
