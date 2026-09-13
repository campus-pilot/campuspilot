import { createDb, type DatabaseExecutor } from '@campuspilot/db';
import * as schema from '@campuspilot/db/schema/auth';
import { env } from '@campuspilot/env/server';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { admin } from 'better-auth/plugins';
import { eq } from 'drizzle-orm';

import { getRedisClient } from '@campuspilot/redis/client';
import { log } from './log';

import { redisStorage } from '@better-auth/redis-storage';
import { apiKey } from '@better-auth/api-key';

const redis = getRedisClient();

export function createAuth(db: DatabaseExecutor = createDb()) {

  const roleForEmail = (email: string) =>
    email.toLowerCase() === env.SYSTEM_ADMIN_EMAIL ? 'admin' : 'user';

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

    ...(env.PUBLIC_APP_URL && {
      onAPIError: {
        errorURL: new URL('/auth/sign-in/error', env.PUBLIC_APP_URL).toString(),
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
      },
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user) => ({
            data: { ...user, role: roleForEmail(user.email) },
          }),
        },
      },
      session: {
        create: {
          before: async (session) => {
            const signedInUser = await db.query.user.findFirst({
              columns: { email: true, role: true },
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
        // Set on sessions minted by exchanging a personal access key. Lets a
        // key revocation cascade-delete its live sessions and lets the audit
        // trail record which key acted.
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
