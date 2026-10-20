import { describe, expect, it } from "vitest";

import {
  createStatementFormSchema,
  getStatementDateBounds,
  isReadyStatementSession,
  type StatementReadySession,
  type StatementSession,
} from "./statement-session";

const readySession: StatementReadySession = {
  id: "session",
  label: "2026-2027",
  status: "ready",
  currency: "INR",
  timeZone: "Asia/Kolkata",
  startYear: 2026,
  endYear: 2027,
  cycleStartMonth: 4,
};

describe("statement session readiness", () => {
  it("requires the explicit ready state", () => {
    const incomplete: StatementSession = {
      id: "session",
      label: "2026-2027",
      status: "incomplete",
      missingFields: ["cycleStartMonth"],
    };

    expect(isReadyStatementSession(readySession)).toBe(true);
    expect(isReadyStatementSession(incomplete)).toBe(false);
    expect(isReadyStatementSession(undefined)).toBe(false);
  });
});

describe("statement date bounds", () => {
  it("uses the cycle anchor as an inclusive start and exclusive end", () => {
    expect(getStatementDateBounds(readySession, "2026-10-21")).toEqual({
      minDate: "2026-04-01",
      endDateExclusive: "2027-04-01",
      maxDate: "2026-10-21",
      defaultDate: "2026-10-21",
      hasValidDate: true,
    });
  });

  it("clamps a completed session to the day before its exclusive end", () => {
    expect(getStatementDateBounds(readySession, "2028-01-10")).toMatchObject({
      maxDate: "2027-03-31",
      defaultDate: "2027-03-31",
      hasValidDate: true,
    });
  });

  it("reports no valid date before the session starts", () => {
    expect(getStatementDateBounds(readySession, "2026-03-31")).toMatchObject({
      minDate: "2026-04-01",
      maxDate: "2026-03-31",
      defaultDate: "",
      hasValidDate: false,
    });
  });
});

describe("statement form validation", () => {
  const schema = createStatementFormSchema(
    [readySession],
    () => "2026-10-21",
  );

  it("accepts dates within the selected session and current local date", () => {
    expect(
      schema.safeParse({ sessionId: "session", throughDate: "2026-10-21" })
        .success,
    ).toBe(true);
  });

  it.each(["2026-03-31", "2026-10-22", "2027-04-01"])(
    "rejects the out-of-range date %s",
    (throughDate) => {
      expect(schema.safeParse({ sessionId: "session", throughDate }).success).toBe(
        false,
      );
    },
  );

  it("rejects a session that has not explicitly passed readiness", () => {
    const schemaWithIncompleteSession = createStatementFormSchema(
      [
        {
          id: "session",
          label: "2026-2027",
          status: "incomplete",
          missingFields: [],
        },
      ],
      () => "2026-10-21",
    );

    expect(
      schemaWithIncompleteSession.safeParse({
        sessionId: "session",
        throughDate: "2026-10-21",
      }).success,
    ).toBe(false);
  });
});
