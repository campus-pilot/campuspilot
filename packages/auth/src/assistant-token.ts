import { env } from '@campuspilot/env/server';
import { jwtVerify, SignJWT } from 'jose';

/**
 * Delegated access for the in-app assistant (`packages/assistant`).
 *
 * The assistant's turn loop (in `apps/worker`) calls the CampusPilot MCP
 * endpoint as a user, with a token the API issues in-process for exactly one
 * user, school, conversation and run (`issueAssistantRunToken` in
 * `@campuspilot/api/assistant/token`). It is only issued while that user's
 * own browser session is making a request, so the assistant can never act for
 * a user who is not actively using it.
 */

/** How long one delegated token is valid. */
export const ASSISTANT_TOKEN_TTL_SECONDS = 30 * 60;

const ISSUER = 'campuspilot-api';
/** Distinguishes these tokens from every other JWT the platform verifies. */
const TOKEN_TYPE = 'campuspilot-assistant+jwt';

export type AssistantTokenClaims = {
  userId: string;
  schoolId: string;
  conversationId: string;
  runId: string;
  expiresAt: Date;
};

function signingKey(): Uint8Array | null {
  return env.ASSISTANT_TOKEN_SIGNING_SECRET
    ? new TextEncoder().encode(env.ASSISTANT_TOKEN_SIGNING_SECRET)
    : null;
}

/** Whether this deployment is configured to delegate to the assistant. */
export function assistantDelegationEnabled(): boolean {
  return signingKey() !== null;
}

export async function signAssistantToken(
  claims: Omit<AssistantTokenClaims, 'expiresAt'>,
): Promise<{ token: string; expiresAt: Date }> {
  const key = signingKey();
  if (!key) throw new Error('Assistant delegation is not configured.');
  const expiresAt = new Date(Date.now() + ASSISTANT_TOKEN_TTL_SECONDS * 1000);
  const token = await new SignJWT({
    sid: claims.schoolId,
    cid: claims.conversationId,
    rid: claims.runId,
  })
    .setProtectedHeader({ alg: 'HS256', typ: TOKEN_TYPE })
    .setIssuer(ISSUER)
    .setAudience(env.MCP_RESOURCE_URL)
    .setSubject(claims.userId)
    .setIssuedAt()
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
    .sign(key);
  return { token, expiresAt };
}

/**
 * Verifies a bearer value as an assistant token: signature, type, issuer,
 * audience and expiry. Returns null for anything else so the MCP gate can
 * try its next verifier; nothing is decided from the value's shape.
 */
export async function verifyAssistantToken(
  token: string,
): Promise<AssistantTokenClaims | null> {
  const key = signingKey();
  if (!key) return null;
  try {
    const { payload, protectedHeader } = await jwtVerify(token, key, {
      algorithms: ['HS256'],
      issuer: ISSUER,
      audience: env.MCP_RESOURCE_URL,
      typ: TOKEN_TYPE,
    });
    if (
      protectedHeader.typ !== TOKEN_TYPE ||
      typeof payload.sub !== 'string' ||
      typeof payload.sid !== 'string' ||
      typeof payload.cid !== 'string' ||
      typeof payload.rid !== 'string' ||
      typeof payload.exp !== 'number'
    ) {
      return null;
    }
    return {
      userId: payload.sub,
      schoolId: payload.sid,
      conversationId: payload.cid,
      runId: payload.rid,
      expiresAt: new Date(payload.exp * 1000),
    };
  } catch {
    return null;
  }
}
