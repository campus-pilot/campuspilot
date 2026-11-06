import { resolveClientIp } from '@campuspilot/logger/hono';
import { getRedisClient } from '@campuspilot/redis/client';
import { RedisStore, rateLimiter, type RedisClient } from 'hono-rate-limiter';
import type { Redis } from 'ioredis';

/**
 * Label for requests without proxy IP headers, matching the rate-limit
 * convention documented on `resolveClientIpFromHeaders`.
 */
const UNKNOWN_CLIENT_IP = '127.0.0.1';

/**
 * Adapts ioredis to the client shape `hono-rate-limiter`'s `RedisStore`
 * expects (modelled on `@upstash/redis`): ioredis spells script loading as
 * `SCRIPT LOAD` and takes `EVALSHA` keys and arguments positionally.
 */
function rateLimitRedisClient(redis: Redis): RedisClient {
  return {
    scriptLoad: (script) => redis.script('LOAD', script) as Promise<string>,
    evalsha: (sha1, keys, args) =>
      redis.evalsha(sha1, keys.length, ...keys, ...(args as string[])) as never,
    decr: (key) => redis.decr(key),
    del: (key) => redis.del(key),
  };
}

/**
 * Builds a per-client-IP rate limiter for a group of routes. Use one per
 * route group, each with its own `id`. Counters live in Redis, so the limit
 * holds across every API replica.
 *
 * The window is fixed: it starts with a client's first request and lasts
 * `windowMs`. Rejected requests get `429` with draft-7 `RateLimit` and
 * `Retry-After` headers. A Redis failure fails the request instead of
 * silently dropping the limit.
 *
 * The key is the ingress-reported client IP, which is only trustworthy
 * behind the proxy that overwrites `x-real-ip` (see
 * `resolveClientIpFromHeaders`).
 */
export function createRateLimit(options: {
  /** Names the limited route group; also namespaces its Redis keys. */
  id: string;
  /** Requests one client IP may make per window. */
  limit: number;
  windowMs: number;
  redis?: Redis;
}) {
  return rateLimiter({
    windowMs: options.windowMs,
    limit: options.limit,
    standardHeaders: 'draft-7',
    keyGenerator: (context) => resolveClientIp(context) ?? UNKNOWN_CLIENT_IP,
    message: { code: 'TOO_MANY_REQUESTS', message: 'Too many requests.' },
    store: new RedisStore({
      client: rateLimitRedisClient(options.redis ?? getRedisClient()),
      prefix: `server:rate-limit:${options.id}:`,
    }),
  });
}
