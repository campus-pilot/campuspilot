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
 * A 16+ character password of two words and digits, e.g. `Cedar-Lotus-4821`.
 * Uses `node:crypto`; never derived from the journaled seed, so it cannot be
 * reconstructed from workflow state.
 */
export function generateDemoPassword(): string {
  const words = demoSeed.staff.passwordWords;
  const word = () => {
    const picked = words[randomInt(words.length)]!;
    return picked[0]!.toUpperCase() + picked.slice(1);
  };
  let password = `${word()}-${word()}-${String(randomInt(1000, 10000))}`;
  while (password.length < 16) password += String(randomInt(10));
  return password;
}
