import { currencyCodeSchema, currencyMinorUnitDigits } from "@campuspilot/db/schema/jsonb/currencies";
import type { FinanceRecurring } from "@campuspilot/db/schema/jsonb/finance-config";

/** An exact minor-unit amount as the decimal string templates print ("1100.00", "-0.05", "500" for JPY). */
export function formatDocumentMoney(value: bigint, currency: string) {
  const digits = currencyMinorUnitDigits(currencyCodeSchema.parse(currency));
  const sign = value < BigInt(0) ? "-" : "";
  const absolute = value < BigInt(0) ? -value : value;
  if (digits === 0) return `${sign}${absolute}`;
  const scale = BigInt(10) ** BigInt(digits);
  const whole = absolute / scale;
  const fraction = (absolute % scale).toString().padStart(digits, "0");
  return `${sign}${whole}.${fraction}`;
}

/**
 * An optional amount of a finance document: null when it is zero, so a
 * template's `{{#if}}` hides the row ("0.00" is a non-empty string and would
 * print). Used for the opening balance and the period totals; the amount due
 * (`balanceAfter`) is never optional and always printed, even "0.00".
 */
export function optionalDocumentMoney(value: bigint, currency: string) {
  return value === BigInt(0) ? null : formatDocumentMoney(value, currency);
}

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

/**
 * A calendar date as parts, never preformatted, so a template writes the
 * format it wants (for example `{{date.day}}/{{date.month}}/{{date.year}}` or
 * `{{date.day}} {{date.monthName}} {{date.year}}`) without a date helper.
 * `day` and `month` are two digits ("05", "11"), `year` four, `monthName` the
 * English month ("November") and `iso` the whole date ("2026-11-05").
 */
export type DocumentDateParts = {
  iso: string;
  day: string;
  month: string;
  year: string;
  monthName: string;
};

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The parts of a `YYYY-MM-DD` calendar date. It never goes through a `Date`, so no time zone can shift it. */
export function documentDateParts(iso: string): DocumentDateParts {
  const match = ISO_DATE.exec(iso);
  const month = match ? Number(match[2]) : 0;
  if (!match || month < 1 || month > 12) throw new Error(`Not a calendar date: ${iso}`);
  return { iso, day: match[3]!, month: match[2]!, year: match[1]!, monthName: MONTH_NAMES[month - 1]! };
}

/** The local calendar date of an instant in a time zone, as `YYYY-MM-DD`. */
export function localDateOf(instant: Date, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" })
      .formatToParts(instant)
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/** The day before a `YYYY-MM-DD` date. */
function dayBefore(iso: string) {
  const date = new Date(`${iso}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

/** The day after a `YYYY-MM-DD` date. */
export function dayAfter(iso: string) {
  const date = new Date(`${iso}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

/**
 * A billing period as a template sees it (`bill.period`, `billDue.period`):
 * its recorded cadence and its first and **last** day as date parts. Billing
 * periods are stored half-open (`endDate` is the next period's first day), so
 * `end` is the day before it: a November period prints "1 November to 30
 * November".
 */
export type DocumentBillingPeriod = {
  cadence: FinanceRecurring;
  start: DocumentDateParts;
  end: DocumentDateParts;
};

export function documentBillingPeriod(cadence: FinanceRecurring, startDate: string, endDateExclusive: string): DocumentBillingPeriod {
  return { cadence, start: documentDateParts(startDate), end: documentDateParts(dayBefore(endDateExclusive)) };
}
