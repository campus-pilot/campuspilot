import { z } from "zod";
import {
  SUPPORTED_CURRENCY_MINOR_UNITS,
  type CurrencyCode,
} from "@campuspilot/db/schema/jsonb/currencies";

export type FinanceAction =
  | "manual_bill"
  | "payment"
  | "adjustment"
  | "refund"
  | "reversal"
  | "statement";

export type FinanceScopeSelection = { id: string; label: string };

/** Converts named UI selections to the API scope while preserving blank as
 * "all eligible" and removing duplicate internal identifiers. */
export function financeScopeIds(values: FinanceScopeSelection[]): string[] | undefined {
  const ids = [...new Set(values.map(({ id }) => id))];
  return ids.length ? ids : undefined;
}

const INTEGER_MINOR = /^(0|[1-9]\d*)$/;
const DECIMAL_MAJOR = /^(0|[1-9]\d*)(?:\.(\d+))?$/;

export function currencyExponent(currency: string): number {
  const exponent = SUPPORTED_CURRENCY_MINOR_UNITS[currency as CurrencyCode];
  if (exponent === undefined) throw new Error(`Unsupported currency: ${currency}`);
  return exponent;
}

/** Converts a user-entered major-unit amount to exact minor units without
 * passing the value through binary floating-point arithmetic. */
export function decimalToMinor(value: string, currency: string): string {
  const normalized = value.trim();
  const match = DECIMAL_MAJOR.exec(normalized);
  if (!match) throw new Error("Enter a non-negative plain decimal amount.");
  const exponent = currencyExponent(currency);
  const [whole, fraction = ""] = normalized.split(".");
  if (fraction.length > exponent) throw new Error(`${currency} accepts at most ${exponent} decimal places.`);
  const scale = BigInt(10) ** BigInt(exponent);
  return (BigInt(whole!) * scale + BigInt(fraction.padEnd(exponent, "0") || "0")).toString();
}

/** Formats exact integer minor units. This deliberately avoids Number so
 * operational PostgreSQL bigint values remain lossless in the browser. */
export function formatMinor(value: string, currency: string): string {
  const negative = value.startsWith("-");
  const magnitude = negative ? value.slice(1) : value;
  if (!INTEGER_MINOR.test(magnitude)) return `${currency} ${value}`;
  const exponent = currencyExponent(currency);
  const scale = BigInt(10) ** BigInt(exponent);
  const minor = BigInt(magnitude);
  const whole = (minor / scale).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const fraction = exponent === 0 ? "" : `.${(minor % scale).toString().padStart(exponent, "0")}`;
  return `${negative ? "-" : ""}${currency} ${whole}${fraction}`;
}

/** Returns the civil date observed in the configured IANA timezone. */
export function civilDateInTimeZone(timeZone: string, instant = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}

/** Returns a datetime-local value in the configured IANA timezone. */
export function civilDateTimeInTimeZone(timeZone: string, instant = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value;
  return `${value("year")}-${value("month")}-${value("day")}T${value("hour")}:${value("minute")}`;
}

/** Converts a datetime-local civil value in an explicit IANA timezone to an
 * instant. The round-trip guard rejects nonexistent DST wall times. */
export function instantFromCivilDateTime(value: string, timeZone: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) throw new Error("Choose a valid local date and time.");
  const target = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]));
  let candidate = target;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const observed = civilDateTimeInTimeZone(timeZone, new Date(candidate));
    const observedMatch = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(observed)!;
    const observedUtc = Date.UTC(Number(observedMatch[1]), Number(observedMatch[2]) - 1, Number(observedMatch[3]), Number(observedMatch[4]), Number(observedMatch[5]));
    candidate += target - observedUtc;
  }
  const instant = new Date(candidate);
  if (civilDateTimeInTimeZone(timeZone, instant) !== value) throw new Error(`That local time does not exist in ${timeZone}.`);
  return instant;
}

/** Formats an accounting instant in the configured school/session timezone,
 * never in the browser's ambient timezone. */
export function formatFinanceInstant(
  value: Date | string,
  timeZone: string,
  options: { dateOnly?: boolean } = {},
): string {
  return new Intl.DateTimeFormat("en", {
    timeZone,
    dateStyle: "medium",
    ...(options.dateOnly ? {} : { timeStyle: "short" as const }),
  }).format(new Date(value));
}

/** Returns a field-adjacent validation message without throwing from a submit
 * handler. Blank/shape validation remains the caller's Zod responsibility. */
export function financeAmountError(
  value: string,
  currency: string,
  positive = true,
): string | undefined {
  try {
    const minor = decimalToMinor(value, currency);
    return positive && BigInt(minor) <= BigInt(0)
      ? "Amount must be greater than zero."
      : undefined;
  } catch (error) {
    return error instanceof Error ? error.message : "Enter an exact amount.";
  }
}

export function financeDateTimeError(value: string, timeZone: string): string | undefined {
  try {
    instantFromCivilDateTime(value, timeZone);
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : "Choose a valid date and time.";
  }
}

export function reversalActionForEntry(type: string): "bill" | "ledger_entry" {
  return type === "bill" ? "bill" : "ledger_entry";
}

export function adjustmentTargetFields(input: { kind: string; target: "bill" | "account"; billId?: string; billLineId?: string }) {
  if (input.target === "account") {
    if (input.kind !== "credit_correction") throw new Error("Only credit corrections can target the admission account.");
    return {};
  }
  if (!input.billId) throw new Error("Choose a posted bill.");
  return { billId: input.billId, ...(input.billLineId ? { billLineId: input.billLineId } : {}) };
}

export function paymentDeepLinkTarget(paymentId?: string, admissionId?: string) {
  return paymentId ? { id: paymentId, admissionId } : undefined;
}

export function groupFinanceIssues<T extends { scope: "configuration" | "session" | "class" | "admission" }>(issues: T[]) {
  return (["configuration", "session", "class", "admission"] as const).map((scope) => ({ scope, items: issues.filter((issue) => issue.scope === scope) })).filter(({ items }) => items.length > 0);
}

export type IdempotencyDraftState = {
  fingerprint: string;
  key: string;
  ambiguous: boolean;
};

/** Reuses a command key while its canonical draft is unchanged. Ambiguous
 * responses retain the key so an exact retry cannot duplicate the posting. */
export function idempotencyForDraft(
  state: IdempotencyDraftState | undefined,
  fingerprint: string,
  createKey: () => string,
): IdempotencyDraftState {
  return state?.fingerprint === fingerprint
    ? state
    : { fingerprint, key: createKey(), ambiguous: false };
}

export function markIdempotencyAmbiguous(state: IdempotencyDraftState): IdempotencyDraftState {
  return { ...state, ambiguous: true };
}

export function resolveIdempotencyAudit(
  state: IdempotencyDraftState,
  authoritativeRecordFound: boolean,
): IdempotencyDraftState | undefined {
  return authoritativeRecordFound ? undefined : { ...state, ambiguous: false };
}

export type DirtyCloseState = { dirty: boolean; confirmationOpen: boolean };

export function requestDirtyClose(state: DirtyCloseState): DirtyCloseState {
  return state.dirty ? { ...state, confirmationOpen: true } : state;
}

export function clearSelectionForScope<T>(selection: T | undefined, scopeChanged: boolean): T | undefined {
  return scopeChanged ? undefined : selection;
}

export function formatBasisPoints(value: string): string {
  if (!INTEGER_MINOR.test(value)) return value;
  const basisPoints = BigInt(value);
  return `${basisPoints / BigInt(100)}.${(basisPoints % BigInt(100)).toString().padStart(2, "0")}%`;
}

/** Mirrors the server's half-up percentage snapshot calculation for local
 * review only. The server remains authoritative when the adjustment posts. */
export function calculatePercentageMinor(
  eligibleMinor: string,
  percentage: string,
): string {
  if (!INTEGER_MINOR.test(eligibleMinor)) throw new Error("Invalid eligible amount.");
  if (!/^(?:100(?:\.0{1,4})?|(?:[1-9]\d?|0)\.\d{1,4}|[1-9]\d?)$/.test(percentage)) {
    throw new Error("Enter a percentage greater than 0 and at most 100.");
  }
  const [whole, fraction = ""] = percentage.split(".");
  const numerator = BigInt(`${whole}${fraction}`);
  if (numerator <= BigInt(0)) throw new Error("Enter a percentage greater than 0.");
  const denominator = BigInt(100) * BigInt(10) ** BigInt(fraction.length);
  return ((BigInt(eligibleMinor) * numerator + denominator / BigInt(2)) / denominator).toString();
}

export type BillingDraftSnapshot = {
  billingDate: string;
  kind: "regular" | "supplemental";
  supplementalReason: string;
  sessionValues: Record<string, string>;
};

export const financeBillingDraftSchema = z.object({
  billingDate: z.string().date("Choose a billing date."),
  kind: z.enum(["regular", "supplemental"]),
  supplementalReason: z.string(),
  classSelections: z.array(z.object({ id: z.string().min(1), label: z.string().min(1) })),
  classSearch: z.string(),
  classPage: z.number().int().positive(),
  runValues: z.object({
    session: z.record(z.string(), z.string()),
    classes: z.record(z.string(), z.record(z.string(), z.string())),
  }),
}).superRefine((value, context) => {
  if (value.kind === "supplemental" && !value.supplementalReason.trim()) {
    context.addIssue({ code: "custom", path: ["supplementalReason"], message: "Explain why this supplemental charge is required." });
  }
  const amounts = [
    ...Object.entries(value.runValues.session).map(([slug, amount]) => ({
      path: ["runValues", "session", slug],
      amount,
    })),
    ...Object.entries(value.runValues.classes).flatMap(
      ([classId, classValues]) =>
        Object.entries(classValues).map(([slug, amount]) => ({
          path: ["runValues", "classes", classId, slug],
          amount,
        })),
    ),
  ];
  for (const { path, amount } of amounts) {
    if (!amount.trim()) continue;
    try {
      // Draft validation is currency-independent; exact exponent validation is
      // repeated beside the currency-aware input before preview submission.
      if (!DECIMAL_MAJOR.test(amount)) throw new Error("Enter a non-negative plain decimal amount.");
    } catch (error) {
      context.addIssue({ code: "custom", path, message: error instanceof Error ? error.message : "Enter an exact amount." });
    }
  }
});

export type BillingReviewState = {
  draft: BillingDraftSnapshot;
  reviewedHash: string | null;
  confirmationRequired: boolean;
  staleMessage: string | null;
};

/** A stale post response invalidates only the review. The user's draft remains
 * intact so they can preview the same command and explicitly confirm again. */
export function retainDraftAfterStaleReview(
  state: BillingReviewState,
  message = "The finance configuration changed. Preview and confirm again.",
): BillingReviewState {
  return {
    ...state,
    reviewedHash: null,
    confirmationRequired: false,
    staleMessage: message,
  };
}

export function visibleFinanceActions(input: {
  registered: boolean;
  canManualBill: boolean;
  canPayment: boolean;
  canAdjustment: boolean;
  canRefund: boolean;
  canReverse: boolean;
  canRead: boolean;
}): FinanceAction[] {
  const actions: FinanceAction[] = [];
  if (input.registered && input.canManualBill) actions.push("manual_bill");
  if (input.canPayment) actions.push("payment");
  if (input.canAdjustment) actions.push("adjustment");
  if (input.canRefund) actions.push("refund");
  if (input.canReverse) actions.push("reversal");
  if (input.canRead) actions.push("statement");
  return actions;
}
