import { randomInt } from 'node:crypto';

import { demoSeed } from './seed';

export { slugifySchoolName } from './slug';

/**
 * A random 12-digit registration number (D2): digits only, first digit 1–9.
 * Drawn with `node:crypto` rather than the seeded PRNG because it is created
 * once, synchronously, before any workflow exists.
 */
export function generateRegistrationNumber(draw: (min: number, max: number) => number = randomInt): string {
  let value = String(draw(1, 10));
  while (value.length < 12) value += String(draw(0, 10));
  return value;
}

/** `base`, then `base-2`, `base-3`, … until `isTaken` is false. */
export async function uniqueSlug(base: string, isTaken: (slug: string) => Promise<boolean>): Promise<string> {
  for (let suffix = 1; ; suffix += 1) {
    const candidate = suffix === 1 ? base : `${base}-${suffix}`;
    if (!(await isTaken(candidate))) return candidate;
  }
}

/**
 * A demo staff login (D9): `{role}.{schoolSlug}@campuspilot.in` for single
 * holders, and `teacher{n}.{schoolSlug}@campuspilot.in` numbered from 1 in
 * class catalogue order.
 */
export function demoStaffEmail(emailRole: string, schoolSlug: string, teacherNumber?: number): string {
  const local = teacherNumber === undefined ? emailRole : `${emailRole}${teacherNumber}`;
  return `${local}.${schoolSlug}@${demoSeed.staff.emailDomain}`;
}

/**
 * Crockford base32 without the easily confused I, L, O and U: 32 symbols,
 * exactly 5 bits each, so `randomInt` draws them without bias.
 */
export const DEMO_PASSWORD_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const DEMO_PASSWORD_GROUPS = 4;
const DEMO_PASSWORD_GROUP_LENGTH = 4;

/** Entropy of a generated demo password: 16 symbols × 5 bits = 80 bits. */
export const DEMO_PASSWORD_ENTROPY_BITS =
  DEMO_PASSWORD_GROUPS * DEMO_PASSWORD_GROUP_LENGTH * Math.log2(DEMO_PASSWORD_ALPHABET.length);

/**
 * A readable 80-bit password such as `7KQ2-MX9D-H4TC-0VNR`, drawn with
 * `node:crypto`. Never derived from the journaled seed, so it cannot be
 * reconstructed from workflow state.
 */
export function generateDemoPassword(draw: (max: number) => number = randomInt): string {
  return Array.from({ length: DEMO_PASSWORD_GROUPS }, () =>
    Array.from({ length: DEMO_PASSWORD_GROUP_LENGTH }, () => DEMO_PASSWORD_ALPHABET[draw(DEMO_PASSWORD_ALPHABET.length)]!).join(''),
  ).join('-');
}
