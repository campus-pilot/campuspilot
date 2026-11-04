/**
 * User API-key policy shared by the auth server and the account UIs. This
 * module has no server imports so both apps can show the same limits the
 * server enforces.
 */

const SECONDS_PER_DAY = 24 * 60 * 60;

/** Lifetime applied when a key is created without an explicit expiry. */
export const API_KEY_DEFAULT_EXPIRY_DAYS = 90;

/** Longest lifetime a user may choose. Keys never live forever. */
export const API_KEY_MAX_EXPIRY_DAYS = 365;

/** Shortest lifetime a user may choose. */
export const API_KEY_MIN_EXPIRY_DAYS = 1;

/**
 * Enabled, unexpired keys one user may hold at once. Expired or disabled keys
 * do not count, so a user can always replace a key that has lapsed.
 */
export const API_KEY_MAX_ACTIVE_PER_USER = 10;

/** Longest key name accepted, so lists stay readable. */
export const API_KEY_NAME_MAX_LENGTH = 32;

/** Expiry choices offered by the account UIs, in days. */
export const API_KEY_EXPIRY_OPTIONS_DAYS = [30, 90, 180, 365] as const;

/** Converts a lifetime in days to the seconds Better Auth expects. */
export function apiKeyExpiresInSeconds(days: number): number {
  return days * SECONDS_PER_DAY;
}

export const API_KEY_DEFAULT_EXPIRES_IN_SECONDS = apiKeyExpiresInSeconds(
  API_KEY_DEFAULT_EXPIRY_DAYS,
);
