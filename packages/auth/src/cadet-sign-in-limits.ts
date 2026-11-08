import type { getRedisClient } from '@campuspilot/redis/client';

type Redis = ReturnType<typeof getRedisClient>;

/**
 * Failed-sign-in counter with lockout, kept in Redis. A key counts failures
 * within `windowSeconds` (the window starts at the first failure); reaching
 * `maxFailures` locks the key for `lockSeconds` and resets the count. Success
 * clears the count. Keys name the resolved admission id or the client IP,
 * never what the user typed (the admission number is never stored at the
 * auth level).
 */
export type FailureLimit = {
  maxFailures: number;
  windowSeconds: number;
  lockSeconds: number;
};

export type SignInLimiter = {
  /** Seconds until the key unlocks; 0 when it is not locked. */
  lockedFor: (key: string) => Promise<number>;
  /** Records one failure; returns true when this failure locked the key. */
  recordFailure: (key: string, limit: FailureLimit) => Promise<boolean>;
  clearFailures: (key: string) => Promise<void>;
};

export function createRedisSignInLimiter(
  redis: Redis,
  keyPrefix: string,
): SignInLimiter {
  const failures = (key: string) => `${keyPrefix}${key}:failures`;
  const lock = (key: string) => `${keyPrefix}${key}:lock`;

  return {
    async lockedFor(key) {
      const ttl = await redis.pttl(lock(key));
      return ttl > 0 ? Math.ceil(ttl / 1000) : 0;
    },
    async recordFailure(key, limit) {
      const results = await redis
        .multi()
        .incr(failures(key))
        // NX: only the first failure starts the window.
        .expire(failures(key), limit.windowSeconds, 'NX')
        .exec();
      const count = Number(results?.[0]?.[1] ?? 0);
      if (count < limit.maxFailures) return false;
      await redis
        .multi()
        .set(lock(key), '1', 'EX', limit.lockSeconds)
        .del(failures(key))
        .exec();
      return true;
    },
    async clearFailures(key) {
      await redis.del(failures(key));
    },
  };
}
