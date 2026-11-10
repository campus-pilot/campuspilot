/**
 * Phone search for the admission list (review round 2, #8). Phones are
 * stored in E.164 (`+919876543210`) since the backfill, so a plain substring
 * match misses how staff type them: with spaces (`98765 43210`), a national
 * trunk 0 (`098765 43210`) or `+91 …`. A query that looks like a phone
 * number (digits with spaces, `+`, `-`, `.`, parentheses only, at least
 * {@link MIN_PHONE_SEARCH_DIGITS} digits) is reduced to its digits, leading
 * zeros dropped, and matched against the stored number's digits. Anything
 * else keeps the plain text match.
 */
export const MIN_PHONE_SEARCH_DIGITS = 4;

/** The digits to match a phone-like query against stored digits; null when the query is not phone-like. */
export function phoneSearchDigits(query: string): string | null {
  const trimmed = query.trim();
  if (!/^[\d\s()+.-]+$/.test(trimmed)) return null;
  const digits = trimmed.replace(/\D/g, '').replace(/^0+/, '');
  return digits.length >= MIN_PHONE_SEARCH_DIGITS ? digits : null;
}
