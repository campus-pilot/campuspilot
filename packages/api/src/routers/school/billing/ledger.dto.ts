import { createListInputSchema, createPaginatedOutputSchema } from "../../../paginations";
import { z } from "zod";

import {
  financeCumulativeIntegerStringSchema,
  financeIntegerStringSchema,
} from "./transport";

const idempotencyKeySchema = z.string().trim().min(1).max(200);
const reasonSchema = z.string().trim().min(1).max(1000);
const currencySchema = z.string().regex(/^[A-Z]{3}$/);
const paymentMethodSchema = z.enum([
  "cash",
  "bank_transfer",
  "card",
  "cheque",
  "other",
]);
const ledgerTypeSchema = z.enum([
  "bill",
  "manual_debit_adjustment",
  "payment",
  "discount",
  "waiver",
  "write_off",
  "refund",
  "debit_correction",
  "credit_correction",
  "reversal",
]);

export const getAdmissionLedgerInputSchema = createListInputSchema({
  schoolId: z.string().min(1),
  admissionId: z.string().min(1),
  filters: z
    .object({
      sessionId: z.string().min(1).optional(),
      currency: currencySchema.optional(),
      effectiveFrom: z.coerce.date().optional(),
      effectiveTo: z.coerce.date().optional(),
      types: z.array(ledgerTypeSchema).min(1).max(10).optional(),
    })
    .optional(),
}).superRefine((value, context) => {
  const from = value.filters?.effectiveFrom;
  const to = value.filters?.effectiveTo;
  if (from && to && from > to) {
    context.addIssue({ code: "custom", path: ["filters", "effectiveTo"], message: "Effective-to must be on or after effective-from." });
  }
});

export const getAdmissionFinanceSummaryInputSchema = z.object({
  schoolId: z.string().min(1),
  admissionId: z.string().min(1),
  sessionId: z.string().min(1).optional(),
});

export const reconcileAdmissionProjectionInputSchema = z.object({
  schoolId: z.string().min(1),
  admissionId: z.string().min(1),
  currency: currencySchema,
});

export const listAdmissionBillsInputSchema = createListInputSchema({
  schoolId: z.string().min(1),
  filters: z
    .object({
      admissionId: z.string().min(1).optional(),
      sessionId: z.string().min(1).optional(),
      currency: currencySchema.optional(),
      search: z.string().trim().min(1).max(200).optional(),
      status: z.enum(["posted", "reversed"]).optional(),
      issueFrom: z.string().date().optional(),
      issueTo: z.string().date().optional(),
    })
    .optional(),
}).superRefine((value, context) => {
  const from = value.filters?.issueFrom;
  const to = value.filters?.issueTo;
  if (from && to && from > to) {
    context.addIssue({ code: "custom", path: ["filters", "issueTo"], message: "Issue-to must be on or after issue-from." });
  }
});

export const getAdmissionBillInputSchema = z.object({
  schoolId: z.string().min(1),
  admissionId: z.string().min(1),
  billId: z.string().min(1),
  adjustmentPage: z.number().int().positive().default(1),
  adjustmentLimit: z.number().int().positive().max(100).default(20),
});

export const listPaymentsInputSchema = createListInputSchema({
  schoolId: z.string().min(1),
  filters: z
    .object({
      admissionId: z.string().min(1).optional(),
      sessionId: z.string().min(1).optional(),
      currency: currencySchema.optional(),
      search: z.string().trim().min(1).max(200).optional(),
      method: paymentMethodSchema.optional(),
      externalReference: z.string().trim().min(1).max(500).optional(),
      status: z.enum(["recorded", "partially_refunded", "refunded", "reversed"]).optional(),
      receivedFrom: z.coerce.date().optional(),
      receivedTo: z.coerce.date().optional(),
    })
    .optional(),
}).superRefine((value, context) => {
  const from = value.filters?.receivedFrom;
  const to = value.filters?.receivedTo;
  if (from && to && from > to) {
    context.addIssue({ code: "custom", path: ["filters", "receivedTo"], message: "Received-to must be on or after received-from." });
  }
});

export const getPaymentInputSchema = z.object({
  schoolId: z.string().min(1),
  admissionId: z.string().min(1).optional(),
  paymentId: z.string().min(1),
  refundPage: z.number().int().positive().default(1),
  refundLimit: z.number().int().positive().max(100).default(20),
});

const paymentCommandShape = {
  schoolId: z.string().min(1),
  admissionId: z.string().min(1),
  sessionId: z.string().min(1),
  amountMinor: financeIntegerStringSchema.refine((value) => BigInt(value) > BigInt(0), {
    message: "Payment amount must be positive",
  }),
  currency: currencySchema,
} as const;

export const recordPaymentInputSchema = z.object({
    ...paymentCommandShape,
    method: paymentMethodSchema,
    externalReference: z.string().trim().min(1).max(500).nullable().optional(),
    payerName: z.string().trim().min(1).max(300).nullable().optional(),
    receivedAt: z.coerce.date(),
    effectiveAt: z.coerce.date(),
    note: z.string().trim().min(1).max(1000).nullable().optional(),
    idempotencyKey: idempotencyKeySchema,
  });

const percentageSchema = z
  .string()
  .regex(/^(?:100(?:\.0{1,4})?|(?:[1-9]\d?|0)\.\d{1,4}|[1-9]\d?)$/)
  .refine((value) => BigInt(value.replace(".", "")) > BigInt(0), {
    message: "Percentage must be greater than zero",
  });

export const recordAdjustmentInputSchema = z
  .object({
    schoolId: z.string().min(1),
    admissionId: z.string().min(1),
    sessionId: z.string().min(1),
    currency: currencySchema,
    kind: z.enum([
      "discount",
      "waiver",
      "write_off",
      "debit_correction",
      "credit_correction",
    ]),
    billId: z.string().min(1).optional(),
    billLineId: z.string().min(1).optional(),
    calculation: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("fixed"), amountMinor: financeIntegerStringSchema.refine((value) => BigInt(value) > BigInt(0)) }),
      z.object({ kind: z.literal("percentage"), percentage: percentageSchema }),
    ]),
    reasonCode: z.string().trim().min(1).max(100),
    reasonNote: reasonSchema,
    approvedBy: z.string().trim().min(1).max(300).nullable().optional(),
    effectiveAt: z.coerce.date(),
    idempotencyKey: idempotencyKeySchema,
  })
  .superRefine((value, context) => {
    if (value.billLineId && !value.billId) {
      context.addIssue({ code: "custom", path: ["billId"], message: "A bill line target requires its bill." });
    }
    if (["discount", "waiver", "write_off", "debit_correction"].includes(value.kind) && !value.billId) {
      context.addIssue({ code: "custom", path: ["billId"], message: "Discounts, waivers, write-offs, and debit corrections require a posted bill target." });
    }
    if (value.calculation.kind === "percentage" && !value.billId) {
      context.addIssue({ code: "custom", path: ["calculation"], message: "Percentage adjustments require a bill or bill-line target." });
    }
  });

export const recordRefundInputSchema = z.object({
  schoolId: z.string().min(1),
  admissionId: z.string().min(1),
  sessionId: z.string().min(1),
  paymentId: z.string().min(1),
  amountMinor: financeIntegerStringSchema.refine((value) => BigInt(value) > BigInt(0)),
  method: paymentMethodSchema,
  externalReference: z.string().trim().min(1).max(500).nullable().optional(),
  reason: reasonSchema,
  effectiveAt: z.coerce.date(),
  idempotencyKey: idempotencyKeySchema,
});

export const reverseLedgerEntryInputSchema = z.object({
  schoolId: z.string().min(1),
  admissionId: z.string().min(1),
  sessionId: z.string().min(1),
  ledgerEntryId: z.string().min(1),
  reason: reasonSchema,
  effectiveAt: z.coerce.date(),
  idempotencyKey: idempotencyKeySchema,
});

const signedFinanceCumulativeIntegerStringSchema = z
  .string()
  .regex(/^-?(0|[1-9]\d*)$/)
  .refine((value) => {
    const magnitude = value.startsWith("-") ? value.slice(1) : value;
    return magnitude.length < 38 || (magnitude.length === 38 && magnitude <= "9".repeat(38));
  }, "Finance cumulative integer exceeds NUMERIC(38,0)");
const balanceSchema = z.object({
  currency: currencySchema,
  balanceMinor: signedFinanceCumulativeIntegerStringSchema,
  dueMinor: financeCumulativeIntegerStringSchema,
  creditMinor: financeCumulativeIntegerStringSchema,
});
const billStatusSchema = z.enum(["posted", "reversed"]);

export const admissionLedgerOutputSchema = z.object({
  openingBalances: z.array(balanceSchema),
  closingBalances: z.array(balanceSchema),
  sessionSummaries: z.array(z.object({
    schoolId: z.string(), admissionId: z.string(), sessionId: z.string(), currency: currencySchema,
    lastSequence: financeIntegerStringSchema, entryCount: financeIntegerStringSchema,
    debitTotalMinor: financeCumulativeIntegerStringSchema, creditTotalMinor: financeCumulativeIntegerStringSchema,
    balanceMinor: signedFinanceCumulativeIntegerStringSchema, dueMinor: financeCumulativeIntegerStringSchema,
    creditMinor: financeCumulativeIntegerStringSchema, rebuiltAt: z.date(),
  })),
  pageOpeningBalances: z.array(balanceSchema),
  entries: createPaginatedOutputSchema(z.object({
    id: z.string(), schoolId: z.string(), admissionId: z.string(), sessionId: z.string(),
    sequence: financeIntegerStringSchema, type: ledgerTypeSchema,
    direction: z.enum(["debit", "credit"]), amountMinor: financeIntegerStringSchema,
    currency: currencySchema, timeZone: z.string().nullable(), effectiveAt: z.date(), recordedAt: z.date(), recordedBy: z.string(),
    note: z.string().nullable(), reversalOfEntryId: z.string().nullable(), idempotencyKey: z.string(),
    reversed: z.boolean(),
    runningBalanceMinor: signedFinanceCumulativeIntegerStringSchema,
    detail: z.record(z.string(), z.unknown()).nullable(),
  })),
});

export const admissionFinanceSummaryOutputSchema = z.object({
  currencies: z.array(z.object({
    currency: currencySchema, lifetimeDebitMinor: financeCumulativeIntegerStringSchema,
    lifetimeCreditMinor: financeCumulativeIntegerStringSchema, balanceMinor: signedFinanceCumulativeIntegerStringSchema,
    dueMinor: financeCumulativeIntegerStringSchema, creditMinor: financeCumulativeIntegerStringSchema,
    billedMinor: financeCumulativeIntegerStringSchema,
    collectedMinor: financeCumulativeIntegerStringSchema,
    creditAdjustmentMinor: financeCumulativeIntegerStringSchema,
    debitAdjustmentMinor: financeCumulativeIntegerStringSchema,
    refundMinor: financeCumulativeIntegerStringSchema,
    selectedSession: z.object({ debitMinor: financeCumulativeIntegerStringSchema, creditMinor: financeCumulativeIntegerStringSchema, balanceMinor: signedFinanceCumulativeIntegerStringSchema }).nullable(),
    broughtForwardMinor: signedFinanceCumulativeIntegerStringSchema,
    billCounts: z.object({ posted: z.number().int().nonnegative(), reversed: z.number().int().nonnegative() }),
  })),
});

const billListItemSchema = z.object({
  id: z.string(), schoolId: z.string(), admissionId: z.string(), sessionId: z.string(), billRunId: z.string().nullable(),
  ledgerEntryId: z.string(), status: billStatusSchema, sourceKind: z.enum(["billing_run", "manual"]),
  billNumber: z.string(), issueDate: z.string().date(), periodKey: z.string().nullable(), currency: currencySchema,
  totalAmountMinor: financeIntegerStringSchema,
  adjustedMinor: financeCumulativeIntegerStringSchema, debitedAdjustmentMinor: financeCumulativeIntegerStringSchema, netAmountMinor: financeCumulativeIntegerStringSchema,
  lineCount: z.number().int().positive(), admissionNumberSnapshot: z.string(), admissionNameSnapshot: z.string(),
  sessionStartYearSnapshot: z.number().int(), sessionEndYearSnapshot: z.number().int(),
  enrollmentIdSnapshot: z.string().nullable(), classIdSnapshot: z.string().nullable(), classSlugSnapshot: z.string().nullable(),
  classLabelSnapshot: z.string().nullable(), sectionIdSnapshot: z.string().nullable(), sectionSlugSnapshot: z.string().nullable(),
  sectionLabelSnapshot: z.string().nullable(), rollNumberSnapshot: z.number().int().nullable(), configHash: z.string().nullable(),
  manualReason: z.string().nullable(), recordedBy: z.string(), recordedAt: z.date(), finalizedAt: z.date().nullable(),
});
export const admissionBillListOutputSchema = createPaginatedOutputSchema(billListItemSchema);
export const admissionBillOutputSchema = billListItemSchema.omit({ status: true }).extend({
  reversed: z.boolean(),
  lines: z.array(z.object({
    id: z.string(), schoolId: z.string(), billId: z.string(), lineOrder: z.number().int().nonnegative(),
    feeElementSlug: z.string(), feeElementName: z.string(), amountMinor: financeIntegerStringSchema,
    currency: currencySchema, pricingSourceKind: z.enum(["admission", "class", "session", "run_class", "run_session", "fallback", "manual"]),
    pricingSourceKey: z.string().nullable(), pricingRuleSnapshot: z.record(z.string(), z.unknown()), manualReason: z.string().nullable(),
  })),
  adjustments: createPaginatedOutputSchema(z.object({
    id: z.string(), schoolId: z.string(), admissionId: z.string(), sessionId: z.string(), ledgerEntryId: z.string(),
    billId: z.string().nullable(), billLineId: z.string().nullable(), kind: z.enum(["discount", "waiver", "write_off", "debit_correction", "credit_correction"]),
    amountMinor: financeIntegerStringSchema, currency: currencySchema, reasonCode: z.string(), reasonNote: z.string(),
    calculationSnapshot: z.record(z.string(), z.unknown()), approvedBy: z.string().nullable(), idempotencyKey: z.string(), recordedBy: z.string(), recordedAt: z.date(),
    reversed: z.boolean(),
  })),
});

const paymentListItemSchema = z.object({
  id: z.string(), schoolId: z.string(), admissionId: z.string(), sessionId: z.string(), ledgerEntryId: z.string(),
  receiptNumber: z.string(), amountMinor: financeIntegerStringSchema, currency: currencySchema, method: paymentMethodSchema,
  externalReference: z.string().nullable(), payerName: z.string().nullable(), receivedAt: z.date(), note: z.string().nullable(),
  idempotencyKey: z.string(), recordedBy: z.string(), recordedAt: z.date(),
  refundedMinor: financeCumulativeIntegerStringSchema, refundableMinor: financeCumulativeIntegerStringSchema,
  timeZone: z.string().nullable(),
  reversed: z.boolean(),
  status: z.enum(["recorded", "partially_refunded", "refunded", "reversed"]),
  admissionNumber: z.string(), admissionName: z.string(),
});
export const paymentListOutputSchema = createPaginatedOutputSchema(paymentListItemSchema);
const refundOutputSchema = z.object({ id: z.string(), schoolId: z.string(), admissionId: z.string(), sessionId: z.string(), paymentId: z.string(), ledgerEntryId: z.string(), refundNumber: z.string(), amountMinor: financeIntegerStringSchema, currency: currencySchema, method: paymentMethodSchema, externalReference: z.string().nullable(), reason: z.string(), idempotencyKey: z.string(), recordedBy: z.string(), recordedAt: z.date() });
export const paymentOutputSchema = paymentListItemSchema.omit({ admissionNumber: true, admissionName: true }).extend({ refunds: createPaginatedOutputSchema(refundOutputSchema.extend({ reversed: z.boolean() })) });
export const recordedPaymentOutputSchema = paymentOutputSchema
  .omit({ refundedMinor: true, refundableMinor: true, reversed: true, status: true, refunds: true, timeZone: true });
export const adjustmentOutputSchema = z.object({ id: z.string(), schoolId: z.string(), admissionId: z.string(), sessionId: z.string(), ledgerEntryId: z.string(), billId: z.string().nullable(), billLineId: z.string().nullable(), kind: z.enum(["discount", "waiver", "write_off", "debit_correction", "credit_correction"]), amountMinor: financeIntegerStringSchema, currency: currencySchema, reasonCode: z.string(), reasonNote: z.string(), calculationSnapshot: z.record(z.string(), z.unknown()), approvedBy: z.string().nullable(), idempotencyKey: z.string(), recordedBy: z.string(), recordedAt: z.date() });
export const refundRecordOutputSchema = refundOutputSchema;
export const reversalOutputSchema = z.object({ id: z.string(), schoolId: z.string(), admissionId: z.string(), sessionId: z.string(), sequence: financeIntegerStringSchema, type: z.literal("reversal"), direction: z.enum(["debit", "credit"]), amountMinor: financeIntegerStringSchema, currency: currencySchema, effectiveAt: z.date(), recordedAt: z.date(), recordedBy: z.string(), note: z.string().nullable(), reversalOfEntryId: z.string(), idempotencyKey: z.string() });
const projectionTotalsSchema = z.object({ lastSequence: financeIntegerStringSchema, entryCount: financeIntegerStringSchema, debitTotalMinor: financeCumulativeIntegerStringSchema, creditTotalMinor: financeCumulativeIntegerStringSchema });
const projectionSchema = z.object({ lifetime: projectionTotalsSchema, sessions: z.array(projectionTotalsSchema.extend({ sessionId: z.string() })) });
export const reconciliationOutputSchema = z.object({ matches: z.boolean(), expected: projectionSchema, actual: z.object({ lifetime: projectionTotalsSchema.nullable(), sessions: z.array(projectionTotalsSchema.extend({ sessionId: z.string() })) }) });
