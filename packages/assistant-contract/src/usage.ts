/**
 * Facts shared by the assistant's usage procedures (API) and the pages that
 * show them (admin, management).
 */

/** The longest range one usage request may ask for, in days (inclusive IST dates). */
export const MAX_USAGE_RANGE_DAYS = 400;

/**
 * A sum of tokens. Postgres sums them as `bigint`; a sum is a JSON number
 * while it is a safe integer and its decimal text beyond that, so no total is
 * ever silently rounded.
 */
export type TokenCount = number | string;

/** A `bigint` sum (as text) as a {@link TokenCount}. */
export function tokenCountFromText(text: string): TokenCount {
  const value = BigInt(text);
  return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : value.toString();
}

/** The exact sum of token counts. */
export function addTokenCounts(...counts: readonly TokenCount[]): TokenCount {
  return tokenCountFromText(counts.reduce<bigint>((total, count) => total + BigInt(count), BigInt(0)).toString());
}

/** A token count for display, grouped in the Indian style. */
export function formatTokenCount(count: TokenCount): string {
  return BigInt(count).toLocaleString('en-IN');
}
