import { timingSafeEqual } from 'node:crypto';

import { ASSISTANT_SERVICE_SECRET_HEADER } from '@campuspilot/assistant-contract/protocol';
import { env } from '@campuspilot/env/server';
import { jwtVerify, SignJWT } from 'jose';

/**
 * Delegated access for the separate assistant service (apps/assistant).
 *
 * The assistant calls the CampusPilot MCP endpoint as a user, with a token
 * the API issues for exactly one user, school, conversation and run. The API
 * only issues one when the request carries both that user's live session and
 * the assistant's service secret, so the service can never act for a user
 * who is not actively using it, and nothing else can use the endpoint.
 */

/** How long one delegated token is valid. */
export const ASSISTANT_TOKEN_TTL_SECONDS = 30 * 60;

export { ASSISTANT_SERVICE_SECRET_HEADER };

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
  return env.ASSISTANT_TOKEN_SIGNING_SECRET && env.ASSISTANT_SERVICE_SECRET
    ? new TextEncoder().encode(env.ASSISTANT_TOKEN_SIGNING_SECRET)
    : null;
}

/** Whether this deployment is configured to delegate to the assistant. */
export function assistantDelegationEnabled(): boolean {
  return signingKey() !== null;
}

/** Constant-time check of a presented service secret. */
export function isAssistantServiceSecret(presented: string | null | undefined): boolean {
  const expected = env.ASSISTANT_SERVICE_SECRET;
  if (!expected || !presented) return false;
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
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
