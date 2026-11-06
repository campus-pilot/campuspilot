/**
 * Cadet Portal auth facts shared by the cadet auth instance, the API and the
 * cadet app. No server imports, so UIs can use it.
 */
import { MCP_READ_SCOPE } from './mcp-oauth-policy';

/** Where the cadet Better Auth instance is mounted on the API server. */
export const CADET_AUTH_BASE_PATH = '/api/cadet/auth';

/** Cookie prefix of the cadet instance (staff uses `cp_`). */
export const CADET_COOKIE_PREFIX = 'cpc_';

/** Path of the admission sign-in endpoint below CADET_AUTH_BASE_PATH. */
export const CADET_ADMISSION_SIGN_IN_PATH = '/sign-in/admission';

/** Cadet app route that signs the student in (and resumes an authorization). */
export const CADET_OAUTH_LOGIN_PATH = '/sign-in';

/** Cadet app route that shows the OAuth consent screen. */
export const CADET_OAUTH_CONSENT_PATH = '/oauth/consent';

/** Domain of every cadet login's placeholder email; `.invalid` never delivers. */
export const CADET_PLACEHOLDER_EMAIL_DOMAIN = 'cadet.campuspilot.invalid';

/**
 * Better Auth requires a unique, non-null email on every user. Cadet logins
 * get a placeholder built from the admission id, which never changes (unlike
 * the admission number, which schools may edit and which is never stored at
 * the auth level). Email sign-in is disabled on the cadet instance, so the
 * placeholder can never be used to sign in.
 */
export function cadetPlaceholderEmail(admissionId: string): string {
  return `${admissionId}@${CADET_PLACEHOLDER_EMAIL_DOMAIN}`;
}

/**
 * Scopes the cadet authorization server accepts. The cadet MCP is read-only
 * to start, so `mcp:write` is not offered; `email` is left out because the
 * only email a cadet login has is the placeholder.
 */
export const CADET_OAUTH_SUPPORTED_SCOPES = [
  'openid',
  'profile',
  'offline_access',
  MCP_READ_SCOPE,
] as const;

/** Scopes a cadet MCP connector gets by default and is challenged for. */
export const CADET_MCP_DEFAULT_SCOPES = [MCP_READ_SCOPE] as const;

/** Failed sign-ins for one admission before its sign-in is locked. */
export const CADET_ADMISSION_MAX_FAILURES = 5;
/** Window in which those failures are counted, and the lock's length. */
export const CADET_ADMISSION_FAILURE_WINDOW_SECONDS = 15 * 60;
export const CADET_ADMISSION_LOCK_SECONDS = 15 * 60;

/**
 * Looser per-IP limit on failed sign-ins. Looser because a whole school (a
 * computer lab behind one NAT) may sign in from one address.
 */
export const CADET_IP_MAX_FAILURES = 30;
export const CADET_IP_FAILURE_WINDOW_SECONDS = 15 * 60;
export const CADET_IP_LOCK_SECONDS = 15 * 60;
