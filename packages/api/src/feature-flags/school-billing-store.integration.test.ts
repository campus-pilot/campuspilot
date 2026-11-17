import { db } from '@campuspilot/db';
import { getSchoolFeatureFlags, isSchoolFeatureEnabled, readSchoolFeatureFlags, readSchoolPlan } from '@campuspilot/db/feature-flags/store';
import { schoolTable } from '@campuspilot/db/schema/school';
import { schoolBillingPeriodTable } from '@campuspilot/db/schema/school-billing';
import { eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { createTestSchool, createTestSchoolTrial, setTestSchoolFeature } from '../../test/fixtures';

/**
 * School trials as the feature store reads them (docs/school-billing.md): a
 * school's plan is the higher of its subscribed tier and its active trial's
 * tier, and a trial is active while `starts_at <= now() < least(ends_at,
 * coalesce(ended_at, 'infinity'))`. Expiry is tested with timestamps in the
 * past, never by waiting.
 */

const DAY = 24 * 60 * 60 * 1000;
const daysFromNow = (days: number) => new Date(Date.now() + days * DAY);

/** The PostgreSQL error code somewhere in a caught error's cause chain. */
async function databaseErrorCode(promise: Promise<unknown>): Promise<string | null> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  let current: unknown = error;
  while (typeof current === 'object' && current !== null) {
    if ('code' in current && typeof current.code === 'string') return current.code;
    current = 'cause' in current ? current.cause : undefined;
  }
  return null;
}

describe('the plan the feature store reads', () => {
  it('follows an active trial when the school has no subscription, with the trial as its own fact', async () => {
    const school = await createTestSchool({ tier: null });
    const trial = await createTestSchoolTrial({ schoolId: school.id, tier: 'pro' });

    const plan = await readSchoolPlan(db, school.id);
    expect(plan).toEqual({
      subscribedTier: null,
      period: { id: trial.id, kind: 'trial', tier: 'pro', startsAt: trial.startsAt, endsAt: trial.endsAt },
      plan: { tier: 'pro', source: 'trial' },
    });
    const flags = await readSchoolFeatureFlags(db, school.id);
    expect(flags).toMatchObject({ tier: 'pro', subscribedTier: null, period: { id: trial.id, tier: 'pro' }, invalidConfigs: [] });
    expect(flags!.features.studentManagement).toEqual({ included: true, adjustment: null, enabled: true, active: true, config: null });
    expect(flags!.features.cadet.included).toBe(false);
    expect(await isSchoolFeatureEnabled(db, school.id, 'notices')).toBe(true);
    expect(await isSchoolFeatureEnabled(db, school.id, 'cadet')).toBe(false);
  });

  it('takes the higher tier when the school subscribes and is on a trial too', async () => {
    const plus = await createTestSchool({ tier: 'plus' });
    await createTestSchoolTrial({ schoolId: plus.id, tier: 'enterprise' });
    expect((await readSchoolPlan(db, plus.id))!.plan).toEqual({ tier: 'enterprise', source: 'trial' });
    expect(await isSchoolFeatureEnabled(db, plus.id, 'cadet')).toBe(true);

    // A trial below the subscription changes nothing while it runs, and is still reported.
    const enterprise = await createTestSchool({ tier: 'enterprise' });
    const lower = await createTestSchoolTrial({ schoolId: enterprise.id, tier: 'plus' });
    expect(await readSchoolFeatureFlags(db, enterprise.id)).toMatchObject({ tier: 'enterprise', subscribedTier: 'enterprise', period: { id: lower.id, tier: 'plus' } });
    expect((await readSchoolPlan(db, enterprise.id))!.plan).toEqual({ tier: 'enterprise', source: 'standing' });
    expect(await isSchoolFeatureEnabled(db, enterprise.id, 'whatsapp')).toBe(true);
  });

  it('ignores a trial that ran out, was ended early or has not started, and then follows the subscription or nothing', async () => {
    const pro = await createTestSchool({ tier: 'pro' });
    await createTestSchoolTrial({ schoolId: pro.id, tier: 'enterprise', startsAt: daysFromNow(-40), endsAt: daysFromNow(-10) });
    expect(await readSchoolFeatureFlags(db, pro.id)).toMatchObject({ tier: 'pro', subscribedTier: 'pro', period: null });
    expect(await isSchoolFeatureEnabled(db, pro.id, 'cadet')).toBe(false);

    const none = await createTestSchool({ tier: null });
    await createTestSchoolTrial({ schoolId: none.id, tier: 'enterprise', startsAt: daysFromNow(-40), endsAt: daysFromNow(-10) });
    // Ended early: its end is still ahead, but an administrator ended it.
    await createTestSchoolTrial({ schoolId: none.id, tier: 'pro', startsAt: daysFromNow(-5), endsAt: daysFromNow(20), endedAt: daysFromNow(-1) });
    expect(await readSchoolPlan(db, none.id)).toEqual({ subscribedTier: null, period: null, plan: { tier: null, source: null } });
    expect(await readSchoolFeatureFlags(db, none.id)).toMatchObject({ tier: null, subscribedTier: null, period: null });
    expect(await isSchoolFeatureEnabled(db, none.id, 'studentManagement')).toBe(false);

    const later = await createTestSchool({ tier: null });
    await createTestSchoolTrial({ schoolId: later.id, tier: 'pro', startsAt: daysFromNow(2), endsAt: daysFromNow(30) });
    expect((await readSchoolPlan(db, later.id))!.period).toBeNull();
  });

  it('turns a trial off at its end: the same row is active before and not after', async () => {
    const school = await createTestSchool({ tier: null });
    const trial = await createTestSchoolTrial({ schoolId: school.id, tier: 'enterprise' });
    expect(await isSchoolFeatureEnabled(db, school.id, 'cadet')).toBe(true);
    // Its end moves into the past, as time passing would do.
    await db.update(schoolBillingPeriodTable).set({ endsAt: new Date(Date.now() - 1000) }).where(eq(schoolBillingPeriodTable.id, trial.id));
    expect(await isSchoolFeatureEnabled(db, school.id, 'cadet')).toBe(false);
    expect((await readSchoolPlan(db, school.id))!.plan.tier).toBeNull();
  });

  it('keeps applying the school\'s adjustments on top of a trial\'s tier', async () => {
    const school = await createTestSchool({ tier: null });
    await createTestSchoolTrial({ schoolId: school.id, tier: 'enterprise' });
    await setTestSchoolFeature(school.id, 'whatsapp', false);
    await setTestSchoolFeature(school.id, 'assistant', true, { monthlyLimitUsd: 10 });
    const features = await getSchoolFeatureFlags(db, school.id);
    expect(features.whatsapp).toMatchObject({ included: true, adjustment: false, active: false });
    expect(features.assistant).toMatchObject({ included: false, adjustment: true, active: true });
    expect(features.cadet).toMatchObject({ included: true, adjustment: null, active: true });
  });

  it('reads a school that does not exist as having no plan', async () => {
    expect(await readSchoolPlan(db, 'sch_missing')).toBeNull();
    expect(await readSchoolFeatureFlags(db, 'sch_missing')).toBeNull();
  });
});

describe('the school_billing_period table', () => {
  it('refuses two trials of one school that overlap in time, and allows one after another', async () => {
    const school = await createTestSchool({ tier: null });
    const first = await createTestSchoolTrial({ schoolId: school.id, tier: 'pro', startsAt: daysFromNow(-20), endsAt: daysFromNow(10) });
    // Overlapping the first one (exclusion_violation).
    expect(await databaseErrorCode(createTestSchoolTrial({ schoolId: school.id, tier: 'enterprise', startsAt: daysFromNow(-1), endsAt: daysFromNow(30) }))).toBe('23P01');
    // Another school's trial at the same time is fine.
    const other = await createTestSchool({ tier: null });
    await createTestSchoolTrial({ schoolId: other.id, tier: 'enterprise', startsAt: daysFromNow(-1), endsAt: daysFromNow(30) });

    // Once the first is ended, its time ends at `ended_at`, and a new trial may start after it.
    await db.update(schoolBillingPeriodTable).set({ endedAt: daysFromNow(-2) }).where(eq(schoolBillingPeriodTable.id, first.id));
    await createTestSchoolTrial({ schoolId: school.id, tier: 'enterprise', startsAt: daysFromNow(-1), endsAt: daysFromNow(30) });
    expect((await readSchoolPlan(db, school.id))!.plan).toEqual({ tier: 'enterprise', source: 'trial' });
    // A trial that ran out does not block a later one either, ending exactly where the next starts.
    const back = await createTestSchool({ tier: null });
    const boundary = daysFromNow(-3);
    await createTestSchoolTrial({ schoolId: back.id, tier: 'pro', startsAt: daysFromNow(-30), endsAt: boundary });
    await createTestSchoolTrial({ schoolId: back.id, tier: 'pro', startsAt: boundary, endsAt: daysFromNow(5) });
  });

  it('refuses a trial that ends before it starts, is ended before it starts, or names an unknown tier', async () => {
    const school = await createTestSchool({ tier: null });
    const start = daysFromNow(-1);
    expect(await databaseErrorCode(createTestSchoolTrial({ schoolId: school.id, tier: 'pro', startsAt: start, endsAt: start }))).toBe('23514');
    expect(await databaseErrorCode(createTestSchoolTrial({ schoolId: school.id, tier: 'pro', startsAt: start, endsAt: daysFromNow(5), endedAt: daysFromNow(-2) }))).toBe('23514');
    expect(
      await databaseErrorCode(
        db.execute(sql`insert into school_billing_period (id, school_id, kind, tier, ends_at) values ('trial_gold', ${school.id}, 'trial', 'gold', now() + interval '5 days')`),
      ),
    ).toBe('23514');
    expect(await db.select().from(schoolBillingPeriodTable).where(eq(schoolBillingPeriodTable.schoolId, school.id))).toEqual([]);
  });

  it('starts a trial now by default and goes with its school', async () => {
    const school = await createTestSchool({ tier: null });
    const before = Date.now();
    const [trial] = await db.insert(schoolBillingPeriodTable).values({ schoolId: school.id, kind: 'trial', tier: 'plus', endsAt: daysFromNow(30) }).returning();
    expect(trial!.id).toMatch(/^bper_[a-z0-9]{21}$/);
    expect(Math.abs(trial!.startsAt.getTime() - before)).toBeLessThan(60_000);
    expect(trial).toMatchObject({ endedAt: null, createdBy: null, endedBy: null });

    await db.delete(schoolTable).where(eq(schoolTable.id, school.id));
    expect(await db.select().from(schoolBillingPeriodTable).where(eq(schoolBillingPeriodTable.schoolId, school.id))).toEqual([]);
  });
});
