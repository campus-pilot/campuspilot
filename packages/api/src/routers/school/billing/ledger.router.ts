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
  paymentAllocationPreviewOutputSchema,
  paymentListOutputSchema,
  paymentOutputSchema,
  previewPaymentAllocationInputSchema,
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
  previewPaymentAllocation,
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

export const ledgerOperationsRouter = {
  getAdmissionLedger: protectedProcedure
    .route({ summary: "Read an admission ledger", tags: ["School", "Billing"] })
    .input(getAdmissionLedgerInputSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.READ_ADMISSION_LEDGER))
    .output(admissionLedgerOutputSchema)
    .handler(({ context, input }) => financeHandler((value: typeof input) => getAdmissionLedger(context.db, value))({ input })),

  getAdmissionFinanceSummary: protectedProcedure
    .route({ summary: "Read an admission finance summary", tags: ["School", "Billing"] })
    .input(getAdmissionFinanceSummaryInputSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.READ_ADMISSION_LEDGER))
    .output(admissionFinanceSummaryOutputSchema)
    .handler(({ context, input }) => financeHandler((value: typeof input) => getAdmissionFinanceSummary(context.db, value))({ input })),

  reconcileAdmissionProjection: protectedProcedure
    .route({ summary: "Reconcile admission finance projections", tags: ["School", "Billing"] })
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
    .route({ summary: "List admission bills", tags: ["School", "Billing"] })
    .input(listAdmissionBillsInputSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.READ_ADMISSION_LEDGER))
    .output(admissionBillListOutputSchema)
    .handler(({ context, input }) => financeHandler((value: typeof input) => listAdmissionBills(context.db, value))({ input })),

  getAdmissionBill: protectedProcedure
    .route({ summary: "Read an immutable admission bill", tags: ["School", "Billing"] })
    .input(getAdmissionBillInputSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.READ_ADMISSION_LEDGER))
    .output(admissionBillOutputSchema)
    .handler(({ context, input }) => financeHandler((value: typeof input) => getAdmissionBill(context.db, value))({ input })),

  listPayments: protectedProcedure
    .route({ summary: "List recorded payments", tags: ["School", "Billing"] })
    .input(listPaymentsInputSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.READ_ADMISSION_LEDGER))
    .output(paymentListOutputSchema)
    .handler(({ context, input }) => financeHandler((value: typeof input) => listPayments(context.db, value))({ input })),

  getPayment: protectedProcedure
    .route({ summary: "Read an immutable payment", tags: ["School", "Billing"] })
    .input(getPaymentInputSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.READ_ADMISSION_LEDGER))
    .output(paymentOutputSchema)
    .handler(({ context, input }) => financeHandler((value: typeof input) => getPayment(context.db, value))({ input })),

  previewPaymentAllocation: protectedProcedure
    .route({ summary: "Preview payment allocations", tags: ["School", "Billing"] })
    .input(previewPaymentAllocationInputSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.RECORD_PAYMENT))
    .output(paymentAllocationPreviewOutputSchema)
    .handler(({ context, input }) => financeHandler((value: typeof input) => previewPaymentAllocation(context.db, value))({ input })),

  recordPayment: protectedProcedure
    .route({ summary: "Record a payment", tags: ["School", "Billing"] })
    .input(recordPaymentInputSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.RECORD_PAYMENT))
    .output(recordedPaymentOutputSchema)
    .handler(async ({ context, input }) => {
      try { return await recordPayment(context.db, input, context.session.user.id); }
      catch (error) { throw toRpcError(error); }
    }),

  recordAdjustment: protectedProcedure
    .route({ summary: "Record a non-cash finance adjustment", tags: ["School", "Billing"] })
    .input(recordAdjustmentInputSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.RECORD_FINANCE_ADJUSTMENT))
    .output(adjustmentOutputSchema)
    .handler(async ({ context, input }) => {
      try { return await recordAdjustment(context.db, input, context.session.user.id); }
      catch (error) { throw toRpcError(error); }
    }),

  recordRefund: protectedProcedure
    .route({ summary: "Record a payment refund", tags: ["School", "Billing"] })
    .input(recordRefundInputSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.RECORD_REFUND))
    .output(refundRecordOutputSchema)
    .handler(async ({ context, input }) => {
      try { return await recordRefund(context.db, input, context.session.user.id); }
      catch (error) { throw toRpcError(error); }
    }),

  reverseLedgerEntry: protectedProcedure
    .route({ summary: "Reverse a ledger entry", tags: ["School", "Billing"] })
    .input(reverseLedgerEntryInputSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.REVERSE_LEDGER_ENTRY))
    .output(reversalOutputSchema)
    .handler(async ({ context, input }) => {
      try { return await reverseLedgerEntry(context.db, input, context.session.user.id); }
      catch (error) { throw toRpcError(error); }
    }),
};
