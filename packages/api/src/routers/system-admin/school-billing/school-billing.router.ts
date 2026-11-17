import { BILLING_PERIOD_DAYS } from '@campuspilot/db/feature-flags/catalogue';
import { schoolTable } from '@campuspilot/db/schema/school';
import { schoolBillingPeriodTable } from '@campuspilot/db/schema/school-billing';
import { SYSTEM_ACTIONS } from '@campuspilot/opa/policies/system';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';

import {
  addBillingPeriodsToSchool,
  billingConflictOf,
  listBillingPeriods,
  listSchoolInvoices,
  listSubscriptionPrices,
  lockSchool,
  parseTrialEnd,
  readBillingPeriod,
  readCoveredUntil,
  setSubscriptionPrice,
  startTrialPeriod,
  voidSchoolInvoice,
} from '../../../billing/billing.service';
import type { DatabaseExecutor } from '@campuspilot/db';
import { rpcError, toRpcError } from '../../../errors';
import { protectedProcedure } from '../../../index';
import { requireSystemPermission } from '../../../permissions/system';
import { schoolIdInputSchema } from '../school/school.dto';
import {
  addSchoolBillingPeriodsInputSchema,
  endSchoolBillingPeriodInputSchema,
  schoolBillingDtoSchema,
  schoolBillingPeriodDtoSchema,
  setSubscriptionPriceInputSchema,
  startSchoolTrialInputSchema,
  subscriptionPriceDtoSchema,
  updateSchoolTrialInputSchema,
  voidSchoolInvoiceInputSchema,
} from './school-billing.dto';

/** The school's period with that id; NOT_FOUND when it has none. */
async function requirePeriod(db: DatabaseExecutor, schoolId: string, periodId: string) {
  const period = await readBillingPeriod(db, schoolId, periodId);
  if (!period) throw rpcError.notFound('Billing period');
  return period;
}

/** A school's periods, invoices and coverage, as the admin app shows them. */
async function readSchoolBilling(db: DatabaseExecutor, schoolId: string) {
  const [periods, invoices, covered] = await Promise.all([
    listBillingPeriods(db, schoolId),
    listSchoolInvoices(db, schoolId),
    readCoveredUntil(db, [schoolId]),
  ]);
  return schoolBillingDtoSchema.parse({ periods, invoices, coveredUntil: covered.get(schoolId) ?? null });
}

const hidden = (access: 'read' | 'write', destructive = false) =>
  ({ mcp: { exposure: 'hidden', access, destructive, module: 'platform' } }) as const;

/**
 * A school's billing (docs/school-billing.md): trials, paid and
 * complimentary periods of 28 days, the invoices that paid for them, and the
 * price of a period per tier. Every procedure is hidden from MCP: what a
 * school has and pays is a human platform decision, made in the admin app.
 */
export const schoolBillingRouter = {
  getSchoolBilling: protectedProcedure
    .route({
      summary: "Get a school's billing",
      description:
        "Every billing period (trial, paid or complimentary) and invoice of a school, newest first, and until when its periods cover it. Requires system-administrator permission.",
      tags: ['System Admin', 'Billing'],
    })
    .meta(hidden('read'))
    .input(schoolIdInputSchema)
    .use(requireSystemPermission(SYSTEM_ACTIONS.READ_SCHOOL))
    .output(schoolBillingDtoSchema)
    .handler(async ({ context, input }) => {
      try {
        const [school] = await context.db.select({ id: schoolTable.id }).from(schoolTable).where(eq(schoolTable.id, input.id)).limit(1);
        if (!school) throw rpcError.notFound('School');
        return await readSchoolBilling(context.db, school.id);
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  startSchoolTrial: protectedProcedure
    .route({
      summary: 'Start a trial for a school',
      description:
        "Give a school a trial of a tier, starting now and ending at endsAt (in the future, at most a year ahead). While it runs the school has the higher of its standing tier and the trial's tier; it ends by itself. Refused while the school has an active billing period. Requires system-administrator permission.",
      tags: ['System Admin', 'Billing'],
    })
    .meta(hidden('write'))
    .input(startSchoolTrialInputSchema)
    .use(requireSystemPermission(SYSTEM_ACTIONS.UPDATE_SCHOOL))
    .output(schoolBillingPeriodDtoSchema)
    .handler(async ({ context, input }) => {
      try {
        const endsAt = parseTrialEnd(input.endsAt);
        return await context.db.transaction(async (transaction) => {
          await lockSchool(transaction, input.id);
          return await startTrialPeriod(transaction, { schoolId: input.id, tier: input.tier, endsAt, createdBy: context.session.user.id });
        });
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  updateSchoolTrial: protectedProcedure
    .route({
      summary: "Change a school's trial",
      description:
        "Change the tier or the end of a school's active trial (extend or shorten it; the end must stay in the future). Paid and complimentary periods cannot be changed, only ended or voided. Requires system-administrator permission.",
      tags: ['System Admin', 'Billing'],
    })
    .meta(hidden('write', true))
    .input(updateSchoolTrialInputSchema)
    .use(requireSystemPermission(SYSTEM_ACTIONS.UPDATE_SCHOOL))
    .output(schoolBillingPeriodDtoSchema)
    .handler(async ({ context, input }) => {
      try {
        return await context.db.transaction(async (transaction) => {
          await lockSchool(transaction, input.id);
          const period = await requirePeriod(transaction, input.id, input.periodId);
          if (period.kind !== 'trial') throw rpcError.badRequest('Only a trial can be changed. End or void a paid period instead.');
          if (!period.active) throw rpcError.conflict('This trial has ended. Start a new trial instead.');
          const endsAt = input.endsAt === undefined ? undefined : parseTrialEnd(input.endsAt, period.startsAt);
          try {
            await transaction
              .update(schoolBillingPeriodTable)
              .set({ tier: input.tier, endsAt, updatedAt: sql`now()` })
              .where(eq(schoolBillingPeriodTable.id, period.id));
          } catch (error) {
            throw billingConflictOf(error) ?? error;
          }
          return await requirePeriod(transaction, input.id, period.id);
        });
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  endSchoolBillingPeriod: protectedProcedure
    .route({
      summary: "End a school's billing period now",
      description:
        "End a school's active billing period (a trial, paid or complimentary period) now. The school then has its standing tier, the next period if one starts at once, or no plan (read-only). Its invoice, if any, is unchanged; void it to record a refund. Ending a period that is already over changes nothing. Requires system-administrator permission.",
      tags: ['System Admin', 'Billing'],
    })
    .meta(hidden('write', true))
    .input(endSchoolBillingPeriodInputSchema)
    .use(requireSystemPermission(SYSTEM_ACTIONS.UPDATE_SCHOOL))
    .output(schoolBillingPeriodDtoSchema)
    .handler(async ({ context, input }) => {
      try {
        return await context.db.transaction(async (transaction) => {
          await lockSchool(transaction, input.id);
          const period = await requirePeriod(transaction, input.id, input.periodId);
          // Only an active period is ended: one that is over keeps its own end,
          // so `ended_at` always lies within the period's time.
          if (!period.active) return period;
          await transaction
            .update(schoolBillingPeriodTable)
            .set({ endedAt: sql`now()`, endedBy: context.session.user.id, updatedAt: sql`now()` })
            .where(eq(schoolBillingPeriodTable.id, period.id));
          return await requirePeriod(transaction, input.id, period.id);
        });
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  addSchoolBillingPeriods: protectedProcedure
    .route({
      summary: 'Add paid or complimentary periods to a school',
      description:
        "Give a school 1 to 13 consecutive 28-day periods of a tier: paid (recording the payment as an invoice, at the tier's price × periods unless an amount is given) or complimentary. They start after the school's current coverage, or now (cutting the active period short). Requires system-administrator permission.",
      tags: ['System Admin', 'Billing'],
    })
    .meta(hidden('write'))
    .input(addSchoolBillingPeriodsInputSchema)
    .use(requireSystemPermission(SYSTEM_ACTIONS.UPDATE_SCHOOL))
    .output(schoolBillingDtoSchema)
    .handler(async ({ context, input }) => {
      try {
        return await context.db.transaction(async (transaction) => {
          await lockSchool(transaction, input.id);
          await addBillingPeriodsToSchool(transaction, {
            schoolId: input.id,
            kind: input.kind,
            tier: input.tier,
            periodCount: input.periodCount,
            start: input.start,
            createdBy: context.session.user.id,
            payment:
              input.kind === 'paid'
                ? { amountMinor: input.amountMinor, paymentReference: input.paymentReference, note: input.note }
                : undefined,
          });
          return await readSchoolBilling(transaction, input.id);
        });
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  voidSchoolInvoice: protectedProcedure
    .route({
      summary: "Void a school's invoice",
      description:
        'Void an invoice recorded by mistake or refunded: its periods that are not over end now or never begin. Periods already over stay as history. Voiding a void invoice changes nothing. Requires system-administrator permission.',
      tags: ['System Admin', 'Billing'],
    })
    .meta(hidden('write', true))
    .input(voidSchoolInvoiceInputSchema)
    .use(requireSystemPermission(SYSTEM_ACTIONS.UPDATE_SCHOOL))
    .output(schoolBillingDtoSchema)
    .handler(async ({ context, input }) => {
      try {
        return await context.db.transaction(async (transaction) => {
          await lockSchool(transaction, input.id);
          await voidSchoolInvoice(transaction, { schoolId: input.id, invoiceId: input.invoiceId, voidedBy: context.session.user.id });
          return await readSchoolBilling(transaction, input.id);
        });
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  listSubscriptionPrices: protectedProcedure
    .route({
      summary: 'List subscription prices',
      description: 'Every price of a 28-day period per tier, the active ones first, with earlier prices kept as history. Requires system-administrator permission.',
      tags: ['System Admin', 'Billing'],
    })
    .meta(hidden('read'))
    .use(requireSystemPermission(SYSTEM_ACTIONS.LIST_SCHOOLS))
    .output(z.array(subscriptionPriceDtoSchema))
    .handler(async ({ context }) => {
      try {
        return z.array(subscriptionPriceDtoSchema).parse(await listSubscriptionPrices(context.db));
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  setSubscriptionPrice: protectedProcedure
    .route({
      summary: 'Set the price of a tier',
      description:
        'Set the price of one 28-day period of a tier, in paise. The earlier price is kept as history; invoices keep the price they were charged at. Requires system-administrator permission.',
      tags: ['System Admin', 'Billing'],
    })
    .meta(hidden('write', true))
    .input(setSubscriptionPriceInputSchema)
    .use(requireSystemPermission(SYSTEM_ACTIONS.UPDATE_SUBSCRIPTION_PRICES))
    .output(subscriptionPriceDtoSchema)
    .handler(async ({ context, input }) => {
      try {
        return await context.db.transaction(async (transaction) =>
          subscriptionPriceDtoSchema.parse(
            await setSubscriptionPrice(transaction, {
              tier: input.tier,
              unitAmountMinor: input.unitAmountMinor,
              periodDays: BILLING_PERIOD_DAYS,
              createdBy: context.session.user.id,
            }),
          ),
        );
      } catch (error) {
        throw toRpcError(error);
      }
    }),
};
