import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import {
  BILLING_CURRENCIES,
  BILLING_PERIOD_KINDS,
  BILLING_PROVIDERS,
  SCHOOL_INVOICE_STATUSES,
  SCHOOL_TIERS,
} from "../feature-flags/catalogue";
import { generateId } from "../id";
import { user } from "./auth";
import { schoolTable } from "./school";

/**
 * School billing (docs/school-billing.md). The tables mirror the objects of
 * a subscription payment provider (Stripe's Price, Invoice and the periods an
 * invoice pays for) so a provider can be connected later by writing the same
 * rows from its webhooks. Today every row is written by hand in the admin app
 * (`provider = 'manual'`).
 */

const inList = (values: readonly string[]) => sql.raw(values.map((value) => `'${value}'`).join(", "));

/**
 * The price of one billing period of a tier (Stripe's Price). Rows are never
 * changed: a new price is a new row and the earlier one is deactivated, so an
 * invoice always points at the price it was charged at. At most one active
 * price per tier and currency.
 */
export const subscriptionPriceTable = pgTable(
  "subscription_price",
  {
    id: text("id")
      .primaryKey()
      .$default(() => generateId("subscriptionPrice")),
    tier: text("tier", { enum: SCHOOL_TIERS }).notNull(),
    currency: text("currency", { enum: BILLING_CURRENCIES }).notNull(),
    /** The price of one period in the currency's smallest unit (paise), as payment providers store amounts. */
    unitAmountMinor: integer("unit_amount_minor").notNull(),
    /** How long one period of this price lasts, in days (`BILLING_PERIOD_DAYS` when it was created). */
    periodDays: integer("period_days").notNull(),
    active: boolean("active").notNull().default(true),
    /** The provider's id of the same price once a provider is connected; null for manual prices. */
    providerPriceId: text("provider_price_id").unique(),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("subscription_price_one_active_key")
      .on(table.tier, table.currency)
      .where(sql`${table.active}`),
    index("subscription_price_created_by_idx").on(table.createdBy),
    check("subscription_price_tier_check", sql`${table.tier} in (${inList(SCHOOL_TIERS)})`),
    check("subscription_price_currency_check", sql`${table.currency} in (${inList(BILLING_CURRENCIES)})`),
    check("subscription_price_amount_check", sql`${table.unitAmountMinor} >= 0`),
    check("subscription_price_period_days_check", sql`${table.periodDays} > 0`),
  ],
);

/**
 * One payment for one or more consecutive billing periods of a tier
 * (Stripe's Invoice with one line of `quantity` periods). A manual invoice is
 * recorded once the money arrived, so it is `paid` from the start; `open`
 * exists for providers that bill before they collect. Voiding it (a mistake
 * or a refund) ends the periods it paid for.
 */
export const schoolInvoiceTable = pgTable(
  "school_invoice",
  {
    id: text("id")
      .primaryKey()
      .$default(() => generateId("schoolInvoice")),
    schoolId: text("school_id")
      .notNull()
      .references(() => schoolTable.id, { onDelete: "cascade" }),
    status: text("status", { enum: SCHOOL_INVOICE_STATUSES }).notNull(),
    tier: text("tier", { enum: SCHOOL_TIERS }).notNull(),
    /** The price charged; null only if it was deleted (never, today) or the amount was agreed outside the catalogue. */
    priceId: text("price_id").references(() => subscriptionPriceTable.id, { onDelete: "set null" }),
    currency: text("currency", { enum: BILLING_CURRENCIES }).notNull(),
    /** The catalogue price of one period at the time, in the smallest unit. */
    unitAmountMinor: integer("unit_amount_minor").notNull(),
    /** How many consecutive periods this invoice pays for. */
    periodCount: integer("period_count").notNull(),
    /** What was actually charged, in the smallest unit; may differ from `unit × count` (a discount the administrator gave). */
    amountMinor: integer("amount_minor").notNull(),
    /** The start of the first period and the end of the last one it pays for. */
    periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
    periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    voidedBy: text("voided_by").references(() => user.id, { onDelete: "set null" }),
    provider: text("provider", { enum: BILLING_PROVIDERS }).notNull().default("manual"),
    /** The provider's invoice id (for example Stripe's `in_…`); null for manual invoices. */
    providerInvoiceId: text("provider_invoice_id").unique(),
    /** How a manual payment was made, for the record (UPI reference, cheque number). */
    paymentReference: text("payment_reference"),
    note: text("note"),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("school_invoice_school_id_idx").on(table.schoolId, table.periodStart),
    index("school_invoice_price_id_idx").on(table.priceId),
    index("school_invoice_created_by_idx").on(table.createdBy),
    index("school_invoice_voided_by_idx").on(table.voidedBy),
    check("school_invoice_status_check", sql`${table.status} in (${inList(SCHOOL_INVOICE_STATUSES)})`),
    check("school_invoice_tier_check", sql`${table.tier} in (${inList(SCHOOL_TIERS)})`),
    check("school_invoice_currency_check", sql`${table.currency} in (${inList(BILLING_CURRENCIES)})`),
    check("school_invoice_provider_check", sql`${table.provider} in (${inList(BILLING_PROVIDERS)})`),
    check("school_invoice_amounts_check", sql`${table.unitAmountMinor} >= 0 and ${table.amountMinor} >= 0 and ${table.periodCount} >= 1`),
    check("school_invoice_period_check", sql`${table.periodEnd} > ${table.periodStart}`),
    check("school_invoice_paid_check", sql`(${table.status} = 'open') = (${table.paidAt} is null)`),
    check("school_invoice_void_check", sql`(${table.status} = 'void') = (${table.voidedAt} is not null)`),
  ],
);

/**
 * One billing period of a school: the span during which the school has a
 * tier because of a trial, a payment or a gift from CampusPilot
 * (docs/school-billing.md). One row per period, so the history is kept. A
 * period is **active** at time t when
 * `starts_at <= t < least(ends_at, coalesce(ended_at, 'infinity'))`: it ends
 * by itself at `ends_at` without any job, because every read compares with
 * `now()`. While active, the school's plan is the higher of its standing tier
 * (`school.tier`) and the period's tier (`resolveSchoolPlan`).
 *
 * Periods of one school never overlap: an EXCLUDE constraint (btree_gist)
 * over `tstzrange(starts_at, coalesce(ended_at, ends_at))` added by migration
 * (drizzle cannot declare it, so it is not in this file). A period ended
 * before it began (`ended_at = starts_at`, a voided future period) is an
 * empty range and overlaps nothing.
 *
 * Migration `0075_school-self-creation.sql` renamed `school_trial` to this
 * table; earlier trials are `kind = 'trial'` rows with their `trial_…` ids.
 */
export const schoolBillingPeriodTable = pgTable(
  "school_billing_period",
  {
    id: text("id")
      .primaryKey()
      .$default(() => generateId("schoolBillingPeriod")),
    /** A period is the school's own history and goes with it. */
    schoolId: text("school_id")
      .notNull()
      .references(() => schoolTable.id, { onDelete: "cascade" }),
    /** Why the school has the tier in this period: a free trial, a payment, or a gift from CampusPilot. */
    kind: text("kind", { enum: BILLING_PERIOD_KINDS }).notNull(),
    /** The tier the school has while the period is active (unless its standing tier is higher). */
    tier: text("tier", { enum: SCHOOL_TIERS }).notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull().defaultNow(),
    /** When the period ends by itself. */
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    /** When it was cut short (ended early, its invoice voided, or replaced by a payment starting now); null otherwise. */
    endedAt: timestamp("ended_at", { withTimezone: true }),
    /** The invoice that paid for it; set exactly for `paid` periods (CHECK). */
    invoiceId: text("invoice_id").references(() => schoolInvoiceTable.id, { onDelete: "no action" }),
    /** Who added it: an administrator, or the person who created the school themselves (its first trial). */
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    /** The administrator who cut it short; null when it was not or that account is deleted. */
    endedBy: text("ended_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("school_billing_period_school_id_idx").on(table.schoolId, table.startsAt),
    index("school_billing_period_invoice_id_idx").on(table.invoiceId),
    index("school_billing_period_created_by_idx").on(table.createdBy),
    index("school_billing_period_ended_by_idx").on(table.endedBy),
    check("school_billing_period_kind_check", sql`${table.kind} in (${inList(BILLING_PERIOD_KINDS)})`),
    check("school_billing_period_tier_check", sql`${table.tier} in (${inList(SCHOOL_TIERS)})`),
    check("school_billing_period_ends_after_start_check", sql`${table.endsAt} > ${table.startsAt}`),
    check("school_billing_period_ended_after_start_check", sql`${table.endedAt} >= ${table.startsAt}`),
    check("school_billing_period_invoice_check", sql`(${table.kind} = 'paid') = (${table.invoiceId} is not null)`),
  ],
);

export type SchoolBillingPeriodRow = typeof schoolBillingPeriodTable.$inferSelect;
export type SchoolInvoiceRow = typeof schoolInvoiceTable.$inferSelect;
export type SubscriptionPriceRow = typeof subscriptionPriceTable.$inferSelect;
