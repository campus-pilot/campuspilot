import { SCHOOL_ACTIONS } from "@campuspilot/opa/policies/school";

import { toRpcError } from "../../../errors";
import { protectedProcedure } from "../../../index";
import { requireSchoolPermission } from "../../../permissions/school";
import {
  billReversalDtoSchema,
  billingRunDetailDtoSchema,
  billingRunDtoSchema,
  billingRunPreviewOutputSchema,
  billingRunReversalDtoSchema,
  createManualBillInputSchema,
  getBillingRunInputSchema,
  listBillingRunsInputSchema,
  listBillingRunsOutputSchema,
  postBillingRunInputSchema,
  previewBillingRunInputSchema,
  reverseBillInputSchema,
  reverseBillingRunInputSchema,
  billingBillDtoSchema,
} from "./billing.dto";
import {
  createPostedManualBill,
  postPreparedBillingRun,
  reversePostedBill,
  reversePostedBillingRun,
} from "./billing-posting";
import { prepareBillingRun } from "./billing-readiness";
import { getBillingRunDetail, listBillingRuns } from "./billing-read";
import { serializeFinanceInteger } from "./transport";

function previewTransport(
  prepared: Awaited<ReturnType<typeof prepareBillingRun>>,
  page: number,
  limit: number,
  issuePage: number,
  issueLimit: number,
) {
  const totalItems = prepared.eligible.length;
  const totalPages = Math.ceil(totalItems / limit);
  const offset = (page - 1) * limit;
  const issueTotalItems = prepared.issues.length;
  const issueTotalPages = Math.ceil(issueTotalItems / issueLimit);
  const issueOffset = (issuePage - 1) * issueLimit;
  return {
    configurationHash: prepared.configurationHash,
    readyToPost: prepared.readyToPost,
    period: prepared.period,
    currency: prepared.currency,
    counts: {
      selected: prepared.selectedCount,
      eligible: prepared.eligible.length,
      skipped: Math.max(0, prepared.selectedCount - prepared.eligible.length),
    },
    totalAmountMinor: serializeFinanceInteger(prepared.totalAmountMinor),
    issues: {
      items: prepared.issues.slice(issueOffset, issueOffset + issueLimit),
      pagination: {
        currentPage: issuePage,
        totalPages: issueTotalPages,
        totalItems: issueTotalItems,
        pageSize: issueLimit,
        nextCursor: issuePage < issueTotalPages ? String(issuePage + 1) : null,
      },
    },
    breakdown: {
      items: prepared.eligible.slice(offset, offset + limit).map((admission) => ({
        ...admission,
        totalAmountMinor: serializeFinanceInteger(admission.totalAmountMinor),
        lines: admission.lines.map((line) => ({
          ...line,
          amountMinor: serializeFinanceInteger(line.amountMinor),
        })),
      })),
      pagination: {
        currentPage: page,
        totalPages,
        totalItems,
        pageSize: limit,
        nextCursor: page < totalPages ? String(page + 1) : null,
      },
    },
  };
}

export const billingOperationsRouter = {
  previewBillingRun: protectedProcedure
    .route({
      summary: "Preview a billing run",
      description:
        "Resolve exact pricing and grouped readiness issues for an explicit school session and local billing period without writing financial facts.",
      tags: ["School", "Billing"],
    })
    .input(previewBillingRunInputSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.PREVIEW_BILLING_RUN))
    .output(billingRunPreviewOutputSchema)
    .handler(async ({ context, input }) => {
      try {
        const prepared = await prepareBillingRun(context.db, input);
        return previewTransport(
          prepared,
          input.page,
          input.limit,
          input.issuePage,
          input.issueLimit,
        );
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  postBillingRun: protectedProcedure
    .route({
      summary: "Post a billing run",
      description:
        "Recompute a reviewed billing command under deterministic locks and atomically post a regular or reasoned supplemental run with immutable bill, line, ledger, and projection facts.",
      tags: ["School", "Billing"],
    })
    .input(postBillingRunInputSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.POST_BILLING_RUN))
    .output(billingRunDtoSchema)
    .handler(async ({ context, input }) => {
      try {
        return await postPreparedBillingRun(
          context.db,
          input,
          context.session.user.id,
        );
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  listBillingRuns: protectedProcedure
    .route({
      summary: "List billing runs",
      description:
        "List paginated billing runs with explicit session, period, kind, recorder, and recorded-time filters.",
      tags: ["School", "Billing"],
    })
    .input(listBillingRunsInputSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.READ_BILLING_RUNS))
    .output(listBillingRunsOutputSchema)
    .handler(async ({ context, input }) => {
      try {
        return await listBillingRuns(context.db, input);
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  getBillingRun: protectedProcedure
    .route({
      summary: "Get a billing run",
      description:
        "Read one billing run with immutable admission, enrollment, placement, pricing-source, configuration, and input snapshots.",
      tags: ["School", "Billing"],
    })
    .input(getBillingRunInputSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.READ_BILLING_RUNS))
    .output(billingRunDetailDtoSchema)
    .handler(async ({ context, input }) => {
      try {
        return await getBillingRunDetail(context.db, input);
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  createManualBill: protectedProcedure
    .route({
      summary: "Create a manual bill",
      description:
        "Post a reasoned ordinary manual bill for one registered admission enrolled in the explicitly supplied session.",
      tags: ["School", "Billing"],
    })
    .input(createManualBillInputSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.CREATE_MANUAL_BILL))
    .output(billingBillDtoSchema)
    .handler(async ({ context, input }) => {
      try {
        return await createPostedManualBill(
          context.db,
          input,
          context.session.user.id,
        );
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  reverseBill: protectedProcedure
    .route({
      summary: "Reverse a bill",
      description:
        "Append one immutable opposite ledger fact for an unsettled bill. A reason and operation idempotency key are required.",
      tags: ["School", "Billing"],
    })
    .input(reverseBillInputSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.REVERSE_BILL))
    .output(billReversalDtoSchema)
    .handler(async ({ context, input }) => {
      try {
        return await reversePostedBill(
          context.db,
          input,
          context.session.user.id,
        );
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  reverseBillingRun: protectedProcedure
    .route({
      summary: "Reverse a billing run",
      description:
        "Atomically append opposite ledger facts for every bill in a run only when every member passes the settlement and prior-reversal guards.",
      tags: ["School", "Billing"],
    })
    .input(reverseBillingRunInputSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.REVERSE_BILLING_RUN))
    .output(billingRunReversalDtoSchema)
    .handler(async ({ context, input }) => {
      try {
        return await reversePostedBillingRun(
          context.db,
          input,
          context.session.user.id,
        );
      } catch (error) {
        throw toRpcError(error);
      }
    }),
};
