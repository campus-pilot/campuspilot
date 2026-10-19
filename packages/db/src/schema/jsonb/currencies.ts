import { z } from "zod";

/**
 * Reviewed currencies supported by the finance posting and rendering stack.
 * Adding a code requires an ISO exponent review plus a migration-policy update.
 */
export const SUPPORTED_CURRENCY_MINOR_UNITS = {
  AED: 2,
  AUD: 2,
  BDT: 2,
  BHD: 3,
  CAD: 2,
  CLF: 4,
  EUR: 2,
  GBP: 2,
  INR: 2,
  JPY: 0,
  KWD: 3,
  LKR: 2,
  NPR: 2,
  PKR: 2,
  QAR: 2,
  SAR: 2,
  SGD: 2,
  USD: 2,
} as const;

export type CurrencyCode = keyof typeof SUPPORTED_CURRENCY_MINOR_UNITS;

export const SUPPORTED_CURRENCY_CODES = Object.keys(
  SUPPORTED_CURRENCY_MINOR_UNITS,
) as [CurrencyCode, ...CurrencyCode[]];

export const currencyCodeSchema = z
  .enum(SUPPORTED_CURRENCY_CODES)
  .describe("Reviewed ISO 4217 currency supported by CampusPilot finance");

export function currencyMinorUnitDigits(currency: CurrencyCode): number {
  return SUPPORTED_CURRENCY_MINOR_UNITS[currency];
}

/** Parses a UI decimal string exactly into a JSON-safe minor-unit integer. */
export function parseCurrencyDecimalToMinorNumber(
  value: string,
  currency: CurrencyCode,
): number {
  const match = /^(0|[1-9]\d*)(?:\.(\d+))?$/.exec(value);
  if (!match) throw new Error("Amount must be a non-negative plain decimal");

  const digits = currencyMinorUnitDigits(currency);
  const fraction = match[2] ?? "";
  if (fraction.length > digits) {
    throw new Error(`${currency} accepts at most ${digits} decimal places`);
  }
  const minor =
    BigInt(match[1]!) * BigInt(10) ** BigInt(digits) +
    BigInt(fraction.padEnd(digits, "0") || "0");
  if (minor > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("Amount exceeds the exact configuration range");
  }
  return Number(minor);
}

/** Formats an exact JSON-safe minor-unit integer without floating point. */
export function formatCurrencyMinorNumber(
  amountMinor: number,
  currency: CurrencyCode,
): string {
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 0) {
    throw new Error("Minor-unit amount must be a non-negative safe integer");
  }
  const digits = currencyMinorUnitDigits(currency);
  if (digits === 0) return String(amountMinor);

  const raw = String(amountMinor).padStart(digits + 1, "0");
  const whole = raw.slice(0, -digits);
  const fraction = raw.slice(-digits).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}
