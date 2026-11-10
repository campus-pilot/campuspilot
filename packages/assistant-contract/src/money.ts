/**
 * USD amounts the assistant saves (`cost_usd numeric(14,8)`) travel as
 * decimal text and are added as integers of 10⁻⁸ USD, never as floats, so a
 * sum shown to a developer or an administrator is the exact sum of the saved
 * rows. (`BigInt(…)` rather than `n` literals: the browser apps compile for
 * targets older than ES2020.)
 */
const SCALE = 8;
const ZERO = BigInt(0);
const TWO = BigInt(2);
const TEN = BigInt(10);
const UNIT = TEN ** BigInt(SCALE);

function toUnits(amount: string): bigint {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(amount.trim());
  if (!match) throw new Error(`Not a USD amount: ${amount}`);
  return BigInt(match[1]!) * UNIT + BigInt((match[2] ?? '').slice(0, SCALE).padEnd(SCALE, '0'));
}

function fromUnits(units: bigint): string {
  const whole = units / UNIT;
  const fraction = (units % UNIT).toString().padStart(SCALE, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : String(whole);
}

/** The exact sum of decimal USD amounts, as decimal text. */
export function sumUsd(amounts: readonly string[]): string {
  return fromUnits(amounts.reduce((total, amount) => total + toUnits(amount), ZERO));
}

/**
 * A saved amount for display: two decimals from a dollar up, four below so a
 * cheap turn does not read as $0.00. Display only (the amount is rounded).
 */
export function formatUsdText(amount: string): string {
  const units = toUnits(amount);
  const decimals = units < UNIT ? 4 : 2;
  const step = TEN ** BigInt(SCALE - decimals);
  const rounded = (units + step / TWO) / step;
  const text = rounded.toString().padStart(decimals + 1, '0');
  return `$${text.slice(0, -decimals)}.${text.slice(-decimals)}`;
}
