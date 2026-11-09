import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js";
import { z } from "zod";

/**
 * Phone numbers are stored in E.164 (`+919876543210`), parsed and validated
 * with libphonenumber-js on both server and client (D-2). Shared by the API
 * and the UI so both accept exactly the same numbers.
 */

export type { CountryCode as PhoneCountryCode } from "libphonenumber-js";

/**
 * Country used to read a number typed without a country code (D-3: a code
 * constant, not a school setting; all current schools are Indian). The phone
 * input lets the user pick another country.
 */
export const DEFAULT_PHONE_COUNTRY: CountryCode = "IN";

/** Longest input accepted before parsing (formatting characters included). */
const MAX_PHONE_INPUT_LENGTH = 64;

/**
 * Parses a phone number as typed (spaces, dashes, a national trunk `0` or a
 * `+` country code are fine) and returns it in E.164, or null when it is not
 * a valid number. A number with its own `+` country code ignores
 * `defaultCountry`.
 */
export function toE164PhoneNumber(
  input: string,
  defaultCountry: CountryCode = DEFAULT_PHONE_COUNTRY,
): string | null {
  const trimmed = input.trim();
  if (!trimmed || trimmed.length > MAX_PHONE_INPUT_LENGTH) return null;
  const parsed = parsePhoneNumberFromString(trimmed, defaultCountry);
  return parsed?.isValid() ? parsed.number : null;
}

/** Whether a stored value is already a valid E.164 number. */
export function isE164PhoneNumber(value: string): boolean {
  return value.startsWith("+") && toE164PhoneNumber(value) === value;
}

/**
 * Input schema for a phone number: accepts what a person types (read with
 * {@link DEFAULT_PHONE_COUNTRY} when it has no `+` country code) and outputs
 * E.164.
 */
export const phoneNumberSchema = z
  .string()
  .trim()
  .min(1, "Phone number is required.")
  .max(MAX_PHONE_INPUT_LENGTH)
  // Advertised to API and MCP clients (and used by schema-sample tests).
  .meta({ examples: ["+919876543210"] })
  .transform((value, context) => {
    const e164 = toE164PhoneNumber(value);
    if (!e164) {
      context.addIssue({
        code: "custom",
        message: "Enter a valid phone number, including the country code for numbers outside India.",
      });
      return z.NEVER;
    }
    return e164;
  });

/**
 * Display form of a stored phone number. Valid E.164 values are shown in
 * international format (`+91 98765 43210`). Anything else, such as a value
 * entered before numbers were validated that the backfill could not parse,
 * is shown unchanged: reading never fails on an unmigrated value.
 */
export function formatPhoneNumberForDisplay(value: string): string {
  if (!value.startsWith("+")) return value;
  const parsed = parsePhoneNumberFromString(value);
  return parsed?.isValid() ? parsed.formatInternational() : value;
}
