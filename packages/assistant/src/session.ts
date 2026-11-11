import type { Context } from '@campuspilot/api/context';
import { normalizeApiKeyHeaders } from '@campuspilot/auth/api-key-headers';
import { auth } from '@campuspilot/auth/server';
import { db } from '@campuspilot/db';

/** The signed-in staff member behind an assistant request. */
export type AssistantSessionUser = {
  id: string;
  name: string;
  email: string;
  /** The administrator impersonating this user, when one is. */
  impersonatedBy: string | null;
};

export type AssistantSession = {
  user: AssistantSessionUser;
  /** The API context of this request, for the API's own checks (permissions, token issue). */
  context: Context;
};

/**
 * Resolves the user of a `/model/*` request from the CampusPilot session
 * cookie, in-process through the API's own Better Auth instance.
 *
 * Only a browser session counts: a request carrying an API key (in
 * `x-api-key` or as a Bearer value) is not the user at the app, so it gets
 * no assistant. An outage of the session store throws instead of answering
 * "signed out": the browser treats signed out as final, but retries a server
 * error.
 */
export async function resolveAssistantSession(headers: Headers): Promise<AssistantSession | null> {
  const normalized = normalizeApiKeyHeaders(headers);
  if (normalized.has('x-api-key')) return null;
  if (!headers.get('cookie')) return null;
  const session = await auth.api.getSession({ headers });
  if (!session) return null;
  return {
    user: {
      id: session.user.id,
      name: session.user.name,
      email: session.user.email,
      impersonatedBy: session.session.impersonatedBy ?? null,
    },
    context: { db, headers, session, principal: { authMethod: 'session' } },
  };
}
