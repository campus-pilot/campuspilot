import { describe, expect, it } from "vitest";
import { financeSchemaConfigSchema } from "@campuspilot/db/schema/jsonb/finance-config";

import {
  parseDecimalAmountToMinor,
  parseDecimalAmountToSafeMinorNumber,
} from "./money";
import { currencyMinorUnitDigits } from "@campuspilot/db/schema/jsonb/currencies";
import {
  checkedFinanceAddition,
  parseFinanceInteger,
  serializeFinanceInteger,
  serializeProjectionTotals,
} from "./transport";

describe("exact finance money conversion", () => {
  it("converts two-, zero-, three-, and four-decimal currencies exactly", () => {
    expect(parseDecimalAmountToMinor("123.45", "INR")).toBe(12_345n);
    expect(parseDecimalAmountToMinor("123", "JPY")).toBe(123n);
    expect(parseDecimalAmountToMinor("1.234", "KWD")).toBe(1_234n);
    expect(parseDecimalAmountToMinor("1.2345", "CLF")).toBe(12_345n);
    expect(currencyMinorUnitDigits("INR")).toBe(2);
  });

  it("rejects floats, exponent notation, excessive precision, and overflow", () => {
    expect(() => parseDecimalAmountToMinor("1.001", "INR")).toThrow();
    expect(() => parseDecimalAmountToMinor("1e3", "INR")).toThrow();
    expect(() => parseDecimalAmountToMinor("-1", "INR")).toThrow();
    expect(() => parseDecimalAmountToMinor("1", "ZZZ")).toThrow();
    expect(() =>
      parseDecimalAmountToMinor("92233720368547758.08", "INR"),
    ).toThrow();
    expect(() =>
      parseDecimalAmountToSafeMinorNumber("90071992547410", "INR"),
    ).toThrow();
  });

  it("requires exact minor-unit configuration and explicit period facts", () => {
    const valid = {
      recurring: "monthly" as const,
      currency: "INR",
      timeZone: "Asia/Kolkata",
      cycleStartMonth: 4,
      elements: {
        tuition: {
          name: "Tuition",
          scopes: ["school" as const],
          requiredAtLevel: "school" as const,
          defaultAmountMinor: 125_050,
        },
      },
    };

    expect(financeSchemaConfigSchema.parse(valid)).toEqual(valid);
    expect(
      financeSchemaConfigSchema.safeParse({
        ...valid,
        timeZone: "not/a-timezone",
      }).success,
    ).toBe(false);
    expect(
      financeSchemaConfigSchema.safeParse({
        ...valid,
        cycleStartMonth: 0,
      }).success,
    ).toBe(false);
    expect(
      financeSchemaConfigSchema.safeParse({
        ...valid,
        elements: {
          tuition: {
            ...valid.elements.tuition,
            defaultAmountMinor: 12.5,
          },
        },
      }).success,
    ).toBe(false);
    expect(
      financeSchemaConfigSchema.safeParse({
        ...valid,
        elements: {
          tuition: {
            ...valid.elements.tuition,
            scopes: ["class"],
          },
        },
      }).success,
    ).toBe(false);
  });

  it("serializes operational bigints as lossless JSON-safe decimal strings", () => {
    const amount = 9_223_372_036_854_775_807n;
    expect(serializeFinanceInteger(amount)).toBe("9223372036854775807");
    expect(parseFinanceInteger("9223372036854775807")).toBe(amount);
    expect(() => parseFinanceInteger("1.5")).toThrow();
    expect(() => serializeFinanceInteger(-1n)).toThrow();
    expect(
      serializeProjectionTotals({
        lastSequence: 2n,
        entryCount: 2n,
        debitTotalMinor: amount,
        creditTotalMinor: 1n,
      }),
    ).toEqual({
      lastSequence: "2",
      entryCount: "2",
      debitTotalMinor: "9223372036854775807",
      creditTotalMinor: "1",
    });
  });

  it("checks aggregate addition at the PostgreSQL bigint boundary", () => {
    expect(
      checkedFinanceAddition(BigInt("9223372036854775806"), BigInt(1)),
    ).toBe(BigInt("9223372036854775807"));
    expect(() =>
      checkedFinanceAddition(BigInt("9223372036854775807"), BigInt(1)),
    ).toThrow("PostgreSQL bigint range");
    expect(
      serializeProjectionTotals({
        lastSequence: BigInt(2),
        entryCount: BigInt(2),
        debitTotalMinor: BigInt("9223372036854775808"),
        creditTotalMinor: BigInt(0),
      }).debitTotalMinor,
    ).toBe("9223372036854775808");
  });
});
