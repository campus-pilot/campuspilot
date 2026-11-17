import type { DatabaseExecutor } from '@campuspilot/db';
import type { BillingPeriodKind, SchoolTier } from '@campuspilot/db/feature-flags/catalogue';
import { activeBillingPeriodCondition, billingPeriodEnd } from '@campuspilot/db/feature-flags/store';
import { schoolTable } from '@campuspilot/db/schema/school';
import {
  schoolBillingPeriodTable,
  schoolInvoiceTable,
  subscriptionPriceTable,
} from '@campuspilot/db/schema/school-billing';
import { and, asc, desc, eq, gt, inArray, sql } from 'drizzle-orm';

import { rpcError } from '../errors';
import { MAX_TRIAL_DAYS } from '../routers/system-admin/school/school.dto';
import { addBillingPeriods, coveredUntil, type BillingStart } from './billing.contract';

/**
 * School billing (docs/school-billing.md): billing periods, the prices of a
 * period per tier, and the invoices that pay for periods. Every write locks
 * the school row first ({@link lockSchool}), so two administrators changing
 * one school are applied one after the other; the period table's EXCLUDE
 * constraint still refuses an overlap that slipped past
 * ({@link billingConflictOf}).
 *
 * Written so a payment provider can be connected later without changing the
 * model: a provider webhook (Stripe's `invoice.paid`) would call
 * {@link addBillingPeriods} with `provider: 'stripe'` and its invoice id
 * instead of an administrator recording a manual payment.
 */

/** Locks the school row for the transaction; NOT_FOUND for a school that does not exist. */
export async function lockSchool(db: DatabaseExecutor, schoolId: string): Promise<void> {
  const [school] = await db.select({ id: schoolTable.id }).from(schoolTable).where(eq(schoolTable.id, schoolId)).limit(1).for('update');
  if (!school) throw rpcError.notFound('School');
}

/** A database refusal of a period as the API answers it, or null for any other error. */
export function billingConflictOf(error: unknown) {
  let current: unknown = error;
  while (typeof current === 'object' && current !== null) {
    if ('code' in current && current.code === '23P01') {
      return rpcError.conflict('This school already has a billing period at that time.', current);
    }
    // The end is checked against this server's clock, the start is the database's now(): a clock difference can
    // still put the end first. Said as the same mistake the checks report, not as a server error.
    if ('code' in current && current.code === '23514' && 'constraint' in current && current.constraint === 'school_billing_period_ends_after_start_check') {
      return rpcError.badRequest('The period must end in the future.', current);
    }
    current = 'cause' in current ? current.cause : undefined;
  }
  return null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Parses a submitted trial end and checks it: in the future, after the
 * trial's start (when known), and at most {@link MAX_TRIAL_DAYS} days from now.
 */
export function parseTrialEnd(endsAt: string, startsAt: Date | null = null): Date {
  const end = new Date(endsAt);
  const now = Date.now();
  if (end.getTime() <= now) throw rpcError.badRequest('The trial must end in the future.');
  if (startsAt !== null && end.getTime() <= startsAt.getTime()) throw rpcError.badRequest('The trial must end after it starts.');
  if (end.getTime() > now + MAX_TRIAL_DAYS * DAY_MS) {
    throw rpcError.badRequest(`A trial can run for at most ${MAX_TRIAL_DAYS} days from now.`);
  }
  return end;
}

/** The columns of a period as the admin app reads it, with `active` and the real end decided by the database. */
export const billingPeriodColumns = {
  id: schoolBillingPeriodTable.id,
  schoolId: schoolBillingPeriodTable.schoolId,
  kind: schoolBillingPeriodTable.kind,
  tier: schoolBillingPeriodTable.tier,
  startsAt: schoolBillingPeriodTable.startsAt,
  endsAt: schoolBillingPeriodTable.endsAt,
  endedAt: schoolBillingPeriodTable.endedAt,
  invoiceId: schoolBillingPeriodTable.invoiceId,
  active: sql<boolean>`${activeBillingPeriodCondition()}`,
  createdBy: schoolBillingPeriodTable.createdBy,
  endedBy: schoolBillingPeriodTable.endedBy,
  createdAt: schoolBillingPeriodTable.createdAt,
};

/** One period of a school, or null when the school has none with that id. */
export async function readBillingPeriod(db: DatabaseExecutor, schoolId: string, periodId: string) {
  const [period] = await db
    .select(billingPeriodColumns)
    .from(schoolBillingPeriodTable)
    .where(and(eq(schoolBillingPeriodTable.id, periodId), eq(schoolBillingPeriodTable.schoolId, schoolId)))
    .limit(1);
  return period ?? null;
}

/** Every period of a school, newest first. */
export async function listBillingPeriods(db: DatabaseExecutor, schoolId: string) {
  return db
    .select(billingPeriodColumns)
    .from(schoolBillingPeriodTable)
    .where(eq(schoolBillingPeriodTable.schoolId, schoolId))
    .orderBy(desc(schoolBillingPeriodTable.startsAt), desc(schoolBillingPeriodTable.id));
}

/** Every invoice of a school, newest first. */
export async function listSchoolInvoices(db: DatabaseExecutor, schoolId: string) {
  return db
    .select()
    .from(schoolInvoiceTable)
    .where(eq(schoolInvoiceTable.schoolId, schoolId))
    .orderBy(desc(schoolInvoiceTable.periodStart), desc(schoolInvoiceTable.createdAt));
}

/**
 * Until when each school is covered by back-to-back periods from now
 * ({@link coveredUntil}); a school missing from the map is not covered now.
 * Reads only periods that have not ended yet, and compares with the
 * database's clock like every plan read.
 */
export async function readCoveredUntil(db: DatabaseExecutor, schoolIds: readonly string[]): Promise<Map<string, Date>> {
  if (schoolIds.length === 0) return new Map();
  const rows = await db
    .select({
      schoolId: schoolBillingPeriodTable.schoolId,
      startsAt: schoolBillingPeriodTable.startsAt,
      endsAt: billingPeriodEnd(),
      now: sql<Date>`now()`,
    })
    .from(schoolBillingPeriodTable)
    .where(and(inArray(schoolBillingPeriodTable.schoolId, [...schoolIds]), gt(billingPeriodEnd(), sql`now()`)))
    .orderBy(asc(schoolBillingPeriodTable.startsAt));
  const bySchool = new Map<string, Array<{ startsAt: Date; endsAt: Date }>>();
  let now: Date | null = null;
  for (const row of rows) {
    now = new Date(row.now);
    bySchool.set(row.schoolId, [...(bySchool.get(row.schoolId) ?? []), { startsAt: new Date(row.startsAt), endsAt: new Date(row.endsAt) }]);
  }
  const result = new Map<string, Date>();
  for (const [schoolId, periods] of bySchool) {
    const until = now && coveredUntil(periods, now);
    if (until) result.set(schoolId, until);
  }
  return result;
}

/**
 * When the last period already booked for the school ends (the latest real
 * end still in the future), or null when nothing is booked. Equal to
 * {@link readCoveredUntil} while the periods run back to back; after a period
 * in the middle was ended or voided it is later, past the gap.
 */
export async function readBookedUntil(db: DatabaseExecutor, schoolId: string): Promise<Date | null> {
  const [row] = await db
    .select({ until: sql<string | Date | null>`max(${billingPeriodEnd()})` })
    .from(schoolBillingPeriodTable)
    .where(and(eq(schoolBillingPeriodTable.schoolId, schoolId), gt(billingPeriodEnd(), sql`now()`)));
  return row?.until ? new Date(row.until) : null;
}

/** Inserts one period, answering an overlap as CONFLICT. */
async function insertPeriods(
  db: DatabaseExecutor,
  rows: Array<typeof schoolBillingPeriodTable.$inferInsert>,
): Promise<string[]> {
  try {
    const created = await db.insert(schoolBillingPeriodTable).values(rows).returning({ id: schoolBillingPeriodTable.id });
    return created.map(({ id }) => id);
  } catch (error) {
    throw billingConflictOf(error) ?? error;
  }
}

/**
 * Starts a trial of `tier` now, ending at `endsAt`. CONFLICT when the school
 * already has an active period: an administrator changes or ends that one
 * instead. The caller holds the school row's lock.
 */
export async function startTrialPeriod(
  db: DatabaseExecutor,
  input: { schoolId: string; tier: SchoolTier; endsAt: Date; createdBy: string },
) {
  const [active] = await db
    .select({ id: schoolBillingPeriodTable.id })
    .from(schoolBillingPeriodTable)
    .where(and(eq(schoolBillingPeriodTable.schoolId, input.schoolId), activeBillingPeriodCondition()))
    .limit(1);
  if (active) throw rpcError.conflict('This school already has an active billing period. Change or end it instead.');
  // `starts_at` is the database's now(), the clock every read of the period compares with.
  const [id] = await insertPeriods(db, [
    { schoolId: input.schoolId, kind: 'trial', tier: input.tier, endsAt: input.endsAt, createdBy: input.createdBy },
  ]);
  const period = id && (await readBillingPeriod(db, input.schoolId, id));
  if (!period) throw rpcError.internal();
  return period;
}

/** The active price of a tier in INR; BAD_REQUEST when none is set. */
export async function requireActivePrice(db: DatabaseExecutor, tier: SchoolTier) {
  const [price] = await db
    .select()
    .from(subscriptionPriceTable)
    .where(and(eq(subscriptionPriceTable.tier, tier), eq(subscriptionPriceTable.currency, 'INR'), eq(subscriptionPriceTable.active, true)))
    .limit(1);
  if (!price) throw rpcError.badRequest('Set a price for this tier first (Pricing in the admin app).');
  return price;
}

export type AddBillingPeriodsInput = {
  schoolId: string;
  kind: Exclude<BillingPeriodKind, 'trial'>;
  tier: SchoolTier;
  periodCount: number;
  start: BillingStart;
  createdBy: string;
  /** For `paid` periods: what was charged and how it was paid. */
  payment?: {
    /** Charged in paise; the catalogue price × periods when left out. */
    amountMinor?: number;
    paymentReference?: string | null;
    note?: string | null;
    provider?: 'manual' | 'stripe';
    providerInvoiceId?: string | null;
  };
};

/**
 * Adds `periodCount` consecutive periods of `tier` to a school: paid (with
 * the invoice that paid for them) or complimentary (a gift, no invoice).
 *
 * `start: 'after_current'` begins right after the last period already booked
 * ({@link readBookedUntil}), or now when nothing is booked: paying ahead
 * never loses time already paid or on trial, and never collides with a
 * period booked past a gap. `start: 'now'` cuts the active
 * period short at now and begins at once (an upgrade from a trial); it is
 * refused while periods are already lined up after the active one, since
 * they would overlap (end or void them first). The caller holds the school
 * row's lock.
 */
export async function addBillingPeriodsToSchool(db: DatabaseExecutor, input: AddBillingPeriodsInput) {
  // The database's clock, which every period read compares with, to the
  // millisecond: periods are written with JavaScript dates, so the cut and the
  // next start must be the very same instant or they would overlap by microseconds.
  const clock = await db.execute<{ now: string | Date }>(sql`select date_trunc('milliseconds', now()) as now`);
  const nowDate = new Date(clock.rows[0]!.now);
  let startsAt: Date;
  if (input.start === 'now') {
    const [later] = await db
      .select({ id: schoolBillingPeriodTable.id })
      .from(schoolBillingPeriodTable)
      .where(and(eq(schoolBillingPeriodTable.schoolId, input.schoolId), gt(schoolBillingPeriodTable.startsAt, sql`now()`), gt(billingPeriodEnd(), schoolBillingPeriodTable.startsAt)))
      .limit(1);
    if (later) throw rpcError.conflict('This school already has periods lined up after the current one. End or void them first, or add these after the current coverage.');
    await db
      .update(schoolBillingPeriodTable)
      .set({ endedAt: sql`greatest(${schoolBillingPeriodTable.startsAt}, ${nowDate.toISOString()}::timestamptz)`, endedBy: input.createdBy, updatedAt: sql`now()` })
      .where(and(eq(schoolBillingPeriodTable.schoolId, input.schoolId), activeBillingPeriodCondition()));
    startsAt = nowDate;
  } else {
    // After everything already booked, so the new periods never collide with one
    // booked past a gap (a period in the middle that was ended or voided).
    startsAt = (await readBookedUntil(db, input.schoolId)) ?? nowDate;
  }
  const endsAt = addBillingPeriods(startsAt, input.periodCount);

  let invoiceId: string | null = null;
  if (input.kind === 'paid') {
    const price = await requireActivePrice(db, input.tier);
    const amountMinor = input.payment?.amountMinor ?? price.unitAmountMinor * input.periodCount;
    const [invoice] = await db
      .insert(schoolInvoiceTable)
      .values({
        schoolId: input.schoolId,
        status: 'paid',
        tier: input.tier,
        priceId: price.id,
        currency: price.currency,
        unitAmountMinor: price.unitAmountMinor,
        periodCount: input.periodCount,
        amountMinor,
        periodStart: startsAt,
        periodEnd: endsAt,
        paidAt: sql`now()`,
        provider: input.payment?.provider ?? 'manual',
        providerInvoiceId: input.payment?.providerInvoiceId ?? null,
        paymentReference: input.payment?.paymentReference || null,
        note: input.payment?.note || null,
        createdBy: input.createdBy,
      })
      .returning({ id: schoolInvoiceTable.id });
    if (!invoice) throw rpcError.internal();
    invoiceId = invoice.id;
  }

  await insertPeriods(
    db,
    Array.from({ length: input.periodCount }, (_, index) => ({
      schoolId: input.schoolId,
      kind: input.kind,
      tier: input.tier,
      startsAt: addBillingPeriods(startsAt, index),
      endsAt: addBillingPeriods(startsAt, index + 1),
      invoiceId,
      createdBy: input.createdBy,
    })),
  );
  return { invoiceId, startsAt, endsAt };
}

/**
 * Voids an invoice (a mistake or a refund): its periods that have not ended
 * yet end now, or never begin (`ended_at = starts_at`); periods already over
 * stay as history. Voiding a void invoice changes nothing. The caller holds
 * the school row's lock.
 */
export async function voidSchoolInvoice(db: DatabaseExecutor, input: { schoolId: string; invoiceId: string; voidedBy: string }) {
  const [invoice] = await db
    .select({ status: schoolInvoiceTable.status })
    .from(schoolInvoiceTable)
    .where(and(eq(schoolInvoiceTable.id, input.invoiceId), eq(schoolInvoiceTable.schoolId, input.schoolId)))
    .limit(1);
  if (!invoice) throw rpcError.notFound('Invoice');
  if (invoice.status === 'void') return;
  await db
    .update(schoolInvoiceTable)
    .set({ status: 'void', voidedAt: sql`now()`, voidedBy: input.voidedBy })
    .where(eq(schoolInvoiceTable.id, input.invoiceId));
  await db
    .update(schoolBillingPeriodTable)
    .set({
      endedAt: sql`greatest(${schoolBillingPeriodTable.startsAt}, now())`,
      endedBy: input.voidedBy,
      updatedAt: sql`now()`,
    })
    .where(and(eq(schoolBillingPeriodTable.invoiceId, input.invoiceId), gt(billingPeriodEnd(), sql`now()`)));
}

/** Every price, active first, then newest first. */
export async function listSubscriptionPrices(db: DatabaseExecutor) {
  return db
    .select()
    .from(subscriptionPriceTable)
    .orderBy(desc(subscriptionPriceTable.active), asc(subscriptionPriceTable.tier), desc(subscriptionPriceTable.createdAt));
}

/**
 * Sets the price of one period of a tier: the active price is deactivated
 * and a new one added, so invoices keep pointing at the price they were
 * charged at (prices are never edited, as with payment providers).
 */
export async function setSubscriptionPrice(
  db: DatabaseExecutor,
  input: { tier: SchoolTier; unitAmountMinor: number; periodDays: number; createdBy: string },
) {
  // Serialises two administrators setting the same tier's price.
  await db.execute(sql`select pg_advisory_xact_lock(hashtext(${`subscription_price:${input.tier}:INR`}))`);
  await db
    .update(subscriptionPriceTable)
    .set({ active: false })
    .where(and(eq(subscriptionPriceTable.tier, input.tier), eq(subscriptionPriceTable.currency, 'INR'), eq(subscriptionPriceTable.active, true)));
  const [price] = await db
    .insert(subscriptionPriceTable)
    .values({ tier: input.tier, currency: 'INR', unitAmountMinor: input.unitAmountMinor, periodDays: input.periodDays, createdBy: input.createdBy })
    .returning();
  if (!price) throw rpcError.internal();
  return price;
}
