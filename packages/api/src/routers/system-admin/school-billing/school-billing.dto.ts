import {
  BILLING_CURRENCIES,
  BILLING_PROVIDERS,
  SCHOOL_INVOICE_STATUSES,
  billingPeriodKindSchema,
  schoolTierSchema,
} from '@campuspilot/db/feature-flags/catalogue';
import { z } from 'zod';

import { BILLING_START_OPTIONS, MAX_PERIODS_PER_INVOICE } from '../../../billing/billing.contract';
import { trialEndsAtSchema } from '../school/school.dto';

/**
 * One billing period of a school (docs/school-billing.md). `active` is
 * decided with the database's clock when the period is read: a period is
 * active while `startsAt <= now < min(endsAt, endedAt)`.
 */
export const schoolBillingPeriodDtoSchema = z.object({
  id: z.string(),
  schoolId: z.string(),
  kind: billingPeriodKindSchema,
  tier: schoolTierSchema,
  startsAt: z.date(),
  /** When the period ends by itself. */
  endsAt: z.date(),
  /** When it was cut short (ended early, voided or replaced); null otherwise. */
  endedAt: z.date().nullable(),
  /** The invoice that paid for it; set for paid periods only. */
  invoiceId: z.string().nullable(),
  active: z.boolean(),
  createdBy: z.string().nullable(),
  endedBy: z.string().nullable(),
  createdAt: z.date(),
});
export type SchoolBillingPeriodDto = z.infer<typeof schoolBillingPeriodDtoSchema>;

/** One invoice of a school: what was charged for which periods, and how it was paid. */
export const schoolInvoiceDtoSchema = z.object({
  id: z.string(),
  schoolId: z.string(),
  status: z.enum(SCHOOL_INVOICE_STATUSES),
  tier: schoolTierSchema,
  priceId: z.string().nullable(),
  currency: z.enum(BILLING_CURRENCIES),
  /** The catalogue price of one period at the time, in paise. */
  unitAmountMinor: z.number().int(),
  periodCount: z.number().int(),
  /** What was charged, in paise. */
  amountMinor: z.number().int(),
  periodStart: z.date(),
  periodEnd: z.date(),
  paidAt: z.date().nullable(),
  voidedAt: z.date().nullable(),
  provider: z.enum(BILLING_PROVIDERS),
  providerInvoiceId: z.string().nullable(),
  paymentReference: z.string().nullable(),
  note: z.string().nullable(),
  createdBy: z.string().nullable(),
  createdAt: z.date(),
});
export type SchoolInvoiceDto = z.infer<typeof schoolInvoiceDtoSchema>;

/** A school's billing as the admin app shows it. */
export const schoolBillingDtoSchema = z.object({
  /** Every period, newest first. */
  periods: z.array(schoolBillingPeriodDtoSchema),
  /** Every invoice, newest first. */
  invoices: z.array(schoolInvoiceDtoSchema),
  /** Until when back-to-back periods cover the school from now; null when nothing covers it now. */
  coveredUntil: z.date().nullable(),
  /** When the last period already booked ends (past any gap); null when nothing is booked. Paid periods added "after the current coverage" start here. */
  bookedUntil: z.date().nullable(),
});
export type SchoolBillingDto = z.infer<typeof schoolBillingDtoSchema>;

/** The system admin router names the school `id`, like `getSchool`. */
export const startSchoolTrialInputSchema = z.object({
  id: z.string().min(1),
  tier: schoolTierSchema,
  endsAt: trialEndsAtSchema,
});

export const updateSchoolTrialInputSchema = z
  .object({
    id: z.string().min(1),
    periodId: z.string().min(1),
    tier: schoolTierSchema.optional(),
    endsAt: trialEndsAtSchema.optional(),
  })
  .refine(({ tier, endsAt }) => tier !== undefined || endsAt !== undefined, {
    message: 'Give the trial a new tier or a new end.',
  });

export const endSchoolBillingPeriodInputSchema = z.object({
  id: z.string().min(1),
  periodId: z.string().min(1),
});

/**
 * Adds consecutive periods: paid (recording the payment as an invoice) or
 * complimentary (a gift, no invoice).
 */
export const addSchoolBillingPeriodsInputSchema = z.discriminatedUnion('kind', [
  z.object({
    id: z.string().min(1),
    kind: z.literal('paid'),
    tier: schoolTierSchema,
    periodCount: z.number().int().min(1).max(MAX_PERIODS_PER_INVOICE),
    start: z.enum(BILLING_START_OPTIONS),
    /** What was charged, in paise; the tier's price × periods when left out. */
    amountMinor: z.number().int().min(0).max(1_000_000_000).optional(),
    /** How it was paid (UPI reference, cheque number). */
    paymentReference: z.string().trim().max(200).optional(),
    note: z.string().trim().max(1000).optional(),
  }),
  z.object({
    id: z.string().min(1),
    kind: z.literal('complimentary'),
    tier: schoolTierSchema,
    periodCount: z.number().int().min(1).max(MAX_PERIODS_PER_INVOICE),
    start: z.enum(BILLING_START_OPTIONS),
  }),
]);

export const voidSchoolInvoiceInputSchema = z.object({
  id: z.string().min(1),
  invoiceId: z.string().min(1),
});

/** The price of one period of a tier. */
export const subscriptionPriceDtoSchema = z.object({
  id: z.string(),
  tier: schoolTierSchema,
  currency: z.enum(BILLING_CURRENCIES),
  unitAmountMinor: z.number().int(),
  periodDays: z.number().int(),
  active: z.boolean(),
  providerPriceId: z.string().nullable(),
  createdBy: z.string().nullable(),
  createdAt: z.date(),
});
export type SubscriptionPriceDto = z.infer<typeof subscriptionPriceDtoSchema>;

export const setSubscriptionPriceInputSchema = z.object({
  tier: schoolTierSchema,
  /** The price of one period in paise. */
  unitAmountMinor: z.number().int().min(0).max(1_000_000_000),
});
