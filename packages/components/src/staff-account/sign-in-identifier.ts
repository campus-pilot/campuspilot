import { toE164PhoneNumber } from '@campuspilot/db/phone';
import { z } from 'zod';

/** What a person typed into a combined "Email or phone number" field. */
export type SignInIdentifier =
  | { kind: 'email'; email: string }
  | { kind: 'phone'; phoneNumber: string };

/**
 * Reads a combined sign-in field. Anything with an `@` is an email (it must
 * be a valid address); anything else is read as a phone number, with numbers
 * typed without a `+` country code read as Indian (the shared phone default),
 * and returned in E.164, the form the server stores and looks up. Returns
 * null when it is neither.
 */
export function parseSignInIdentifier(input: string): SignInIdentifier | null {
  const value = input.trim();
  if (!value) return null;
  if (value.includes('@')) {
    return z.email().safeParse(value).success ? { kind: 'email', email: value.toLowerCase() } : null;
  }
  const phoneNumber = toE164PhoneNumber(value);
  return phoneNumber ? { kind: 'phone', phoneNumber } : null;
}
