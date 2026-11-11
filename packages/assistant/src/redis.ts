import { env } from '@campuspilot/env/server';
import { createRedisConnection, type Redis } from '@campuspilot/redis/connect';

let redis: Redis | undefined;

/**
 * The assistant's Redis client, in the API server and in the worker alike
 * (live events, stop signals, streaming text, delegated run tokens).
 */
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
