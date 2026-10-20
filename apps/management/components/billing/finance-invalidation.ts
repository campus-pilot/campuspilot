import type { QueryClient } from "@tanstack/react-query";
import { financeInvalidationTargets, type FinanceMutationKind, type FinanceQueryTarget } from "@campuspilot/components/finance";
import { orpc } from "@/lib/orpc";

/** Invalidates each finance read model affected by an immutable posting. Route
 * keys intentionally cover every pagination and filter variant of that model. */
export async function invalidateFinanceReadModels(
  queryClient: QueryClient,
  mutationKind: FinanceMutationKind,
) {
  const targets = new Set(financeInvalidationTargets(mutationKind));
  const invalidations: Promise<unknown>[] = [];
  const invalidate = (target: FinanceQueryTarget, queryKey: readonly unknown[]) => {
    if (targets.has(target)) invalidations.push(queryClient.invalidateQueries({ queryKey }));
  };

  invalidate("overview", orpc.school.getSessionFinanceOverview.key());
  invalidate("runs", orpc.school.listBillingRuns.key());
  invalidate("run_detail", orpc.school.getBillingRun.key());
  invalidate("payments", orpc.school.listPayments.key());
  invalidate("payment_detail", orpc.school.getPayment.key());
  invalidate("ledger", orpc.school.getAdmissionLedger.key());
  invalidate("summary", orpc.school.getAdmissionFinanceSummary.key());
  invalidate("bills", orpc.school.listAdmissionBills.key());
  invalidate("bill_detail", orpc.school.getAdmissionBill.key());
  if (targets.has("reports")) {
    invalidations.push(
      queryClient.invalidateQueries({ queryKey: orpc.school.getCollectionRegister.key() }),
      queryClient.invalidateQueries({ queryKey: orpc.school.getFeeElementFinanceReport.key() }),
      queryClient.invalidateQueries({ queryKey: orpc.school.getClassFinanceSnapshot.key() }),
    );
  }
  await Promise.all(invalidations);
}
