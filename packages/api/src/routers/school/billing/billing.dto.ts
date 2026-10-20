import { z } from "zod";

import {
  createListInputSchema,
  createPaginatedOutputSchema,
} from "../../../paginations";
import { financeIntegerStringSchema } from "./transport";
import { isValidLocalDate } from "./period";

export const financeLocalDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a local date in YYYY-MM-DD format")
  .refine(isValidLocalDate, "Expected a real local calendar date");

const idempotencyKeySchema = z.string().trim().min(1).max(200);
const reasonSchema = z.string().trim().min(1).max(1000);
const uniqueIdsSchema = z
  .array(z.string().min(1))
  .min(1)
  .max(5000)
  .refine((values) => new Set(values).size === values.length, {
    message: "Identifiers must be unique.",
  });
const runValuesSchema = z
  .record(z.string().min(1), financeIntegerStringSchema)
  .refine((values) => Object.keys(values).length <= 1000, {
    message: "At most 1,000 run-time fee values may be supplied.",
  });
const runClassValuesSchema = z
  .record(z.string().min(1), runValuesSchema)
  .refine((values) => Object.keys(values).length <= 5000, {
    message: "At most 5,000 run-time class value groups may be supplied.",
  });

export const billingRunDraftInputSchema = z.object({
  schoolId: z.string().min(1),
  sessionId: z.string().min(1),
  billingDate: financeLocalDateSchema,
  admissionIds: uniqueIdsSchema.optional(),
  classIds: uniqueIdsSchema.optional(),
  runValues: z
    .object({
      session: runValuesSchema.default({}),
      classes: runClassValuesSchema.default({}),
    })
    .default({ session: {}, classes: {} }),
});

export const previewBillingRunInputSchema = billingRunDraftInputSchema.extend({
  searchQuery: z.string().trim().max(200).default(""),
  page: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).default(1),
  limit: z.number().int().positive().max(20).default(20),
  issuePage: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).default(1),
  issueLimit: z.number().int().positive().max(100).default(50),
});

export const postBillingRunInputSchema = billingRunDraftInputSchema
  .extend({
    expectedConfigurationHash: z.string().regex(/^[a-f0-9]{64}$/),
    idempotencyKey: idempotencyKeySchema,
    kind: z.enum(["regular", "supplemental"]),
    supplementalReason: reasonSchema.optional(),
  })
  .superRefine((input, context) => {
    if (input.kind === "supplemental" && !input.supplementalReason) {
      context.addIssue({
        code: "custom",
        path: ["supplementalReason"],
        message: "A supplemental billing run requires a reason.",
      });
    }
    if (input.kind === "regular" && input.supplementalReason !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["supplementalReason"],
        message: "A regular billing run cannot include a supplemental reason.",
      });
    }
  });

export const billingReadinessIssueSchema = z.object({
  scope: z.enum(["configuration", "session", "class", "admission"]),
  entityId: z.string(),
  entityLabel: z.string(),
  code: z.enum([
    "invalid_configuration",
    "invalid_run_value",
    "unresolved_price",
    "missing_placement",
    "unregistered",
    "zero_total",
    "not_enrolled",
    "invalid_selection",
    "run_too_large",
    "amount_overflow",
  ]),
  feeElementSlug: z.string().nullable(),
  blocking: z.boolean(),
  message: z.string(),
  pricingResolutionSnapshot: z.record(z.string(), z.unknown()).optional(),
});

export const billingPreviewLineSchema = z.object({
  feeElementSlug: z.string(),
  feeElementName: z.string(),
  amountMinor: financeIntegerStringSchema,
  pricingSourceKind: z.enum([
    "admission",
    "class",
    "session",
    "run_class",
    "run_session",
    "fallback",
  ]),
  pricingSourceKey: z.string(),
  pricingRuleSnapshot: z.record(z.string(), z.unknown()),
});

export const billingPreviewAdmissionSchema = z.object({
  admissionId: z.string(),
  admissionNumber: z.string(),
  admissionName: z.string(),
  enrollmentId: z.string(),
  classId: z.string(),
  classSlug: z.string(),
  classLabel: z.string(),
  sectionId: z.string().nullable(),
  sectionSlug: z.string().nullable(),
  sectionLabel: z.string().nullable(),
  rollNumber: z.number().int().nullable(),
  totalAmountMinor: financeIntegerStringSchema,
  lines: z.array(billingPreviewLineSchema),
});

export const billingRunPreviewOutputSchema = z.object({
  configurationHash: z.string().regex(/^[a-f0-9]{64}$/),
  readyToPost: z.boolean(),
  period: z.object({
    key: z.string(),
    cadence: z.enum(["monthly", "quarterly", "yearly"]),
    startDate: financeLocalDateSchema,
    endDate: financeLocalDateSchema,
    startAt: z.date(),
    endAt: z.date(),
    timeZone: z.string(),
  }).nullable(),
  currency: z.string().length(3).nullable(),
  counts: z.object({
    selected: z.number().int().nonnegative(),
    eligible: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
  }),
  totalAmountMinor: financeIntegerStringSchema,
  issues: z.object({
    items: z.array(billingReadinessIssueSchema),
    pagination: z.object({
      currentPage: z.number().int().positive(),
      totalPages: z.number().int().nonnegative(),
      totalItems: z.number().int().nonnegative(),
      pageSize: z.number().int().positive(),
      nextCursor: z.string().nullable(),
    }),
  }),
  breakdown: z.object({
    items: z.array(billingPreviewAdmissionSchema),
    pagination: z.object({
      currentPage: z.number().int().positive(),
      totalPages: z.number().int().nonnegative(),
      totalItems: z.number().int().nonnegative(),
      pageSize: z.number().int().positive(),
      nextCursor: z.string().nullable(),
    }),
  }),
});

export const billingRunDtoSchema = z.object({
  id: z.string(),
  schoolId: z.string(),
  sessionId: z.string(),
  kind: z.enum(["regular", "supplemental"]),
  status: z.enum(["posting", "posted"]),
  periodKey: z.string(),
  periodStartDate: financeLocalDateSchema,
  periodEndDate: financeLocalDateSchema,
  periodStartAt: z.date(),
  periodEndAt: z.date(),
  issueDate: financeLocalDateSchema,
  timeZone: z.string(),
  cadence: z.enum(["monthly", "quarterly", "yearly"]),
  currency: z.string().length(3),
  configHash: z.string(),
  totalAmountMinor: financeIntegerStringSchema,
  billCount: z.number().int().nonnegative(),
  supplementalReason: z.string().nullable(),
  recordedBy: z.string(),
  recordedAt: z.date(),
  finalizedAt: z.date().nullable(),
  reversedBillCount: z.number().int().nonnegative(),
  fullyReversed: z.boolean(),
});

export const listBillingRunsInputSchema = createListInputSchema({
  schoolId: z.string().min(1),
  filters: z
    .object({
      sessionId: z.string().min(1).optional(),
      periodKey: z.string().min(1).optional(),
      kind: z.enum(["regular", "supplemental"]).optional(),
      recordedBy: z.string().min(1).optional(),
      recordedFrom: z.coerce.date().optional(),
      recordedTo: z.coerce.date().optional(),
    })
    .optional(),
  orderBy: z
    .object({
      field: z.enum(["recordedAt", "issueDate", "periodKey"]),
      direction: z.enum(["asc", "desc"]),
    })
    .default({ field: "recordedAt", direction: "desc" }),
});

export const listBillingRunsOutputSchema = createPaginatedOutputSchema(
  billingRunDtoSchema,
);

export const getBillingRunInputSchema = z.object({
  schoolId: z.string().min(1),
  sessionId: z.string().min(1),
  billRunId: z.string().min(1),
  page: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).default(1),
  limit: z.number().int().positive().max(20).default(20),
});

export const billingBillLineDtoSchema = billingPreviewLineSchema.extend({
  id: z.string(),
  lineOrder: z.number().int().nonnegative(),
  pricingSourceKind: z.enum([
    "admission",
    "class",
    "session",
    "run_class",
    "run_session",
    "fallback",
    "manual",
  ]),
  pricingSourceKey: z.string().nullable(),
});

export const billingBillDtoSchema = z.object({
  id: z.string(),
  admissionId: z.string(),
  sessionId: z.string(),
  billRunId: z.string().nullable(),
  ledgerEntryId: z.string(),
  sourceKind: z.enum(["billing_run", "manual"]),
  billNumber: z.string(),
  issueDate: financeLocalDateSchema,
  periodKey: z.string().nullable(),
  currency: z.string().length(3),
  totalAmountMinor: financeIntegerStringSchema,
  lineCount: z.number().int().positive(),
  admissionNumberSnapshot: z.string(),
  admissionNameSnapshot: z.string(),
  sessionStartYearSnapshot: z.number().int(),
  sessionEndYearSnapshot: z.number().int(),
  enrollmentIdSnapshot: z.string().nullable(),
  classIdSnapshot: z.string().nullable(),
  classSlugSnapshot: z.string().nullable(),
  classLabelSnapshot: z.string().nullable(),
  sectionIdSnapshot: z.string().nullable(),
  sectionSlugSnapshot: z.string().nullable(),
  sectionLabelSnapshot: z.string().nullable(),
  rollNumberSnapshot: z.number().int().nullable(),
  configHash: z.string().nullable(),
  manualReason: z.string().nullable(),
  recordedBy: z.string(),
  recordedAt: z.date(),
  finalizedAt: z.date().nullable(),
  reversed: z.boolean(),
  lines: z.array(billingBillLineDtoSchema),
});

export const billingRunDetailDtoSchema = billingRunDtoSchema.extend({
  configSnapshot: z.record(z.string(), z.unknown()),
  inputSnapshot: z.record(z.string(), z.unknown()),
  bills: createPaginatedOutputSchema(billingBillDtoSchema),
});

export const createManualBillInputSchema = z.object({
  schoolId: z.string().min(1),
  sessionId: z.string().min(1),
  admissionId: z.string().min(1),
  issueDate: financeLocalDateSchema,
  reason: reasonSchema,
  idempotencyKey: idempotencyKeySchema,
  lines: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(200),
        amountMinor: financeIntegerStringSchema.refine(
          (value) => BigInt(value) > BigInt(0),
          "Manual bill line amount must be positive.",
        ),
      }),
    )
    .min(1)
    .max(100),
}).superRefine((input, context) => {
  let total = BigInt(0);
  const maximum = BigInt("9223372036854775807");
  for (const [index, line] of input.lines.entries()) {
    const amount = BigInt(line.amountMinor);
    if (total > maximum - amount) {
      context.addIssue({
        code: "custom",
        path: ["lines", index, "amountMinor"],
        message: "Manual bill total exceeds the PostgreSQL bigint range.",
      });
      return;
    }
    total += amount;
  }
});

const reversalShape = {
  schoolId: z.string().min(1),
  sessionId: z.string().min(1),
  effectiveAt: z.coerce.date(),
  reason: reasonSchema,
  idempotencyKey: idempotencyKeySchema,
};

export const reverseBillInputSchema = z.object({
  ...reversalShape,
  admissionId: z.string().min(1),
  billId: z.string().min(1),
});

export const reverseBillingRunInputSchema = z.object({
  ...reversalShape,
  billRunId: z.string().min(1),
});

export const billReversalDtoSchema = z.object({
  billId: z.string(),
  ledgerEntryId: z.string(),
  reversalEntryId: z.string(),
  amountMinor: financeIntegerStringSchema,
  currency: z.string().length(3),
  recordedAt: z.date(),
});

export const billingRunReversalDtoSchema = z.object({
  billRunId: z.string(),
  reversedBillCount: z.number().int().nonnegative(),
  totalAmountMinor: financeIntegerStringSchema,
  currency: z.string().length(3),
  recordedAt: z.date(),
});
