import {
  currencyCodeSchema,
  currencyMinorUnitDigits,
} from "@campuspilot/db/schema/jsonb/currencies";

const POSTGRES_BIGINT_MAX = 9_223_372_036_854_775_807n;

/**
 * Parses a non-negative, non-exponent decimal string without ever passing
 * through a JavaScript number. Values with precision below one minor unit are
 * rejected instead of rounded implicitly.
 */
export function parseDecimalAmountToMinor(
  value: string,
  currency: string,
): bigint {
  const match = /^(0|[1-9]\d*)(?:\.(\d+))?$/.exec(value);
  if (!match) {
    throw new Error("Amount must be a non-negative plain decimal string");
  }

  const supportedCurrency = currencyCodeSchema.parse(currency);
  const digits = currencyMinorUnitDigits(supportedCurrency);
  const fraction = match[2] ?? "";
  if (fraction.length > digits) {
    throw new Error(
      `${currency} accepts at most ${digits} fractional decimal places`,
    );
  }

  const scale = 10n ** BigInt(digits);
  const amount =
    BigInt(match[1]!) * scale + BigInt(fraction.padEnd(digits, "0") || "0");
  if (amount > POSTGRES_BIGINT_MAX) {
    throw new Error("Amount exceeds the PostgreSQL bigint range");
  }
  return amount;
}

/** Exact compatibility conversion for JSON configuration, which is bounded to safe integers. */
export function parseDecimalAmountToSafeMinorNumber(
  value: string,
  currency: string,
): number {
  const amount = parseDecimalAmountToMinor(value, currency);
  if (amount > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("Configuration amount exceeds the exact JSON integer range");
  }
  return Number(amount);
}
