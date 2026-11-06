import { createDb } from '@campuspilot/db';
import { env } from '@campuspilot/env/server';
import { getRedisClient } from '@campuspilot/redis/client';
import { redisStorage } from '@better-auth/redis-storage';
import type { BetterAuthOptions } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';

import { log } from './log';

/**
 * Configuration shared by every CampusPilot Better Auth instance (staff and
 * Cadet Portal). Each instance spreads these pieces and declares only what
 * differs: base path, cookie prefix, tables, Redis key prefix, trusted
 * origins, sign-in methods and plugins. Keeping the shared parts here means a
 * change to cookies, sessions or logging applies to both instances at once.
 */

/** Routes Better Auth's logger into the CampusPilot logger. */
const authLogger: NonNullable<BetterAuthOptions['logger']> = {
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
};

export type AuthFoundationOptions<TSchema extends Record<string, unknown>> = {
  db: Parameters<typeof drizzleAdapter>[0];
  /**
   * Drizzle adapter schema map. Keys are Better Auth model names, values the
   * tables those models are stored in, so one instance can map the same
   * models onto its own tables.
   */
  schema: TSchema;
  /** Path the instance is mounted at; the OAuth issuer is BETTER_AUTH_URL + this. */
  basePath: string;
  /** Redis key prefix of the instance's secondary storage (sessions, rate limits). */
  redisKeyPrefix: string;
  trustedOrigins: string[];
};

/** Top-level options shared by every instance. */
export function authFoundation<TSchema extends Record<string, unknown>>(
  options: AuthFoundationOptions<TSchema>,
) {
  return {
    logger: authLogger,
    database: drizzleAdapter(options.db, {
      provider: 'pg',
      schema: options.schema,
    }),
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    basePath: options.basePath,
    trustedOrigins: options.trustedOrigins,
    secondaryStorage: redisStorage({
      client: getRedisClient(),
      keyPrefix: options.redisKeyPrefix,
    }),
  } satisfies Partial<BetterAuthOptions>;
}

/**
 * Cookie attributes shared by every instance. The prefix is the instance's
 * own, so a person can be signed in to management and the Cadet Portal at
 * the same time without either app seeing the other's session cookie.
 */
export function sharedCookieOptions(cookiePrefix: string) {
  return {
    cookiePrefix,
    defaultCookieAttributes: {
      sameSite: env.SAME_SITE_COOKIE,
      secure: env.SECURE_COOKIES,
      httpOnly: true,
      domain: env.COOKIE_DOMAIN,
    },
  } satisfies NonNullable<BetterAuthOptions['advanced']>;
}

/**
 * Session settings shared by every instance. Sessions are also stored in the
 * database (not only Redis) because some flows query them there, and the
 * OAuth provider plugin requires it whenever secondary storage is used.
 */
export const SHARED_SESSION_OPTIONS = {
  storeSessionInDatabase: true,
} as const satisfies NonNullable<BetterAuthOptions['session']>;

/**
 * The auth instances' own connection pool, separate from `@campuspilot/db`'s
 * shared `db`. Both instances use it; test setups end it after each file
 * instead of leaking idle connections per file.
 */
export const authDb = createDb();
