export type FinanceMutationKind =
  | "billing_run"
  | "manual_bill"
  | "payment"
  | "adjustment"
  | "refund"
  | "reversal";

export type FinanceQueryTarget =
  | "overview"
  | "runs"
  | "run_detail"
  | "payments"
  | "payment_detail"
  | "ledger"
  | "summary"
  | "bills"
  | "bill_detail"
  | "reports";

/** Lists all read models invalidated after an immutable finance posting. */
export function financeInvalidationTargets(kind: FinanceMutationKind): FinanceQueryTarget[] {
  const common: FinanceQueryTarget[] = ["overview", "ledger", "summary", "reports"];
  if (kind === "billing_run") return [...common, "runs", "run_detail", "bills", "bill_detail"];
  if (kind === "manual_bill") return [...common, "bills", "bill_detail"];
  if (kind === "payment" || kind === "refund") return [...common, "payments", "payment_detail", "bills", "bill_detail"];
  if (kind === "adjustment") return [...common, "bills", "bill_detail"];
  return [...common, "runs", "run_detail", "payments", "payment_detail", "bills", "bill_detail"];
}

export function financeQueryScope(schoolId: string, sessionId?: string, admissionId?: string) {
  return ["finance", schoolId, sessionId ?? "all-sessions", admissionId ?? "all-admissions"] as const;
}
