import { z } from "zod";

export type StatementReadySession = {
  id: string;
  label: string;
  status: "ready";
  currency: string;
  timeZone: string;
  startYear: number;
  endYear: number;
  cycleStartMonth: number;
};

export type StatementSession =
  | StatementReadySession
  | { id: string; label: string; status: "checking" }
  | {
      id: string;
      label: string;
      status: "error";
      error: unknown;
      retrying: boolean;
      retry: () => unknown;
    }
  | {
      id: string;
      label: string;
      status: "incomplete";
      missingFields: string[];
    };

/** Readiness is explicit: no combination of currently correlated finance
 * fields is treated as proof that the session passed server readiness checks. */
export function isReadyStatementSession(
  session: StatementSession | undefined,
): session is StatementReadySession {
  return session?.status === "ready";
}

/** Returns today's civil date in the configured finance time zone. */
export function currentDateInTimeZone(timeZone: string, now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  return `${value.year}-${value.month}-${value.day}`;
}

function previousDate(value: string) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

export type StatementDateBounds = {
  minDate: string;
  endDateExclusive: string;
  maxDate: string;
  defaultDate: string;
  hasValidDate: boolean;
};

/** Mirrors the server's session boundary contract: the cycle anchor is
 * inclusive in the start year and exclusive in the end year, while future
 * local dates are unavailable. */
export function getStatementDateBounds(
  session: StatementReadySession,
  today = currentDateInTimeZone(session.timeZone),
): StatementDateBounds {
  const month = String(session.cycleStartMonth).padStart(2, "0");
  const minDate = `${session.startYear}-${month}-01`;
  const endDateExclusive = `${session.endYear}-${month}-01`;
  const sessionMaxDate = previousDate(endDateExclusive);
  const maxDate = today < sessionMaxDate ? today : sessionMaxDate;
  const hasValidDate = minDate <= maxDate;
  const defaultDate = !hasValidDate
    ? ""
    : today < minDate
      ? minDate
      : today > maxDate
        ? maxDate
        : today;
  return { minDate, endDateExclusive, maxDate, defaultDate, hasValidDate };
}

type TodayForTimeZone = (timeZone: string) => string;

/** Builds validation from the selected session rather than assuming that all
 * sessions share dates, cycle anchors, or time zones. */
export function createStatementFormSchema(
  sessions: StatementSession[],
  todayForTimeZone: TodayForTimeZone = currentDateInTimeZone,
) {
  return z
    .object({
      sessionId: z.string().min(1, "Choose a session."),
      throughDate: z.string().date("Choose a valid statement date."),
    })
    .superRefine((values, context) => {
      const session = sessions.find((item) => item.id === values.sessionId);
      if (!isReadyStatementSession(session)) {
        context.addIssue({
          code: "custom",
          path: ["sessionId"],
          message:
            "Complete this session's finance settings before generating a statement.",
        });
        return;
      }
      const bounds = getStatementDateBounds(
        session,
        todayForTimeZone(session.timeZone),
      );
      if (!bounds.hasValidDate) {
        context.addIssue({
          code: "custom",
          path: ["throughDate"],
          message: "Statements are not available before this session starts.",
        });
        return;
      }
      if (
        values.throughDate < bounds.minDate ||
        values.throughDate > bounds.maxDate
      ) {
        context.addIssue({
          code: "custom",
          path: ["throughDate"],
          message: `Choose a date from ${bounds.minDate} through ${bounds.maxDate}.`,
        });
      }
    });
}
