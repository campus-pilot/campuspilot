import { env } from '@campuspilot/env/server';
import type { Redis } from 'ioredis';

import { createRedisConnection } from './connect';

let redis: Redis | undefined;

export const getRedisClient = () => {
  redis ??= createRedisConnection(env.REDIS_URL);
  return redis;
};
