/**
 * Exact comparisons of USD amounts. Saved costs are Postgres `numeric`
 * (`numeric(14,8)`) and reach the API as decimal text; they are compared as
 * integers of 10⁻⁸ USD, never as floats.
 */

/** Decimal places of saved USD amounts (`cost_usd numeric(14,8)`). */
const USD_SCALE = 8;

/** A non-negative decimal USD text (`"12.5"`, `"0.00012345"`) as an integer of 10⁻⁸ USD. */
export function usdToUnits(amount: string): bigint {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(amount.trim());
  if (!match) throw new Error(`Not a USD amount: ${amount}`);
  const fraction = (match[2] ?? '').slice(0, USD_SCALE).padEnd(USD_SCALE, '0');
  return BigInt(match[1]!) * BigInt(10) ** BigInt(USD_SCALE) + BigInt(fraction);
}

/**
 * Whether a saved spend has reached a limit. The limit is a configured number
 * of dollars (the feature flag's `monthlyLimitUsd`), written at most to the
 * cent in practice; it is read through its decimal text so no float
 * arithmetic touches the comparison.
 */
export function spendReachedLimit(spendUsd: string, limitUsd: number): boolean {
  return usdToUnits(spendUsd) >= usdToUnits(limitUsd.toFixed(USD_SCALE));
}
