import { describe, expect, it } from "vitest";

import type { FinanceElement } from "@campuspilot/db/schema/jsonb/finance-config";
import {
  resolveBillingPrice,
  snapshotBillingPriceResolution,
  validateBillingConfiguration,
  type BillingPricingContext,
} from "./pricing";

const ordinary: FinanceElement = {
  name: "Tuition",
  scopes: ["school", "class", "student"],
  requiredAtLevel: "class",
  defaultAmountMinor: 100,
};

function context(
  overrides: Partial<BillingPricingContext> = {},
): BillingPricingContext {
  return {
    sessionId: "session-1",
    admissionId: "admission-1",
    classId: "class-1",
    classSlug: "one",
    admissionValues: {},
    classOverrides: {},
    runSessionValues: {},
    runClassValues: {},
    ...overrides,
  };
}

describe("finance pricing resolver", () => {
  it.each([
    {
      name: "admission before class and session",
      context: context({
        admissionValues: { tuition: 0 },
        classOverrides: { one: { tuition: 200 } },
      }),
      source: "admission",
      amount: 0n,
    },
    {
      name: "class before session",
      context: context({ classOverrides: { one: { tuition: 200 } } }),
      source: "class",
      amount: 200n,
    },
    {
      name: "session base",
      context: context(),
      source: "session",
      amount: 100n,
    },
  ])("resolves $name and preserves exact zero", ({ context: value, source, amount }) => {
    const result = resolveBillingPrice("tuition", ordinary, value);
    expect(result).toMatchObject({ sourceKind: source, amountMinor: amount });
    expect(result?.sourceSnapshot.amountMinor).toBe(amount.toString(10));
  });

  it("keeps blank distinct from zero", () => {
    const noFallback = { ...ordinary, defaultAmountMinor: undefined };
    expect(resolveBillingPrice("tuition", noFallback, context())).toBeNull();
    expect(
      resolveBillingPrice(
        "tuition",
        noFallback,
        context({ admissionValues: { tuition: 0 } }),
      )?.amountMinor,
    ).toBe(0n);
  });

  it.each([
    [
      "admission",
      context({
        admissionValues: { transport: 10 },
        runClassValues: { "class-1": { transport: "20" } },
        runSessionValues: { transport: "30" },
      }),
      10n,
    ],
    [
      "run_class",
      context({
        runClassValues: { "class-1": { transport: "0" } },
        runSessionValues: { transport: "30" },
      }),
      0n,
    ],
    ["run_session", context({ runSessionValues: { transport: "30" } }), 30n],
    ["fallback", context(), 40n],
  ])("resolves bill-generation %s precedence", (source, value, amount) => {
    const element: FinanceElement = {
      name: "Transport",
      scopes: ["student"],
      requiredAtLevel: "bill_generation",
      defaultAmountMinor: 40,
    };
    expect(resolveBillingPrice("transport", element, value)).toMatchObject({
      sourceKind: source,
      amountMinor: amount,
    });
  });

  it("does not use an admission override when bill-generation admission scope is forbidden", () => {
    const element: FinanceElement = {
      name: "Activity",
      scopes: ["school"],
      requiredAtLevel: "bill_generation",
    };
    expect(
      resolveBillingPrice(
        "activity",
        element,
        context({
          admissionValues: { activity: 1 },
          runSessionValues: { activity: "2" },
        }),
      ),
    ).toMatchObject({ sourceKind: "run_session", amountMinor: 2n });
  });

  it("returns a complete immutable source snapshot for a resolved bill-generation value", () => {
    const element: FinanceElement = {
      name: "Activity",
      scopes: ["school"],
      requiredAtLevel: "bill_generation",
    };
    expect(
      resolveBillingPrice(
        "activity",
        element,
        context({ runSessionValues: { activity: "25" } }),
      )?.sourceSnapshot,
    ).toEqual({
      kind: "run_session",
      key: "session-1:activity",
      amountMinor: "25",
    });
  });

  it("keeps unresolved bill-generation candidates explicit instead of inventing a source", () => {
    const element: FinanceElement = {
      name: "Activity",
      scopes: ["school"],
      requiredAtLevel: "bill_generation",
    };
    const value = context();
    expect(resolveBillingPrice("activity", element, value)).toBeNull();
    expect(snapshotBillingPriceResolution("activity", element, value)).toEqual({
      elementSlug: "activity",
      requiredAtLevel: "bill_generation",
      allowedScopes: ["school"],
      candidates: {
        admission: null,
        class: null,
        runClass: null,
        runSession: null,
        fallback: null,
      },
    });
  });

  it("reports incomplete migrated configuration without inferring missing facts", () => {
    const result = validateBillingConfiguration({
      recurring: "monthly",
      elements: {},
      currency: "INR",
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.issues.map(({ path }) => path)).toEqual(
        expect.arrayContaining(["timeZone", "cycleStartMonth"]),
      );
    }
  });
});
