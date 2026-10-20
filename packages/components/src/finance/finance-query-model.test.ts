import { describe, expect, it } from "vitest";
import { financeInvalidationTargets, financeQueryScope } from "./finance-query-model";

describe("finance query model", () => {
  it("uses independent scope facts in stable query keys", () => {
    expect(financeQueryScope("school-1", "session-2", "admission-3")).toEqual(["finance", "school-1", "session-2", "admission-3"]);
    expect(financeQueryScope("school-1")).toEqual(["finance", "school-1", "all-sessions", "all-admissions"]);
  });

  it("invalidates every affected read model after payment posting", () => {
    expect(financeInvalidationTargets("payment")).toEqual(["overview", "ledger", "summary", "reports", "payments", "payment_detail", "bills", "bill_detail"]);
  });

  it("invalidates every operational view after a reversal", () => {
    expect(financeInvalidationTargets("reversal")).toEqual(["overview", "ledger", "summary", "reports", "runs", "run_detail", "payments", "payment_detail", "bills", "bill_detail"]);
  });
});
