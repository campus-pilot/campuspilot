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
  return usdToUnits(spendUsd) >= limitUnits(limitUsd);
}

/** A configured limit in dollars as an integer of 10⁻⁸ USD, through its decimal text (see {@link spendReachedLimit}). */
const limitUnits = (limitUsd: number) => usdToUnits(limitUsd.toFixed(USD_SCALE));

/**
 * A saved spend as a percentage of a limit, the share of a school's AI
 * allowance it used, computed with integers (no float touches the division)
 * and rounded **down** to one decimal. Rounding down keeps it in step with
 * {@link spendReachedLimit}: it reads 100 or more exactly when the limit is
 * reached, so a school is never told "100%" while it may still send, nor
 * refused at "99.9%". Not capped: spend may pass the limit by what the
 * spend cache let through (`SPEND_CACHE_SECONDS`).
 *
 * Any spend at all reads at least 0.1, the smallest share there is: rounded
 * down, a share under a tenth of a percent would read 0, as if nothing had
 * been used (the screens then show "<1%"). That never touches 100.
 *
 * The limit is at least a cent (the feature config's minimum), so it is
 * never zero units here.
 */
export function spendPercentOfLimit(spendUsd: string, limitUsd: number): number {
  const spent = usdToUnits(spendUsd);
  const tenths = (spent * BigInt(1000)) / limitUnits(limitUsd);
  if (spent > BigInt(0) && tenths === BigInt(0)) return 0.1;
  return Number(tenths) / 10;
}
