import { cadetAuth } from '@campuspilot/auth/cadet';
import { db } from '@campuspilot/db';
import { isSchoolFeatureEnabled } from '@campuspilot/db/feature-flags/store';
import { admissionTable } from '@campuspilot/db/schema/admission';
import { cadetUser } from '@campuspilot/db/schema/cadet';
import { eq } from 'drizzle-orm';

import type { OAuthGrant } from '../context';

/**
 * The oRPC context of the Cadet Portal (`cadetRouter`). It is a different
 * type from the staff `Context`, so no staff procedure can be called with a
 * cadet context and no cadet procedure with a staff one; at runtime the
 * cadet context is only ever resolved by the cadet Better Auth instance,
 * which reads only `cpc_` cookies and cadet tables.
 */

/** The signed-in cadet login, as the cadet instance verified it. */
export type CadetLogin = {
  /** `cadet_user.id`. */
  userId: string;
  /** The admission this login belongs to (`cadet_user.admission_id`). */
  admissionId: string;
};

/**
 * How the cadet authenticated, from the credential actually verified.
 * - `session`: `cpc_` browser session cookie (the Cadet Portal app).
 * - `oauth`: cadet MCP access token; only accepted on `/cadet/mcp`.
 * Cadet logins have no API keys.
 */
export type CadetPrincipal =
  | { authMethod: 'anonymous' }
  | { authMethod: 'session' }
  | { authMethod: 'oauth'; oauthGrant: OAuthGrant };

export type CadetContext = {
  db: typeof db;
  headers: Headers;
  login: CadetLogin | null;
  principal: CadetPrincipal;
};

/**
 * Resolves the cadet context from request headers through the cadet auth
 * instance. Staff cookies (`cp_`) and API keys are ignored: they are not
 * cadet credentials, so such a request is anonymous here.
 */
export async function createCadetContextFromHeaders(
  headers: Headers,
): Promise<CadetContext> {
  let session: Awaited<ReturnType<typeof cadetAuth.api.getSession>> = null;
  try {
    session = await cadetAuth.api.getSession({ headers });
  } catch {
    session = null;
  }
  return session
    ? {
        db,
        headers,
        login: { userId: session.user.id, admissionId: session.user.admissionId },
        principal: { authMethod: 'session' },
      }
    : { db, headers, login: null, principal: { authMethod: 'anonymous' } };
}

export type CadetOAuthContextInput = {
  headers: Headers;
  userId: string;
  oauthGrant: OAuthGrant;
};

/**
 * Creates the context for a request authenticated by a verified cadet MCP
 * access token. The login is loaded from the database, so a deleted login
 * (its admission was deleted or purged) stops authenticating immediately.
 * Returns null when the login no longer exists, and when the school's
 * `cadet` feature is disabled: the Cadet MCP gate then answers like a
 * revoked connection, so a connected AI app stops at the gate instead of
 * listing tools that would all be refused. The grant itself is kept and
 * works again once the feature is enabled.
 */
export async function createCadetOAuthContext({
  headers,
  userId,
  oauthGrant,
}: CadetOAuthContextInput): Promise<CadetContext | null> {
  const [login] = await db
    .select({
      id: cadetUser.id,
      admissionId: cadetUser.admissionId,
      schoolId: admissionTable.schoolId,
    })
    .from(cadetUser)
    .innerJoin(admissionTable, eq(admissionTable.id, cadetUser.admissionId))
    .where(eq(cadetUser.id, userId))
    .limit(1);
  if (!login) return null;
  if (!(await isSchoolFeatureEnabled(db, login.schoolId, 'cadet'))) return null;
  return {
    db,
    headers,
    login: { userId: login.id, admissionId: login.admissionId },
    principal: { authMethod: 'oauth', oauthGrant },
  };
}
