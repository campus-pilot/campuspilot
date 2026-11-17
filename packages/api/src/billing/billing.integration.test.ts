import { db } from '@campuspilot/db';
import { BILLING_PERIOD_DAYS, type SchoolTier } from '@campuspilot/db/feature-flags/catalogue';
import { schoolBillingPeriodTable } from '@campuspilot/db/schema/school-billing';
import { asc, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { expectRpcCode } from '../../test/finance/assertions';
import {
  createAdminSession,
  createSchoolStaffSession,
  createTestClient,
  createTestSchool,
  createTestSchoolTrial,
} from '../../test/fixtures';
import { schoolSpendWindow } from '../assistant/spend';
import { isSchoolNoPlanError } from '../school-access/school-access.contract';
import { addBillingPeriods, coveredUntil } from './billing.contract';

/**
 * School billing (docs/school-billing.md): 28-day periods, prices, invoices
 * paid by hand, and what the school and its AI limit see. Expiry is set up
 * with timestamps in the past, never by waiting.
 */

const DAY = 24 * 60 * 60 * 1000;
const PERIOD = BILLING_PERIOD_DAYS * DAY;
const daysFromNow = (days: number) => new Date(Date.now() + days * DAY);
const ms = (value: string | Date) => new Date(value).getTime();

const admin = async () => createTestClient(await createAdminSession());

/** Sets a price for every tier so paid periods can be recorded (each test sets its own amounts where it checks them). */
async function setPrices(client: Awaited<ReturnType<typeof admin>>, prices: Partial<Record<SchoolTier, number>> = { plus: 99_900, pro: 199_900, enterprise: 499_900 }) {
  for (const [tier, unitAmountMinor] of Object.entries(prices)) {
    await client.systemAdmin.setSubscriptionPrice({ tier: tier as SchoolTier, unitAmountMinor });
  }
}

const periodsOf = (schoolId: string) =>
  db.select().from(schoolBillingPeriodTable).where(eq(schoolBillingPeriodTable.schoolId, schoolId)).orderBy(asc(schoolBillingPeriodTable.startsAt));

describe('coveredUntil', () => {
  const at = (day: number) => new Date(Date.UTC(2027, 0, 1) + day * DAY);
  it('walks back-to-back periods from now and stops at a gap', () => {
    const periods = [
      { startsAt: at(-10), endsAt: at(18) },
      { startsAt: at(18), endsAt: at(46) },
      { startsAt: at(50), endsAt: at(78) },
    ];
    expect(coveredUntil(periods, at(0))).toEqual(at(46));
    expect(coveredUntil(periods, at(47))).toBeNull();
    expect(coveredUntil([], at(0))).toBeNull();
  });

  it('counts periods in exact 28-day steps', () => {
    expect(addBillingPeriods(at(0), 3)).toEqual(at(84));
  });
});

describe('subscription prices', () => {
  it('keep earlier prices as history with one active price per tier, and only administrators set them', async () => {
    const client = await admin();
    await client.systemAdmin.setSubscriptionPrice({ tier: 'pro', unitAmountMinor: 150_000 });
    const second = await client.systemAdmin.setSubscriptionPrice({ tier: 'pro', unitAmountMinor: 180_000 });
    const pro = (await client.systemAdmin.listSubscriptionPrices()).filter(({ tier }) => tier === 'pro');
    expect(pro.filter(({ active }) => active)).toMatchObject([{ id: second.id, unitAmountMinor: 180_000, periodDays: 28, currency: 'INR' }]);
    expect(pro.length).toBeGreaterThanOrEqual(2);

    const school = await createTestSchool();
    const { session } = await createSchoolStaffSession(school.id, [{ role: 'principal', meta: null }]);
    await expectRpcCode(createTestClient(session).systemAdmin.setSubscriptionPrice({ tier: 'pro', unitAmountMinor: 1 }), 'FORBIDDEN');
  });
});

describe('systemAdmin.addSchoolBillingPeriods', () => {
  it('records a payment for several periods ahead after the trial, at the price unless an amount is given', async () => {
    const client = await admin();
    await setPrices(client, { pro: 200_000 });
    const school = await createTestSchool({ tier: null });
    const trial = await createTestSchoolTrial({ schoolId: school.id, tier: 'plus', endsAt: daysFromNow(10) });

    const billing = await client.systemAdmin.addSchoolBillingPeriods({
      id: school.id,
      kind: 'paid',
      tier: 'pro',
      periodCount: 3,
      start: 'after_current',
      paymentReference: 'UPI 1234',
    });
    expect(billing.invoices).toMatchObject([
      { status: 'paid', tier: 'pro', periodCount: 3, unitAmountMinor: 200_000, amountMinor: 600_000, provider: 'manual', paymentReference: 'UPI 1234' },
    ]);
    const [invoice] = billing.invoices;
    // The trial is kept; the paid periods follow it back to back.
    expect(ms(invoice!.periodStart)).toBe(trial.endsAt.getTime());
    expect(ms(invoice!.periodEnd)).toBe(trial.endsAt.getTime() + 3 * PERIOD);
    const periods = await periodsOf(school.id);
    expect(periods.map(({ kind, tier }) => [kind, tier])).toEqual([
      ['trial', 'plus'],
      ['paid', 'pro'],
      ['paid', 'pro'],
      ['paid', 'pro'],
    ]);
    expect(ms(billing.coveredUntil!)).toBe(ms(invoice!.periodEnd));

    // A discounted amount is stored as given, beside the catalogue price.
    const discounted = await client.systemAdmin.addSchoolBillingPeriods({
      id: school.id, kind: 'paid', tier: 'pro', periodCount: 1, start: 'after_current', amountMinor: 150_000,
    });
    expect(discounted.invoices[0]).toMatchObject({ amountMinor: 150_000, unitAmountMinor: 200_000 });
    expect(ms(discounted.invoices[0]!.periodStart)).toBe(ms(invoice!.periodEnd));
  });

  it('starts now when asked, cutting the trial short, and the school has the paid tier at once', async () => {
    const client = await admin();
    await setPrices(client);
    const school = await createTestSchool({ tier: null });
    const trial = await createTestSchoolTrial({ schoolId: school.id, tier: 'plus', endsAt: daysFromNow(20) });

    await client.systemAdmin.addSchoolBillingPeriods({ id: school.id, kind: 'paid', tier: 'enterprise', periodCount: 1, start: 'now' });
    const [cut, paid] = await periodsOf(school.id);
    expect(cut).toMatchObject({ id: trial.id });
    expect(cut!.endedAt).not.toBeNull();
    expect(paid).toMatchObject({ kind: 'paid', tier: 'enterprise' });
    expect(await client.systemAdmin.getSchool({ id: school.id })).toMatchObject({ planTier: 'enterprise', planSource: 'paid' });

    // Starting now again would overlap the periods already lined up: refused.
    await client.systemAdmin.addSchoolBillingPeriods({ id: school.id, kind: 'paid', tier: 'enterprise', periodCount: 1, start: 'after_current' });
    await expectRpcCode(
      client.systemAdmin.addSchoolBillingPeriods({ id: school.id, kind: 'paid', tier: 'pro', periodCount: 1, start: 'now' }),
      'CONFLICT',
    );
  });

  it('gives complimentary periods without an invoice, and needs a price for paid ones', async () => {
    const client = await admin();
    const school = await createTestSchool({ tier: null });
    const billing = await client.systemAdmin.addSchoolBillingPeriods({ id: school.id, kind: 'complimentary', tier: 'pro', periodCount: 2, start: 'after_current' });
    expect(billing.invoices).toEqual([]);
    expect(billing.periods.map(({ kind, invoiceId }) => [kind, invoiceId])).toEqual([
      ['complimentary', null],
      ['complimentary', null],
    ]);
    expect(await client.systemAdmin.getSchool({ id: school.id })).toMatchObject({ planTier: 'pro', planSource: 'complimentary' });
  });

  it('is for platform administrators only', async () => {
    const school = await createTestSchool({ tier: null });
    const { session } = await createSchoolStaffSession(school.id, [{ role: 'principal', meta: null }]);
    await expectRpcCode(
      createTestClient(session).systemAdmin.addSchoolBillingPeriods({ id: school.id, kind: 'complimentary', tier: 'pro', periodCount: 1, start: 'now' }),
      'FORBIDDEN',
    );
  });
});

describe('when periods run out', () => {
  it('makes the school read-only the moment its last paid period ends (no grace)', async () => {
    const client = await admin();
    await setPrices(client);
    const school = await createTestSchool({ tier: null });
    await client.systemAdmin.addSchoolBillingPeriods({ id: school.id, kind: 'paid', tier: 'pro', periodCount: 1, start: 'now' });
    const principal = createTestClient((await createSchoolStaffSession(school.id, [{ role: 'principal', meta: null }])).session);
    await principal.school.updateSchool({ schoolId: school.id, name: `Paid ${randomUUID()}` });

    await db
      .update(schoolBillingPeriodTable)
      .set({ startsAt: daysFromNow(-30), endsAt: daysFromNow(-2) })
      .where(eq(schoolBillingPeriodTable.schoolId, school.id));
    const error = await principal.school.updateSchool({ schoolId: school.id, name: 'Lapsed' }).catch((caught: unknown) => caught);
    expect(isSchoolNoPlanError(error)).toBe(true);
  });

  it('tells the school when its coverage ends, counting periods paid ahead', async () => {
    const client = await admin();
    await setPrices(client);
    const school = await createTestSchool({ tier: null });
    const billing = await client.systemAdmin.addSchoolBillingPeriods({ id: school.id, kind: 'paid', tier: 'pro', periodCount: 2, start: 'now' });
    const principal = createTestClient((await createSchoolStaffSession(school.id, [{ role: 'principal', meta: null }])).session);
    const [mine] = await principal.school.listMySchools();
    expect(mine).toMatchObject({ planSource: 'paid', hasActivePlan: true });
    expect(ms(mine!.planEndsAt!)).toBe(ms(billing.coveredUntil!));
  });
});

describe('systemAdmin.voidSchoolInvoice', () => {
  it('ends the periods it paid for that are not over, and leaves a void invoice', async () => {
    const client = await admin();
    await setPrices(client);
    const school = await createTestSchool({ tier: null });
    const billing = await client.systemAdmin.addSchoolBillingPeriods({ id: school.id, kind: 'paid', tier: 'pro', periodCount: 2, start: 'now' });
    const invoiceId = billing.invoices[0]!.id;

    const after = await client.systemAdmin.voidSchoolInvoice({ id: school.id, invoiceId });
    expect(after.invoices[0]).toMatchObject({ id: invoiceId, status: 'void' });
    expect(after.coveredUntil).toBeNull();
    expect(await client.systemAdmin.getSchool({ id: school.id })).toMatchObject({ planTier: null, period: null });
    // The future period never began: an empty span.
    const [, future] = await periodsOf(school.id);
    expect(future!.endedAt!.getTime()).toBe(future!.startsAt.getTime());
    // Voiding again changes nothing; another school's invoice is not found.
    await client.systemAdmin.voidSchoolInvoice({ id: school.id, invoiceId });
    const other = await createTestSchool({ tier: null });
    await expectRpcCode(client.systemAdmin.voidSchoolInvoice({ id: other.id, invoiceId }), 'NOT_FOUND');
  });
});

describe('the AI limit window', () => {
  it('is the active billing period, and the IST month for a school on a standing tier alone', async () => {
    const onTrial = await createTestSchool({ tier: null });
    const trial = await createTestSchoolTrial({ schoolId: onTrial.id, tier: 'plus', startsAt: daysFromNow(-3), endsAt: daysFromNow(25) });
    expect(await schoolSpendWindow(db, onTrial.id)).toEqual({ key: `period:${trial.id}`, start: trial.startsAt, end: trial.endsAt });

    const standing = await createTestSchool({ tier: 'pro' });
    const window = await schoolSpendWindow(db, standing.id, new Date('2027-03-15T12:00:00+05:30'));
    expect(window.key).toBe('2027-03');
  });
});

describe('deleting a school', () => {
  it('takes its periods and invoices with it', async () => {
    const client = await admin();
    await setPrices(client);
    const school = await createTestSchool({ tier: null });
    await client.systemAdmin.addSchoolBillingPeriods({ id: school.id, kind: 'paid', tier: 'pro', periodCount: 2, start: 'now' });
    await client.systemAdmin.deleteSchool({ id: school.id });
    expect(await periodsOf(school.id)).toEqual([]);
  });
});
