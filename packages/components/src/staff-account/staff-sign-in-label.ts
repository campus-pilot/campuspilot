import { formatPhoneNumberForDisplay } from '@campuspilot/db/phone';

/** Shows a stored E.164 number in international format (`+91 98765 43210`). */
export const formatStaffPhoneNumber = formatPhoneNumberForDisplay;

/** How a person signs in, as staff-facing DTOs return it. */
export type StaffSignInIdentity = {
  /** Null when the account has no email of its own. */
  email: string | null;
  /** E.164 sign-in number, or null. */
  phoneNumber: string | null;
};

/**
 * The identifier to show for a person: their email, else their phone number
 * in international format. Email wins because it is what most staff sign in
 * with; a phone-only account always has a number (enforced by the database).
 */
export function staffSignInLabel(identity: StaffSignInIdentity): string {
  if (identity.email) return identity.email;
  return identity.phoneNumber ? formatPhoneNumberForDisplay(identity.phoneNumber) : '';
}

/**
 * Up to two avatar initials: from the person's name, else from the local part
 * of their email. Null for an unnamed phone-only account, since a number has
 * no letters to take initials from; callers show a person icon instead.
 */
export function staffInitials(person: StaffSignInIdentity & { name: string }): string | null {
  const source = person.name.trim() || person.email?.split('@')[0] || '';
  const initials = source
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
  return initials || null;
}

/**
 * The identifiers a person's one password signs in with, for sentences such
 * as "will use this password with their phone number".
 */
export function staffPasswordIdentifiers(identity: StaffSignInIdentity): string {
  if (identity.email && identity.phoneNumber) return 'their phone number and email';
  return identity.email ? 'their email' : 'their phone number';
}

/**
 * The sign-in identity of a Better Auth session user. The session always
 * carries an email; the stored `emailIsPlaceholder` fact says whether it is
 * the person's own.
 */
export function sessionUserSignInIdentity(user: {
  email: string;
  emailIsPlaceholder?: boolean | null;
  phoneNumber?: string | null;
}): StaffSignInIdentity {
  return {
    email: user.emailIsPlaceholder ? null : user.email,
    phoneNumber: user.phoneNumber ?? null,
  };
}
