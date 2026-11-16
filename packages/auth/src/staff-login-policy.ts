/**
 * Staff sign-in facts shared by the auth instance, the API and the apps. No
 * server imports, so UIs can use it.
 */

/** Path of Better Auth's phone-number sign-in endpoint below `/api/auth`. */
export const STAFF_PHONE_SIGN_IN_PATH = '/sign-in/phone-number';

/**
 * Phone-number plugin endpoints that send or consume SMS codes. CampusPilot
 * sends no SMS, so they are disabled on the staff instance: numbers are
 * attested by the staff who enter them, and forgotten passwords are reset by
 * an administrator or principal.
 */
export const STAFF_DISABLED_PHONE_PATHS = [
  '/phone-number/send-otp',
  '/phone-number/verify',
  '/phone-number/request-password-reset',
  '/phone-number/reset-password',
] as const;

/**
 * Whether a request asks Better Auth's `/update-user` to change the caller's
 * own sign-in phone number. The phone-number plugin refuses a new number but
 * lets `null` through, which would let a person remove their phone sign-in
 * (or, for a phone-only account, fail the placeholder check with a server
 * error). Only staff procedures may change the number, so any `phoneNumber`
 * key is refused.
 */
export function changesOwnPhoneNumber(path: string, body: unknown): boolean {
  return (
    path === '/update-user' &&
    typeof body === 'object' &&
    body !== null &&
    'phoneNumber' in body
  );
}

/** Domain of every staff placeholder email; `.invalid` never delivers. */
export const STAFF_PLACEHOLDER_EMAIL_DOMAIN = 'phone.campuspilot.invalid';

/** Shortest password staff may set or be issued (matches `emailAndPassword`). */
export const STAFF_MIN_PASSWORD_LENGTH = 8;

/** Longest password accepted (Better Auth's default maximum). */
export const STAFF_MAX_PASSWORD_LENGTH = 128;
