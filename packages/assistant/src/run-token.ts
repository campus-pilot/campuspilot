import { connectedRedis } from './redis';

/**
 * A run's delegated MCP token, issued by the API in-process
 * (`issueAssistantRunToken`) whenever the user is present (sending,
 * approving) and kept in Redis until it expires, so the worker's turn acts as
 * that user with a fresh token even after a long wait for approval.
 */
const tokenKey = (runId: string) => `assistant:run:${runId}:token`;

/** Keeps a run's token until its expiry; an already expired token is not stored. */
export async function storeRunToken(runId: string, token: string, expiresAt: Date): Promise<void> {
  const ttlSeconds = Math.floor((expiresAt.getTime() - Date.now()) / 1000);
  if (ttlSeconds <= 0) return;
  const redis = await connectedRedis();
  await redis.set(tokenKey(runId), token, 'EX', ttlSeconds);
}

/** The run's current delegated token, or null once it has expired. */
export async function getRunToken(runId: string): Promise<string | null> {
  const redis = await connectedRedis();
  return redis.get(tokenKey(runId));
}
