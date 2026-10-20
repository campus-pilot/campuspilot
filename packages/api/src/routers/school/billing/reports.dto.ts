import { z } from "zod";

import { createListInputSchema, createPaginatedOutputSchema } from "../../../paginations";
import { financeCumulativeIntegerStringSchema, financeIntegerStringSchema } from "./transport";

const currencySchema = z.string().regex(/^[A-Z]{3}$/);
const signedCumulativeSchema = z.string().regex(/^-?(0|[1-9]\d*)$/).refine((value) => value.replace("-", "").length <= 38);

function dateRangeRefinement(value: { filters?: { from?: Date; to?: Date } }, context: z.RefinementCtx) {
  if (value.filters?.from && value.filters.to && value.filters.from > value.filters.to) {
    context.addIssue({ code: "custom", path: ["filters", "to"], message: "To must be on or after from." });
  }
}

export const sessionFinanceOverviewInputSchema = z.object({
  schoolId: z.string().min(1), sessionId: z.string().min(1), currency: currencySchema.optional(),
});
export const sessionFinanceOverviewOutputSchema = z.object({
  currencies: z.array(z.object({
    currency: currencySchema,
    billedMinor: financeCumulativeIntegerStringSchema,
    paymentMinor: financeCumulativeIntegerStringSchema,
    refundMinor: financeCumulativeIntegerStringSchema,
    netCashMinor: signedCumulativeSchema,
    discountMinor: financeCumulativeIntegerStringSchema,
    waiverMinor: financeCumulativeIntegerStringSchema,
    writeOffMinor: financeCumulativeIntegerStringSchema,
    creditCorrectionMinor: financeCumulativeIntegerStringSchema,
    creditAdjustmentMinor: financeCumulativeIntegerStringSchema,
    debitAdjustmentMinor: financeCumulativeIntegerStringSchema,
    balanceMinor: signedCumulativeSchema,
    dueMinor: financeCumulativeIntegerStringSchema,
    creditMinor: financeCumulativeIntegerStringSchema,
    /** Net cash divided by billed amount, rounded half-up to one basis point. */
    collectionRateBasisPoints: financeCumulativeIntegerStringSchema.nullable(),
  })),
});

const reportListInput = <const TShape extends z.ZodRawShape>(shape: TShape) => createListInputSchema({
  schoolId: z.string().min(1),
  filters: z.object({ sessionId: z.string().min(1).optional(), currency: currencySchema.optional(), from: z.coerce.date().optional(), to: z.coerce.date().optional(), ...shape }).optional(),
}).superRefine((value, context) => dateRangeRefinement(value as { filters?: { from?: Date; to?: Date } }, context));

export const collectionRegisterInputSchema = reportListInput({
  method: z.enum(["cash", "bank_transfer", "card", "cheque", "other"]).optional(),
  search: z.string().trim().min(1).max(200).optional(),
});
export const collectionRegisterOutputSchema = createPaginatedOutputSchema(z.object({
  ledgerEntryId: z.string(), admissionId: z.string(), sessionId: z.string(), currency: currencySchema,
  kind: z.enum(["payment", "refund"]), direction: z.enum(["credit", "debit"]), amountMinor: financeIntegerStringSchema,
  effectiveAt: z.date(), recordedAt: z.date(), recordedBy: z.string(), documentNumber: z.string(),
  method: z.enum(["cash", "bank_transfer", "card", "cheque", "other"]), reference: z.string().nullable(),
  admissionNumber: z.string(), admissionName: z.string(), reversed: z.boolean(),
}));

export const feeElementReportInputSchema = reportListInput({ search: z.string().trim().min(1).max(200).optional() });
export const feeElementReportOutputSchema = createPaginatedOutputSchema(z.object({
  sessionId: z.string(), currency: currencySchema, feeElementSlug: z.string(), feeElementName: z.string(),
  billCount: z.number().int().nonnegative(), billedMinor: financeCumulativeIntegerStringSchema,
  creditAdjustmentMinor: financeCumulativeIntegerStringSchema, debitAdjustmentMinor: financeCumulativeIntegerStringSchema,
  netChargeMinor: signedCumulativeSchema,
}));

export const classFinanceSnapshotInputSchema = reportListInput({ search: z.string().trim().min(1).max(200).optional() });
export const classFinanceSnapshotOutputSchema = createPaginatedOutputSchema(z.object({
  sessionId: z.string(), currency: currencySchema, classId: z.string().nullable(), classLabel: z.string().nullable(),
  billCount: z.number().int().nonnegative(), billedMinor: financeCumulativeIntegerStringSchema,
  creditAdjustmentMinor: financeCumulativeIntegerStringSchema,
  debitAdjustmentMinor: financeCumulativeIntegerStringSchema, netChargeMinor: signedCumulativeSchema,
}));
