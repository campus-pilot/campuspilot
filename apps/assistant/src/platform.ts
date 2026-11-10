import { createHash } from 'node:crypto';

import type { AppRouterClient } from '@campuspilot/api/routers/index';
import { ASSISTANT_SERVICE_SECRET_HEADER } from '@campuspilot/assistant-contract/protocol';
import { env } from '@campuspilot/env/assistant';
import { createORPCClient, ORPCError } from '@orpc/client';
import { RPCLink } from '@orpc/client/fetch';
import { z } from 'zod';

import { connectedRedis } from './redis';

/**
 * Everything the assistant needs from CampusPilot, through the API's public
 * interfaces only: the user's session, one permission check and delegated
 * run tokens. Business data and actions go through MCP (runtime/tools.ts).
 * The type import of the API router is compile-time only; no API code runs
 * in this service.
 */

function apiClient(cookie: string): AppRouterClient {
  return createORPCClient(
    new RPCLink({
      url: new URL('/rpc', env.CAMPUSPILOT_API_URL).toString(),
      headers: {
        cookie,
        [ASSISTANT_SERVICE_SECRET_HEADER]: env.ASSISTANT_SERVICE_SECRET,
      },
    }),
  );
}

export type SessionUser = { id: string; name: string; email: string };

const sessionResponseSchema = z
  .object({ user: z.object({ id: z.string(), name: z.string(), email: z.string() }) })
  .nullable();

/** Short-lived memo so a burst of requests does not re-check one session. */
const SESSION_CACHE_MS = 15_000;
const sessionCache = new Map<string, { user: SessionUser | null; until: number }>();

const cacheKey = (...parts: string[]) =>
  createHash('sha256').update(parts.join('\u0000')).digest('hex');

/**
 * Resolves the signed-in user from the browser's CampusPilot session cookie
 * by asking the API, which owns authentication. Only the API's own answer
 * (a 200, with a session or with null) says whether someone is signed in;
 * any other response is an outage and throws, uncached, so it reaches the
 * browser as a server error that it retries instead of as "signed out",
 * which it would treat as final.
 */
export async function getSessionUser(cookie: string | undefined): Promise<SessionUser | null> {
  if (!cookie) return null;
  const key = cacheKey(cookie);
  const cached = sessionCache.get(key);
  if (cached && cached.until > Date.now()) return cached.user;

  const response = await fetch(new URL('/api/auth/get-session', env.CAMPUSPILOT_API_URL), {
    headers: { cookie },
  });
  if (!response.ok) throw new Error(`The CampusPilot session check failed (${response.status}).`);
  const user = sessionResponseSchema.parse(await response.json())?.user ?? null;
  sessionCache.set(key, { user, until: Date.now() + SESSION_CACHE_MS });
  if (sessionCache.size > 10_000) sessionCache.clear();
  return user;
}

const PERMISSION_CACHE_MS = 30_000;
const permissionCache = new Map<string, number>();

/** Whether the user holds `school.assistant.use` in the school (OPA, via the API). */
export async function canUseAssistant(cookie: string, userId: string, schoolId: string) {
  const key = cacheKey(userId, schoolId);
  const until = permissionCache.get(key);
  if (until && until > Date.now()) return true;
  const { results } = await apiClient(cookie).authorization.checkPermissions({
    permissions: [{ action: 'school.assistant.use', resource: { kind: 'school', schoolId } }],
  });
  const allowed = results[0] === true;
  if (allowed) permissionCache.set(key, Date.now() + PERMISSION_CACHE_MS);
  return allowed;
}

export type RunScope = { schoolId: string; conversationId: string; runId: string };

const tokenKey = (runId: string) => `assistant:run:${runId}:token`;

/**
 * Asks the API for a delegated token for one run and keeps it in Redis for
 * the run's steps. Called whenever the user is present (sending, approving),
 * so a run that waited a long time for approval resumes with a fresh token.
 * Throws the API's error (for example FORBIDDEN) when it refuses.
 */
export async function refreshRunToken(cookie: string, scope: RunScope): Promise<void> {
  const { token, expiresAt } = await apiClient(cookie).auth.issueAssistantToken(scope);
  const ttlSeconds = Math.floor((expiresAt.getTime() - Date.now()) / 1000);
  if (ttlSeconds <= 0) return;
  const redis = await connectedRedis();
  await redis.set(tokenKey(scope.runId), token, 'EX', ttlSeconds);
}

/** The run's current delegated token, or null once it has expired. */
export async function getRunToken(runId: string): Promise<string | null> {
  const redis = await connectedRedis();
  return redis.get(tokenKey(runId));
}

export { ORPCError };
