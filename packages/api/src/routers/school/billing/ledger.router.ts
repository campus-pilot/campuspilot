import { SCHOOL_ACTIONS } from "@campuspilot/opa/policies/school";

import { toRpcError } from "../../../errors";
import { protectedProcedure } from "../../../index";
import { requireSchoolPermission } from "../../../permissions/school";
import {
  adjustmentOutputSchema,
  admissionBillListOutputSchema,
  admissionBillOutputSchema,
  admissionFinanceSummaryOutputSchema,
  admissionLedgerOutputSchema,
  getAdmissionBillInputSchema,
  getAdmissionFinanceSummaryInputSchema,
  getAdmissionLedgerInputSchema,
  getPaymentInputSchema,
  listAdmissionBillsInputSchema,
  listPaymentsInputSchema,
  paymentListOutputSchema,
  paymentOutputSchema,
  recordAdjustmentInputSchema,
  recordPaymentInputSchema,
  recordRefundInputSchema,
  recordedPaymentOutputSchema,
  reconcileAdmissionProjectionInputSchema,
  reconciliationOutputSchema,
  refundRecordOutputSchema,
  reversalOutputSchema,
  reverseLedgerEntryInputSchema,
} from "./ledger.dto";
import {
  recordAdjustment,
  recordPayment,
  recordRefund,
  reverseLedgerEntry,
} from "./ledger-posting-operations";
import {
  assertAdmissionContext,
  getAdmissionBill,
  getAdmissionFinanceSummary,
  getAdmissionLedger,
  getPayment,
  listAdmissionBills,
  listPayments,
} from "./ledger-read";
import { reconcileAdmissionProjection } from "./reconciliation";

function financeHandler<TInput, TOutput>(callback: (input: TInput) => Promise<TOutput>) {
  return async ({ input }: { input: TInput }) => {
    try {
      return await callback(input);
    } catch (error) {
      throw toRpcError(error);
    }
  };
}

const route = (summary: string, description: string) => ({
  summary,
  description,
  tags: ["School", "Billing"],
});

export const ledgerOperationsRouter = {
  getAdmissionLedger: protectedProcedure
    .route(
      route(
        "Read an admission ledger",
        "List immutable ledger entries for one admission, optionally scoped to an academic session, with deterministic pagination and running balances.",
      ),
    )
    .input(getAdmissionLedgerInputSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.READ_ADMISSION_LEDGER))
    .output(admissionLedgerOutputSchema)
    .handler(({ context, input }) => financeHandler((value: typeof input) => getAdmissionLedger(context.db, value))({ input })),

  getAdmissionFinanceSummary: protectedProcedure
    .route(
      route(
        "Read an admission finance summary",
        "Read projected billed, paid, adjusted, refunded, due, and credit totals for one admission in either session or lifetime scope.",
      ),
    )
    .input(getAdmissionFinanceSummaryInputSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.READ_ADMISSION_LEDGER))
    .output(admissionFinanceSummaryOutputSchema)
    .handler(({ context, input }) => financeHandler((value: typeof input) => getAdmissionFinanceSummary(context.db, value))({ input })),

  reconcileAdmissionProjection: protectedProcedure
    .route(
      route(
        "Reconcile admission finance projections",
        "Compare one admission's stored finance projections with totals recomputed from its immutable ledger and report any mismatch without changing financial facts.",
      ),
    )
    .input(reconcileAdmissionProjectionInputSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.READ_BILLING_REPORTS))
    .output(reconciliationOutputSchema)
    .handler(async ({ context, input }) => {
      try {
        await assertAdmissionContext(context.db, input);
        return await reconcileAdmissionProjection(context.db, input);
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  listAdmissionBills: protectedProcedure
    .route(
      route(
        "List admission bills",
        "List immutable bills for one admission with explicit session and status filters, stable ordering, and pagination.",
      ),
    )
    .input(listAdmissionBillsInputSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.READ_ADMISSION_LEDGER))
    .output(admissionBillListOutputSchema)
    .handler(({ context, input }) => financeHandler((value: typeof input) => listAdmissionBills(context.db, value))({ input })),

  getAdmissionBill: protectedProcedure
    .route(
      route(
        "Read an immutable admission bill",
        "Read one tenant-scoped bill with its snapshotted lines, bill-specific adjustments, and reversal history.",
      ),
    )
    .input(getAdmissionBillInputSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.READ_ADMISSION_LEDGER))
    .output(admissionBillOutputSchema)
    .handler(({ context, input }) => financeHandler((value: typeof input) => getAdmissionBill(context.db, value))({ input })),

  listPayments: protectedProcedure
    .route(
      route(
        "List recorded payments",
        "List immutable payments for one admission with optional session filtering, stable ordering, and pagination.",
      ),
    )
    .input(listPaymentsInputSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.READ_ADMISSION_LEDGER))
    .output(paymentListOutputSchema)
    .handler(({ context, input }) => financeHandler((value: typeof input) => listPayments(context.db, value))({ input })),

  getPayment: protectedProcedure
    .route(
      route(
        "Read an immutable payment",
        "Read one tenant-scoped account-credit payment with its receipt number, refundable balance, refund history, and reversal state.",
      ),
    )
    .input(getPaymentInputSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.READ_ADMISSION_LEDGER))
    .output(paymentOutputSchema)
    .handler(({ context, input }) => financeHandler((value: typeof input) => getPayment(context.db, value))({ input })),

  recordPayment: protectedProcedure
    .route(
      route(
        "Record a payment",
        "Atomically record an idempotent payment and receipt number as an admission-level account credit without linking it to a bill.",
      ),
    )
    .input(recordPaymentInputSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.RECORD_PAYMENT))
    .output(recordedPaymentOutputSchema)
    .handler(async ({ context, input }) => {
      try { return await recordPayment(context.db, input, context.session.user.id); }
      catch (error) { throw toRpcError(error); }
    }),

  recordAdjustment: protectedProcedure
    .route(
      route(
        "Record a non-cash finance adjustment",
        "Append an idempotent discount, waiver, write-off, correction, or debit adjustment with an explicit reason and immutable audit provenance.",
      ),
    )
    .input(recordAdjustmentInputSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.RECORD_FINANCE_ADJUSTMENT))
    .output(adjustmentOutputSchema)
    .handler(async ({ context, input }) => {
      try { return await recordAdjustment(context.db, input, context.session.user.id); }
      catch (error) { throw toRpcError(error); }
    }),

  recordRefund: protectedProcedure
    .route(
      route(
        "Record a payment refund",
        "Atomically append an idempotent refund against a recorded payment while enforcing its refundable balance and preserving an immutable audit trail.",
      ),
    )
    .input(recordRefundInputSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.RECORD_REFUND))
    .output(refundRecordOutputSchema)
    .handler(async ({ context, input }) => {
      try { return await recordRefund(context.db, input, context.session.user.id); }
      catch (error) { throw toRpcError(error); }
    }),

  reverseLedgerEntry: protectedProcedure
    .route(
      route(
        "Reverse a ledger entry",
        "Append an idempotent opposite entry for an eligible payment, refund, or adjustment; the original immutable ledger fact remains preserved.",
      ),
    )
    .input(reverseLedgerEntryInputSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.REVERSE_LEDGER_ENTRY))
    .output(reversalOutputSchema)
    .handler(async ({ context, input }) => {
      try { return await reverseLedgerEntry(context.db, input, context.session.user.id); }
      catch (error) { throw toRpcError(error); }
    }),
};
