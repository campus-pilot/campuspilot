import type { FinanceRecurring } from "@campuspilot/db/schema/jsonb/finance-config";

export type BillingPeriod = {
  cadence: FinanceRecurring;
  key: string;
  startDate: string;
  endDate: string;
  startAt: Date;
  endAt: Date;
  timeZone: string;
};

type CivilDate = { year: number; month: number; day: number };

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseCivilDate(value: string): CivilDate {
  const match = DATE_PATTERN.exec(value);
  if (!match) throw new Error("Billing date must use YYYY-MM-DD.");
  const date = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
  const roundTrip = new Date(
    Date.UTC(date.year, date.month - 1, date.day),
  );
  if (
    roundTrip.getUTCFullYear() !== date.year ||
    roundTrip.getUTCMonth() + 1 !== date.month ||
    roundTrip.getUTCDate() !== date.day
  ) {
    throw new Error("Billing date must be a real calendar date.");
  }
  return date;
}

export function isValidLocalDate(value: string): boolean {
  try {
    parseCivilDate(value);
    return true;
  } catch {
    return false;
  }
}

/** Resolves an explicit local civil date using the configured billing zone. */
export function localDateToInstant(value: string, timeZone: string): Date {
  return localMidnightToInstant(parseCivilDate(value), timeZone);
}

function startOfMonth(year: number, month: number): CivilDate {
  const normalized = new Date(Date.UTC(year, month - 1, 1));
  return {
    year: normalized.getUTCFullYear(),
    month: normalized.getUTCMonth() + 1,
    day: 1,
  };
}

function addMonths(date: CivilDate, months: number): CivilDate {
  return startOfMonth(date.year, date.month + months);
}

function formatDate(date: CivilDate): string {
  return `${String(date.year).padStart(4, "0")}-${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")}`;
}

function localParts(instant: Date, timeZone: string): CivilDate & {
  hour: number;
  minute: number;
  second: number;
} {
  const values: Record<string, number> = {};
  for (const part of new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant)) {
    if (part.type !== "literal") values[part.type] = Number(part.value);
  }
  return {
    year: values.year!,
    month: values.month!,
    day: values.day!,
    hour: values.hour!,
    minute: values.minute!,
    second: values.second!,
  };
}

function compareLocal(
  left: ReturnType<typeof localParts>,
  right: ReturnType<typeof localParts>,
): number {
  const keys = ["year", "month", "day", "hour", "minute", "second"] as const;
  for (const key of keys) {
    if (left[key] !== right[key]) return left[key] - right[key];
  }
  return 0;
}

/**
 * Converts a local midnight independently. Searching the bounded range avoids
 * assuming a fixed UTC offset. If midnight repeats the earliest matching
 * instant wins; if it falls in a gap the first later local instant wins.
 */
export function localMidnightToInstant(
  date: CivilDate,
  timeZone: string,
): Date {
  const target = { ...date, hour: 0, minute: 0, second: 0 };
  const approximate = Date.UTC(date.year, date.month - 1, date.day);
  const lower = approximate - 18 * 60 * 60 * 1000;
  const upper = approximate + 18 * 60 * 60 * 1000;
  let firstLater: Date | null = null;

  // Time-zone transitions are minute aligned in the supported IANA data for
  // modern school sessions. A second pass preserves exact seconds at the edge.
  for (let instant = lower; instant <= upper; instant += 60_000) {
    const candidate = new Date(instant);
    const parts = localParts(candidate, timeZone);
    const comparison = compareLocal(parts, target);
    if (comparison === 0) return candidate;
    if (comparison > 0 && firstLater === null) firstLater = candidate;
  }
  if (firstLater) return firstLater;
  throw new Error(`Unable to resolve local midnight in ${timeZone}.`);
}

/** Calculates approved local half-open monthly, anchored-quarterly or yearly periods. */
export function calculateBillingPeriod(input: {
  billingDate: string;
  cadence: FinanceRecurring;
  cycleStartMonth: number;
  timeZone: string;
}): BillingPeriod {
  const target = parseCivilDate(input.billingDate);
  if (!Number.isInteger(input.cycleStartMonth) || input.cycleStartMonth < 1 || input.cycleStartMonth > 12) {
    throw new Error("Cycle start month must be between 1 and 12.");
  }
  // Validate the zone even when the boundary happens to be UTC-compatible.
  new Intl.DateTimeFormat("en", { timeZone: input.timeZone }).format();

  let start: CivilDate;
  let months: number;
  if (input.cadence === "monthly") {
    start = startOfMonth(target.year, target.month);
    months = 1;
  } else {
    const absoluteTarget = target.year * 12 + (target.month - 1);
    const anchor = target.year * 12 + (input.cycleStartMonth - 1);
    const width = input.cadence === "quarterly" ? 3 : 12;
    const steps = Math.floor((absoluteTarget - anchor) / width);
    const startAbsolute = anchor + steps * width;
    start = startOfMonth(
      Math.floor(startAbsolute / 12),
      (startAbsolute % 12) + 1,
    );
    months = width;
  }
  const end = addMonths(start, months);
  const startDate = formatDate(start);
  const endDate = formatDate(end);
  return {
    cadence: input.cadence,
    key: `${input.cadence}:${startDate.slice(0, 7)}`,
    startDate,
    endDate,
    startAt: localMidnightToInstant(start, input.timeZone),
    endAt: localMidnightToInstant(end, input.timeZone),
    timeZone: input.timeZone,
  };
}
