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

/** Domain of every staff placeholder email; `.invalid` never delivers. */
export const STAFF_PLACEHOLDER_EMAIL_DOMAIN = 'phone.campuspilot.invalid';

/** Shortest password staff may set or be issued (matches `emailAndPassword`). */
export const STAFF_MIN_PASSWORD_LENGTH = 8;

/** Longest password accepted (Better Auth's default maximum). */
export const STAFF_MAX_PASSWORD_LENGTH = 128;
