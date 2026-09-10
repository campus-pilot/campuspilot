import { env } from '@campuspilot/env/server';
import { createLogger } from '@campuspilot/logger';
import { Redis } from 'ioredis';

const log = createLogger({ pkg: 'redis' });

let redis: Redis | undefined;

export const getRedisClient = () => {
  if (!redis) {
    redis = new Redis(env.REDIS_URL, { lazyConnect: true });

    redis.on('error', (err) => {
      log.error({ err }, 'redis.client.error');
    });

    redis.on('connect', () => {
      log.info('redis.client.connect');
    });
  }

  return redis;
};
