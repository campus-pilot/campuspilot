import { user } from "@campuspilot/db/schema/auth";
import { and, eq, ilike, or, type SQL } from "drizzle-orm";

/**
 * The columns every staff-facing read selects to show how a person signs in.
 * Pair with {@link toStaffIdentity}; never expose `email` without it, because
 * phone-only accounts hold a placeholder there.
 */
export const staffIdentityColumns = {
  email: user.email,
  emailIsPlaceholder: user.emailIsPlaceholder,
  phoneNumber: user.phoneNumber,
};

/**
 * Sign-in identifiers as staff should see them: `email` is null when the
 * account's email is a placeholder (decided by the stored
 * `emailIsPlaceholder` fact, never by the address), and `phoneNumber` is the
 * E.164 sign-in number or null.
 */
export function toStaffIdentity(row: {
  email: string;
  emailIsPlaceholder: boolean;
  phoneNumber: string | null;
}): { email: string | null; phoneNumber: string | null } {
  return {
    email: row.emailIsPlaceholder ? null : row.email,
    phoneNumber: row.phoneNumber,
  };
}

/**
 * Matches people by name, real email or phone number. Placeholder emails
 * never match. Spaces, dashes and brackets are dropped before matching phone
 * numbers, so `98765 43210` finds `+919876543210`.
 */
export function staffIdentitySearch(searchQuery: string): SQL | undefined {
  const pattern = `%${searchQuery}%`;
  const phoneDigits = searchQuery.replace(/[\s()-]/g, "");
  return or(
    ilike(user.name, pattern),
    and(eq(user.emailIsPlaceholder, false), ilike(user.email, pattern)),
    phoneDigits ? ilike(user.phoneNumber, `%${phoneDigits}%`) : undefined,
  );
}
