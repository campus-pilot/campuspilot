import { env } from '@campuspilot/env/assistant';
import { createRedisConnection, type Redis } from '@campuspilot/redis/connect';

let redis: Redis | undefined;

export function getRedis(): Redis {
  redis ??= createRedisConnection(env.REDIS_URL);
  return redis;
}

/** The shared client, connected. */
export async function connectedRedis(): Promise<Redis> {
  const client = getRedis();
  if (client.status === 'wait') await client.connect();
  return client;
}
