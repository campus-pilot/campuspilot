import { describe, expect, it } from "vitest";
import {
  calculatePercentageMinor,
  decimalToMinor,
  formatMinor,
  formatBasisPoints,
  retainDraftAfterStaleReview,
  visibleFinanceActions,
  financeBillingDraftSchema,
  civilDateInTimeZone,
  civilDateTimeInTimeZone,
  idempotencyForDraft,
  markIdempotencyAmbiguous,
  resolveIdempotencyAudit,
  requestDirtyClose,
  clearSelectionForScope,
  instantFromCivilDateTime,
  financeScopeIds,
  financeAmountError,
  financeDateTimeError,
  formatFinanceInstant,
  requiresExplicitCreditConfirmation,
  reversalActionForEntry,
  updateExplicitAllocation,
  adjustmentTargetFields,
  groupFinanceIssues,
  paymentDeepLinkTarget,
} from "./finance-model";

describe("finance presentation model", () => {
  it("converts and formats money without floating-point loss", () => {
    expect(decimalToMinor("90071992547409.91", "INR")).toBe("9007199254740991");
    expect(formatMinor("9007199254740991", "INR")).toBe("INR 90,071,992,547,409.91");
    expect(decimalToMinor("0", "INR")).toBe("0");
    expect(formatBasisPoints("1234")).toBe("12.34%");
    expect(() => decimalToMinor("1.001", "INR")).toThrow();
  });

  it("uses the reviewed currency exponent catalog", () => {
    expect(decimalToMinor("123", "JPY")).toBe("123");
    expect(formatMinor("123", "JPY")).toBe("JPY 123");
    expect(decimalToMinor("1.234", "KWD")).toBe("1234");
    expect(formatMinor("1234", "BHD")).toBe("BHD 1.234");
    expect(decimalToMinor("1.2345", "CLF")).toBe("12345");
    expect(formatMinor("12345", "CLF")).toBe("CLF 1.2345");
  });

  it("previews percentages with the same half-up integer rule as the server", () => {
    expect(calculatePercentageMinor("105", "10")).toBe("11");
    expect(calculatePercentageMinor("999", "12.5")).toBe("125");
    expect(() => calculatePercentageMinor("100", "0")).toThrow();
  });

  it("retains a draft while invalidating a stale confirmation", () => {
    const draft = { billingDate: "2026-10-20", kind: "regular" as const, supplementalReason: "", sessionValues: { exam: "12500" } };
    const next = retainDraftAfterStaleReview({ draft, reviewedHash: "hash", confirmationRequired: true, staleMessage: null });
    expect(next.draft).toBe(draft);
    expect(next.reviewedHash).toBeNull();
    expect(next.confirmationRequired).toBe(false);
  });

  it("keeps lifecycle and permissions as independent action facts", () => {
    expect(visibleFinanceActions({ registered: false, canManualBill: true, canPayment: true, canAdjustment: true, canRefund: true, canReverse: true, canRead: true }))
      .toEqual(["payment", "adjustment", "refund", "reversal", "statement"]);
    expect(visibleFinanceActions({ registered: true, canManualBill: false, canPayment: false, canAdjustment: false, canRefund: false, canReverse: false, canRead: true }))
      .toEqual(["statement"]);
  });

  it("validates supplemental reasons while preserving blank versus zero run values", () => {
    const base = { billingDate: "2026-10-20", classSelections: [], classSearch: "", classPage: 1, runValues: { session: { transport: "", tuition: "0" }, classes: { "class-1": { lab: "125.50" } } } };
    expect(financeBillingDraftSchema.safeParse({ ...base, kind: "regular", supplementalReason: "" }).success).toBe(true);
    expect(financeBillingDraftSchema.safeParse({ ...base, kind: "supplemental", supplementalReason: "" }).success).toBe(false);
    expect(financeBillingDraftSchema.safeParse({ ...base, kind: "supplemental", supplementalReason: "Correction" }).success).toBe(true);
    expect(financeBillingDraftSchema.safeParse({ ...base, kind: "regular", supplementalReason: "", runValues: { ...base.runValues, classes: { "class-1": { lab: "invalid" } } } }).success).toBe(false);
  });

  it("derives defaults from the configured civil timezone", () => {
    const instant = new Date("2026-01-01T00:15:00.000Z");
    expect(civilDateInTimeZone("America/Los_Angeles", instant)).toBe("2025-12-31");
    expect(civilDateTimeInTimeZone("Asia/Kolkata", instant)).toBe("2026-01-01T05:45");
    expect(instantFromCivilDateTime("2026-01-01T05:45", "Asia/Kolkata").toISOString()).toBe("2026-01-01T00:15:00.000Z");
  });

  it("retains one idempotency key for unchanged and ambiguous drafts", () => {
    let count = 0;
    const createKey = () => `key-${++count}`;
    const first = idempotencyForDraft(undefined, "draft-a", createKey);
    const retry = idempotencyForDraft(markIdempotencyAmbiguous(first), "draft-a", createKey);
    expect(retry).toEqual({ fingerprint: "draft-a", key: "key-1", ambiguous: true });
    expect(resolveIdempotencyAudit(retry, false)).toEqual({ fingerprint: "draft-a", key: "key-1", ambiguous: false });
    expect(idempotencyForDraft(retry, "draft-b", createKey).key).toBe("key-2");
    expect(resolveIdempotencyAudit(retry, true)).toBeUndefined();
  });

  it("models dirty close confirmation and stale scope selection", () => {
    expect(requestDirtyClose({ dirty: true, confirmationOpen: false }).confirmationOpen).toBe(true);
    expect(requestDirtyClose({ dirty: false, confirmationOpen: false }).confirmationOpen).toBe(false);
    expect(clearSelectionForScope("entry-1", true)).toBeUndefined();
    expect(clearSelectionForScope("entry-1", false)).toBe("entry-1");
  });

  it("maps named scope selections without exposing duplicate IDs", () => {
    expect(financeScopeIds([])).toBeUndefined();
    expect(financeScopeIds([{ id: "class-1", label: "Grade 1" }, { id: "class-1", label: "Grade 1" }, { id: "class-2", label: "Grade 2" }])).toEqual(["class-1", "class-2"]);
  });

  it("keeps currency and civil-time validation adjacent and non-throwing", () => {
    expect(financeAmountError("1.001", "INR")).toBe("INR accepts at most 2 decimal places.");
    expect(financeAmountError("1.234", "KWD")).toBeUndefined();
    expect(financeDateTimeError("not-a-date", "Asia/Kolkata")).toBe("Choose a valid local date and time.");
    expect(formatFinanceInstant("2026-01-01T00:15:00.000Z", "Asia/Kolkata")).toContain("5:45");
  });

  it("models multi-bill allocation, overpayment confirmation, and reversal routing", () => {
    const first = updateExplicitAllocation([], "bill-a", "10.00");
    const second = updateExplicitAllocation(first, "bill-b", "20.00");
    expect(second).toEqual([{ billId: "bill-a", amount: "10.00" }, { billId: "bill-b", amount: "20.00" }]);
    expect(updateExplicitAllocation(second, "bill-a", undefined)).toEqual([{ billId: "bill-b", amount: "20.00" }]);
    expect(requiresExplicitCreditConfirmation("1")).toBe(true);
    expect(requiresExplicitCreditConfirmation("0")).toBe(false);
    expect(reversalActionForEntry("bill")).toBe("bill");
    expect(reversalActionForEntry("credit_correction")).toBe("ledger_entry");
  });

  it("models account corrections, configuration issue groups, and payment deep links", () => {
    expect(adjustmentTargetFields({ kind: "credit_correction", target: "account" })).toEqual({});
    expect(adjustmentTargetFields({ kind: "discount", target: "bill", billId: "bill-1", billLineId: "line-1" })).toEqual({ billId: "bill-1", billLineId: "line-1" });
    expect(() => adjustmentTargetFields({ kind: "discount", target: "account" })).toThrow();
    expect(groupFinanceIssues([{ scope: "configuration" as const, code: "missing" }, { scope: "admission" as const, code: "skipped" }]).map(({ scope }) => scope)).toEqual(["configuration", "admission"]);
    expect(paymentDeepLinkTarget("payment-1", "admission-1")).toEqual({ id: "payment-1", admissionId: "admission-1" });
    expect(paymentDeepLinkTarget("payment-1", undefined)).toEqual({ id: "payment-1", admissionId: undefined });
  });
});
