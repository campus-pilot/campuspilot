/**
 * Amounts as billing stores them (docs/school-billing.md): integers in the
 * currency's smallest unit (paise), as payment providers store them, so
 * rupees never pass through floating point on the way to the server.
 */

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 });

/** "₹1,999.00" from 199900 paise. */
export function formatPaise(amountMinor: number): string {
  return inr.format(amountMinor / 100);
}

/** Paise from a typed rupee amount ("1999", "1,999.50"); null when it is not an amount with at most two decimals. */
export function rupeesToPaise(value: string): number | null {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value.replaceAll(',', '').trim());
  if (!match) return null;
  return Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
}
