import { describe, expect, it } from "vitest";

import { calculateBillingPeriod } from "./period";

describe("billing periods", () => {
  it("uses calendar months regardless of the cycle anchor", () => {
    const period = calculateBillingPeriod({
      billingDate: "2026-01-31",
      cadence: "monthly",
      cycleStartMonth: 4,
      timeZone: "Asia/Kolkata",
    });
    expect(period).toMatchObject({
      key: "monthly:2026-01",
      startDate: "2026-01-01",
      endDate: "2026-02-01",
    });
    expect(period.startAt.toISOString()).toBe("2025-12-31T18:30:00.000Z");
    expect(period.endAt.toISOString()).toBe("2026-01-31T18:30:00.000Z");
  });

  it.each([
    ["2026-03-31", "quarterly:2026-01", "2026-01-01", "2026-04-01"],
    ["2026-04-01", "quarterly:2026-04", "2026-04-01", "2026-07-01"],
    ["2027-02-10", "quarterly:2027-01", "2027-01-01", "2027-04-01"],
  ] as const)("anchors quarter containing %s", (billingDate, key, startDate, endDate) => {
    expect(
      calculateBillingPeriod({
        billingDate,
        cadence: "quarterly",
        cycleStartMonth: 4,
        timeZone: "UTC",
      }),
    ).toMatchObject({ key, startDate, endDate });
  });

  it("anchors yearly periods across calendar years", () => {
    expect(
      calculateBillingPeriod({
        billingDate: "2026-02-01",
        cadence: "yearly",
        cycleStartMonth: 4,
        timeZone: "UTC",
      }),
    ).toMatchObject({
      key: "yearly:2025-04",
      startDate: "2025-04-01",
      endDate: "2026-04-01",
    });
  });

  it("converts each DST boundary independently instead of adding a fixed duration", () => {
    const period = calculateBillingPeriod({
      billingDate: "2026-03-15",
      cadence: "monthly",
      cycleStartMonth: 1,
      timeZone: "America/New_York",
    });
    expect(period.startAt.toISOString()).toBe("2026-03-01T05:00:00.000Z");
    expect(period.endAt.toISOString()).toBe("2026-04-01T04:00:00.000Z");
    expect(period.endAt.getTime() - period.startAt.getTime()).toBe(
      31 * 86_400_000 - 3_600_000,
    );
  });

  it("rejects impossible dates and invalid zones", () => {
    expect(() =>
      calculateBillingPeriod({
        billingDate: "2026-02-30",
        cadence: "monthly",
        cycleStartMonth: 1,
        timeZone: "UTC",
      }),
    ).toThrow("real calendar date");
    expect(() =>
      calculateBillingPeriod({
        billingDate: "2026-02-01",
        cadence: "monthly",
        cycleStartMonth: 1,
        timeZone: "Not/A_Zone",
      }),
    ).toThrow();
  });
});
