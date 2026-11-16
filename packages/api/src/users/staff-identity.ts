import { toE164PhoneNumber } from "@campuspilot/db/phone";
import { user } from "@campuspilot/db/schema/auth";
import { and, eq, ilike, or, sql, type SQL } from "drizzle-orm";

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
 * The sign-in identifier staff see for a person (real email, else phone
 * number), for sorting by it. Never the placeholder: the database check
 * guarantees a placeholder account has a phone number.
 */
export const staffSignInSortKey = sql<string>`case when ${user.emailIsPlaceholder} then ${user.phoneNumber} else ${user.email} end`;

/**
 * The substrings a search query matches stored E.164 numbers with: the query
 * without spaces, dashes and brackets (part of a number, `98765 43210`), and
 * its E.164 form when it is a whole number as people type it, for example
 * with a national trunk `0` (`098765 43210`), which is not a substring.
 */
export function phoneSearchPatterns(searchQuery: string): string[] {
  const phoneDigits = searchQuery.replace(/[\s()-]/g, "");
  const e164 = toE164PhoneNumber(searchQuery);
  return [...new Set([phoneDigits, e164 ?? ""])].filter(Boolean);
}

/**
 * Matches people by name, real email or phone number. Placeholder emails
 * never match. Phone numbers match by {@link phoneSearchPatterns}, so
 * `98765 43210` and `098765 43210` both find `+919876543210`.
 */
export function staffIdentitySearch(searchQuery: string): SQL | undefined {
  const pattern = `%${searchQuery}%`;
  return or(
    ilike(user.name, pattern),
    and(eq(user.emailIsPlaceholder, false), ilike(user.email, pattern)),
    ...phoneSearchPatterns(searchQuery).map((digits) =>
      ilike(user.phoneNumber, `%${digits}%`),
    ),
  );
}
