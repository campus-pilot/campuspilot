import { describe, expect, it } from "vitest";

import { calculateBillingPeriod } from "../billing/period";
import { documentBillingPeriod, documentDateParts, optionalDocumentMoney } from "./finance-document.values";

/** The date and period values of bills and Bills due (docs/document-system.md "Bill due"). */
describe("finance document values", () => {
  it("passes a date as parts, never shifted by a time zone", () => {
    expect(documentDateParts("2026-11-05")).toEqual({ iso: "2026-11-05", day: "05", month: "11", year: "2026", monthName: "November" });
    expect(() => documentDateParts("2026-13-01")).toThrow();
  });

  it("prints a monthly Bill due period from the first to the last day of the month containing the date", () => {
    const period = calculateBillingPeriod({ billingDate: "2026-11-24", cadence: "monthly", cycleStartMonth: 4, timeZone: "Asia/Kolkata" });
    expect(documentBillingPeriod(period.cadence, period.startDate, period.endDate)).toMatchObject({
      cadence: "monthly",
      start: { iso: "2026-11-01" },
      end: { iso: "2026-11-30", day: "30" },
    });
  });

  it.each([
    ["2026-11-24", "2026-10-01", "2026-12-31"],
    ["2027-02-28", "2027-01-01", "2027-03-31"],
    ["2026-04-01", "2026-04-01", "2026-06-30"],
  ] as const)("anchors the quarter containing %s to the cycle start month", (date, start, end) => {
    const period = calculateBillingPeriod({ billingDate: date, cadence: "quarterly", cycleStartMonth: 4, timeZone: "Asia/Kolkata" });
    expect(documentBillingPeriod(period.cadence, period.startDate, period.endDate)).toMatchObject({ start: { iso: start }, end: { iso: end } });
  });

  it("hides zero optional amounts and keeps every other amount, negative ones included", () => {
    expect(optionalDocumentMoney(BigInt(0), "INR")).toBeNull();
    expect(optionalDocumentMoney(BigInt(80000), "INR")).toBe("800.00");
    expect(optionalDocumentMoney(BigInt(-500), "INR")).toBe("-5.00");
  });
});
