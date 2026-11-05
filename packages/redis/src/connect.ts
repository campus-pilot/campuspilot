import { createLogger } from '@campuspilot/logger';
import { Redis } from 'ioredis';

const log = createLogger({ pkg: 'redis' });

/**
 * Creates a lazily connecting Redis client for a URL. Free of any app's env
 * module, so every service (the API, the assistant) can use it with its own
 * configuration.
 */
export function createRedisConnection(url: string): Redis {
  const redis = new Redis(url, { lazyConnect: true });
  redis.on('error', (err) => {
    log.error({ err }, 'redis.client.error');
  });
  redis.on('connect', () => {
    log.info('redis.client.connect');
  });
  return redis;
}

export type { Redis };
