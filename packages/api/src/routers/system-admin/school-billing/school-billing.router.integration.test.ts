import { db } from '@campuspilot/db';
import { schoolTable } from '@campuspilot/db/schema/school';
import { schoolBillingPeriodTable } from '@campuspilot/db/schema/school-billing';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { expectRpcCode } from '../../../../test/finance/assertions';
import {
  createAdminSession,
  createRegularUserSession,
  createSchoolStaffSession,
  createTestClient,
  createTestSchool,
  createTestSchoolTrial,
} from '../../../../test/fixtures';
import { isSchoolNoPlanError } from '../../../school-access/school-access.contract';

/**
 * The system admin trial procedures (docs/school-billing.md). Expiry is set
 * up with timestamps in the past, never by waiting.
 */

const DAY = 24 * 60 * 60 * 1000;
const daysFromNow = (days: number) => new Date(Date.now() + days * DAY);
const iso = (days: number) => daysFromNow(days).toISOString();
/** A timestamp as the test client returns it (a JSON string) in milliseconds. */
const ms = (value: string | Date) => new Date(value).getTime();

const adminClient = async () => {
  const session = await createAdminSession();
  return { session, client: createTestClient(session) };
};

const storedTrials = (schoolId: string) => db.select().from(schoolBillingPeriodTable).where(eq(schoolBillingPeriodTable.schoolId, schoolId));

describe('who may manage trials', () => {
  it('is platform administrators only: not the school\'s principal, an ordinary user or an anonymous caller', async () => {
    const school = await createTestSchool({ tier: null });
    const trial = await createTestSchoolTrial({ schoolId: school.id, tier: 'pro' });
    const principal = await createSchoolStaffSession(school.id, [{ role: 'principal', meta: null }]);
    for (const session of [principal.session, await createRegularUserSession()]) {
      const client = createTestClient(session);
      await expectRpcCode(client.systemAdmin.getSchoolBilling({ id: school.id }).then(({ periods }) => periods), 'FORBIDDEN');
      await expectRpcCode(client.systemAdmin.startSchoolTrial({ id: school.id, tier: 'pro', endsAt: iso(30) }), 'FORBIDDEN');
      await expectRpcCode(client.systemAdmin.updateSchoolTrial({ id: school.id, periodId: trial.id, endsAt: iso(60) }), 'FORBIDDEN');
      await expectRpcCode(client.systemAdmin.endSchoolBillingPeriod({ id: school.id, periodId: trial.id }), 'FORBIDDEN');
      await expectRpcCode(client.systemAdmin.updateSchoolTier({ id: school.id, tier: 'pro' }), 'FORBIDDEN');
    }
    const anonymous = createTestClient(null);
    await expectRpcCode(anonymous.systemAdmin.getSchoolBilling({ id: school.id }), 'UNAUTHORIZED');
    await expectRpcCode(anonymous.systemAdmin.endSchoolBillingPeriod({ id: school.id, periodId: trial.id }), 'UNAUTHORIZED');
    expect(await storedTrials(school.id)).toMatchObject([{ id: trial.id, tier: 'pro', endedAt: null, endsAt: trial.endsAt }]);
  });
});

describe('systemAdmin.startSchoolTrial', () => {
  it('starts a trial now that gives a school without a subscription its plan, and lets its staff change things', async () => {
    const school = await createTestSchool({ tier: null });
    const principal = createTestClient((await createSchoolStaffSession(school.id, [{ role: 'principal', meta: null }])).session);
    const error = await principal.school.updateSchool({ schoolId: school.id, name: 'Before' }).catch((caught: unknown) => caught);
    expect(isSchoolNoPlanError(error)).toBe(true);

    const { session, client } = await adminClient();
    const before = Date.now();
    const trial = await client.systemAdmin.startSchoolTrial({ id: school.id, tier: 'pro', endsAt: iso(30) });
    expect(trial).toMatchObject({ schoolId: school.id, tier: 'pro', active: true, endedAt: null, endedBy: null, createdBy: session.user.id });
    expect(Math.abs(ms(trial.startsAt) - before)).toBeLessThan(60_000);
    expect(Math.abs(ms(trial.endsAt) - ms(daysFromNow(30)))).toBeLessThan(60_000);

    expect(await client.systemAdmin.getSchool({ id: school.id })).toMatchObject({
      subscribedTier: null,
      planTier: 'pro',
      planSource: 'trial',
      period: { id: trial.id, kind: 'trial', tier: 'pro', startsAt: trial.startsAt, endsAt: trial.endsAt },
    });
    expect(await client.systemAdmin.getSchoolFeatureFlags({ id: school.id })).toMatchObject({
      tier: 'pro',
      subscribedTier: null,
      period: { id: trial.id, tier: 'pro' },
      features: { studentManagement: { included: true, active: true }, cadet: { included: false, active: false } },
    });
    await expect(principal.school.updateSchool({ schoolId: school.id, name: 'On A Trial' })).resolves.toMatchObject({ name: 'On A Trial' });
  });

  it('refuses a second trial while one is active, also when two administrators start one at the same time', async () => {
    const school = await createTestSchool({ tier: 'plus' });
    const { client } = await adminClient();
    const first = await client.systemAdmin.startSchoolTrial({ id: school.id, tier: 'pro', endsAt: iso(30) });
    await expectRpcCode(client.systemAdmin.startSchoolTrial({ id: school.id, tier: 'enterprise', endsAt: iso(10) }), 'CONFLICT');

    const raced = await createTestSchool({ tier: null });
    const results = await Promise.allSettled([
      client.systemAdmin.startSchoolTrial({ id: raced.id, tier: 'pro', endsAt: iso(30) }),
      client.systemAdmin.startSchoolTrial({ id: raced.id, tier: 'enterprise', endsAt: iso(30) }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((result) => result.status === 'rejected')).toMatchObject({ reason: { code: 'CONFLICT' } });
    expect(await storedTrials(raced.id)).toHaveLength(1);

    // Once the first is over, another may start; the old one stays in the history.
    await client.systemAdmin.endSchoolBillingPeriod({ id: school.id, periodId: first.id });
    const second = await client.systemAdmin.startSchoolTrial({ id: school.id, tier: 'enterprise', endsAt: iso(10) });
    expect((await client.systemAdmin.getSchoolBilling({ id: school.id }).then(({ periods }) => periods)).map((trial) => [trial.id, trial.active])).toEqual([
      [second.id, true],
      [first.id, false],
    ]);
  });

  it('starts a new trial after one ran out by itself', async () => {
    const school = await createTestSchool({ tier: null });
    await createTestSchoolTrial({ schoolId: school.id, tier: 'enterprise', startsAt: daysFromNow(-40), endsAt: daysFromNow(-10) });
    const { client } = await adminClient();
    await expect(client.systemAdmin.startSchoolTrial({ id: school.id, tier: 'plus', endsAt: iso(5) })).resolves.toMatchObject({ active: true });
  });

  it('needs an end in the future and at most a year ahead, and an existing school', async () => {
    const school = await createTestSchool({ tier: null });
    const { client } = await adminClient();
    await expectRpcCode(client.systemAdmin.startSchoolTrial({ id: school.id, tier: 'pro', endsAt: iso(-1) }), 'BAD_REQUEST');
    await expectRpcCode(client.systemAdmin.startSchoolTrial({ id: school.id, tier: 'pro', endsAt: iso(368) }), 'BAD_REQUEST');
    await expectRpcCode(client.systemAdmin.startSchoolTrial({ id: school.id, tier: 'pro', endsAt: 'next month' }), 'BAD_REQUEST');
    await expectRpcCode(client.systemAdmin.startSchoolTrial({ id: 'sch_missing', tier: 'pro', endsAt: iso(30) }), 'NOT_FOUND');
    expect(await storedTrials(school.id)).toEqual([]);
    // Nearly a year ahead, written in IST, is accepted and stored as that instant.
    const end = new Date(Math.floor(daysFromNow(360).getTime() / 1000) * 1000);
    const inIst = new Date(end.getTime() + 330 * 60 * 1000).toISOString().replace(/\.000Z$/, '+05:30');
    await expect(client.systemAdmin.startSchoolTrial({ id: school.id, tier: 'pro', endsAt: inIst })).resolves.toMatchObject({ endsAt: end.toISOString() });
  });
});

describe('systemAdmin.updateSchoolTrial', () => {
  it('changes the active trial\'s tier and end, extending and shortening it, and the plan follows', async () => {
    const school = await createTestSchool({ tier: 'pro' });
    const { client } = await adminClient();
    const trial = await client.systemAdmin.startSchoolTrial({ id: school.id, tier: 'plus', endsAt: iso(30) });
    // A trial below the subscription changes nothing while it runs, and is still shown.
    expect(await client.systemAdmin.getSchool({ id: school.id })).toMatchObject({ planTier: 'pro', planSource: 'standing', period: { id: trial.id, tier: 'plus' } });

    const upgraded = await client.systemAdmin.updateSchoolTrial({ id: school.id, periodId: trial.id, tier: 'enterprise' });
    expect(upgraded).toMatchObject({ id: trial.id, tier: 'enterprise', endsAt: trial.endsAt, active: true });
    expect(await client.systemAdmin.getSchool({ id: school.id })).toMatchObject({ planTier: 'enterprise', planSource: 'trial' });

    const extended = await client.systemAdmin.updateSchoolTrial({ id: school.id, periodId: trial.id, endsAt: iso(90) });
    expect(ms(extended.endsAt)).toBeGreaterThan(ms(trial.endsAt));
    const shortened = await client.systemAdmin.updateSchoolTrial({ id: school.id, periodId: trial.id, endsAt: iso(2), tier: 'pro' });
    expect(shortened).toMatchObject({ tier: 'pro', active: true, startsAt: trial.startsAt });
    expect(Math.abs(ms(shortened.endsAt) - ms(daysFromNow(2)))).toBeLessThan(60_000);
  });

  it('refuses an end in the past, a change of nothing, another school\'s trial, and a trial that is over', async () => {
    const school = await createTestSchool({ tier: null });
    const other = await createTestSchool({ tier: null });
    const { client } = await adminClient();
    const trial = await client.systemAdmin.startSchoolTrial({ id: school.id, tier: 'pro', endsAt: iso(30) });
    await expectRpcCode(client.systemAdmin.updateSchoolTrial({ id: school.id, periodId: trial.id, endsAt: iso(-1) }), 'BAD_REQUEST');
    await expectRpcCode(client.systemAdmin.updateSchoolTrial({ id: school.id, periodId: trial.id, endsAt: iso(400) }), 'BAD_REQUEST');
    await expectRpcCode(client.systemAdmin.updateSchoolTrial({ id: school.id, periodId: trial.id }), 'BAD_REQUEST');
    await expectRpcCode(client.systemAdmin.updateSchoolTrial({ id: other.id, periodId: trial.id, tier: 'plus' }), 'NOT_FOUND');
    await expectRpcCode(client.systemAdmin.updateSchoolTrial({ id: school.id, periodId: 'trial_missing', tier: 'plus' }), 'NOT_FOUND');
    expect((await storedTrials(school.id))[0]).toMatchObject({ tier: 'pro', endsAt: new Date(trial.endsAt) });

    // Ran out by itself.
    const expired = await createTestSchoolTrial({ schoolId: other.id, tier: 'pro', startsAt: daysFromNow(-40), endsAt: daysFromNow(-10) });
    await expectRpcCode(client.systemAdmin.updateSchoolTrial({ id: other.id, periodId: expired.id, endsAt: iso(30) }), 'CONFLICT');
    // Ended by an administrator.
    await client.systemAdmin.endSchoolBillingPeriod({ id: school.id, periodId: trial.id });
    await expectRpcCode(client.systemAdmin.updateSchoolTrial({ id: school.id, periodId: trial.id, tier: 'enterprise' }), 'CONFLICT');
    expect((await storedTrials(school.id))[0]).toMatchObject({ tier: 'pro', endsAt: new Date(trial.endsAt) });
  });
});

describe('systemAdmin.endSchoolBillingPeriod', () => {
  it('ends the active trial now, so the school falls back to its subscription or has no plan, and changes nothing the second time', async () => {
    const school = await createTestSchool({ tier: null });
    const principal = createTestClient((await createSchoolStaffSession(school.id, [{ role: 'principal', meta: null }])).session);
    const { session, client } = await adminClient();
    const trial = await client.systemAdmin.startSchoolTrial({ id: school.id, tier: 'enterprise', endsAt: iso(30) });

    const ended = await client.systemAdmin.endSchoolBillingPeriod({ id: school.id, periodId: trial.id });
    expect(ended).toMatchObject({ id: trial.id, active: false, endedBy: session.user.id, endsAt: trial.endsAt });
    expect(ended.endedAt).not.toBeNull();
    expect(await client.systemAdmin.getSchool({ id: school.id })).toMatchObject({ planTier: null, planSource: null, period: null });
    const error = await principal.school.updateSchool({ schoolId: school.id, name: 'After' }).catch((caught: unknown) => caught);
    expect(isSchoolNoPlanError(error)).toBe(true);

    // Idempotent: the first end is kept.
    expect(await client.systemAdmin.endSchoolBillingPeriod({ id: school.id, periodId: trial.id })).toEqual(ended);

    // A subscribed school keeps its subscription.
    const subscribed = await createTestSchool({ tier: 'pro' });
    const upgrade = await client.systemAdmin.startSchoolTrial({ id: subscribed.id, tier: 'enterprise', endsAt: iso(30) });
    await client.systemAdmin.endSchoolBillingPeriod({ id: subscribed.id, periodId: upgrade.id });
    expect(await client.systemAdmin.getSchool({ id: subscribed.id })).toMatchObject({ planTier: 'pro', planSource: 'standing', period: null });
  });

  it('leaves a trial that ran out by itself as it is, and answers NOT_FOUND for an unknown one', async () => {
    const school = await createTestSchool({ tier: null });
    const expired = await createTestSchoolTrial({ schoolId: school.id, tier: 'pro', startsAt: daysFromNow(-40), endsAt: daysFromNow(-10) });
    const { client } = await adminClient();
    expect(await client.systemAdmin.endSchoolBillingPeriod({ id: school.id, periodId: expired.id })).toMatchObject({ active: false, endedAt: null, endedBy: null });
    await expectRpcCode(client.systemAdmin.endSchoolBillingPeriod({ id: school.id, periodId: 'trial_missing' }), 'NOT_FOUND');
    await expectRpcCode(client.systemAdmin.endSchoolBillingPeriod({ id: 'sch_missing', periodId: expired.id }), 'NOT_FOUND');
  });
});

describe('systemAdmin.getSchoolBilling', () => {
  it('lists a school\'s trials newest first, with which one is active, and nothing of other schools', async () => {
    const school = await createTestSchool({ tier: null });
    const old = await createTestSchoolTrial({ schoolId: school.id, tier: 'enterprise', startsAt: daysFromNow(-80), endsAt: daysFromNow(-50) });
    const endedEarly = await createTestSchoolTrial({ schoolId: school.id, tier: 'plus', startsAt: daysFromNow(-40), endsAt: daysFromNow(-5), endedAt: daysFromNow(-20) });
    const current = await createTestSchoolTrial({ schoolId: school.id, tier: 'pro' });
    await createTestSchoolTrial({ schoolId: (await createTestSchool({ tier: null })).id, tier: 'pro' });
    const { client } = await adminClient();
    const trials = await client.systemAdmin.getSchoolBilling({ id: school.id }).then(({ periods }) => periods);
    expect(trials.map((trial) => [trial.id, trial.tier, trial.active, trial.endedAt !== null])).toEqual([
      [current.id, 'pro', true, false],
      [endedEarly.id, 'plus', false, true],
      [old.id, 'enterprise', false, false],
    ]);
    await expectRpcCode(client.systemAdmin.getSchoolBilling({ id: 'sch_missing' }), 'NOT_FOUND');
  });
});

describe('the subscription and the trial in the school procedures', () => {
  const identity = () => {
    const slug = `trial-${randomUUID().toLowerCase()}`;
    return { slug, name: `Trial School ${slug}`, location: 'Town' };
  };

  it('creates a school with a subscription, a trial, both, or neither (which has no plan)', async () => {
    const { session, client } = await adminClient();
    expect(await client.systemAdmin.addSchool({ ...identity(), tier: 'pro' })).toMatchObject({ subscribedTier: 'pro', planTier: 'pro', period: null });

    const onTrial = await client.systemAdmin.addSchool({ ...identity(), trial: { tier: 'enterprise', endsAt: iso(30) } });
    expect(onTrial).toMatchObject({ subscribedTier: null, planTier: 'enterprise', planSource: 'trial', period: { tier: 'enterprise' } });
    expect(await storedTrials(onTrial.id)).toMatchObject([{ tier: 'enterprise', createdBy: session.user.id, endedAt: null }]);

    const both = await client.systemAdmin.addSchool({ ...identity(), tier: 'plus', trial: { tier: 'pro', endsAt: iso(30) } });
    expect(both).toMatchObject({ subscribedTier: 'plus', planTier: 'pro', planSource: 'trial' });

    for (const neither of [await client.systemAdmin.addSchool(identity()), await client.systemAdmin.addSchool({ ...identity(), tier: null, trial: null })]) {
      expect(neither).toMatchObject({ subscribedTier: null, planTier: null, planSource: null, period: null });
    }
  });

  it('creates no school when the trial\'s end is refused', async () => {
    const { client } = await adminClient();
    const school = identity();
    await expectRpcCode(client.systemAdmin.addSchool({ ...school, trial: { tier: 'pro', endsAt: iso(-1) } }), 'BAD_REQUEST');
    expect(await db.select().from(schoolTable).where(eq(schoolTable.slug, school.slug))).toEqual([]);
  });

  it('removes a subscription with a null tier: the school is then on its trial, or has no plan', async () => {
    const school = await createTestSchool({ tier: 'pro' });
    const { client } = await adminClient();
    const trial = await client.systemAdmin.startSchoolTrial({ id: school.id, tier: 'plus', endsAt: iso(30) });
    expect(await client.systemAdmin.updateSchoolTier({ id: school.id, tier: null })).toMatchObject({ tier: 'plus', subscribedTier: null, period: { id: trial.id } });
    expect(await client.systemAdmin.getSchool({ id: school.id })).toMatchObject({ subscribedTier: null, planTier: 'plus', planSource: 'trial' });
    await client.systemAdmin.endSchoolBillingPeriod({ id: school.id, periodId: trial.id });
    expect(await client.systemAdmin.getSchoolFeatureFlags({ id: school.id })).toMatchObject({ tier: null, subscribedTier: null, period: null });
  });

  it('filters the school list by plan state and carries the plan of each school', async () => {
    const tag = `plan_${randomUUID().toLowerCase()}`;
    const [subscribed, trialOnly, upgraded, none, ranOut] = await Promise.all([
      createTestSchool({ name: `Subscribed ${tag}`, tier: 'pro' }),
      createTestSchool({ name: `Trial ${tag}`, tier: null }),
      createTestSchool({ name: `Upgraded ${tag}`, tier: 'plus' }),
      createTestSchool({ name: `None ${tag}`, tier: null }),
      createTestSchool({ name: `Ran out ${tag}`, tier: null }),
    ]);
    await createTestSchoolTrial({ schoolId: trialOnly.id, tier: 'pro' });
    await createTestSchoolTrial({ schoolId: upgraded.id, tier: 'enterprise' });
    await createTestSchoolTrial({ schoolId: ranOut.id, tier: 'enterprise', startsAt: daysFromNow(-40), endsAt: daysFromNow(-10) });
    const { client } = await adminClient();

    const all = await client.systemAdmin.listSchools({ searchQuery: tag });
    expect(all.items.map((school) => [school.id, school.subscribedTier, school.planTier, school.planSource, school.period?.tier ?? null]).sort()).toEqual(
      [
        [subscribed.id, 'pro', 'pro', 'standing', null],
        [trialOnly.id, null, 'pro', 'trial', 'pro'],
        [upgraded.id, 'plus', 'enterprise', 'trial', 'enterprise'],
        [none.id, null, null, null, null],
        [ranOut.id, null, null, null, null],
      ].sort(),
    );
    const onTrial = await client.systemAdmin.listSchools({ searchQuery: tag, filters: { plan: 'trial' } });
    expect(onTrial.items.map((school) => school.id).sort()).toEqual([trialOnly.id, upgraded.id].sort());
    expect(onTrial.pagination.totalItems).toBe(2);
    const noPlan = await client.systemAdmin.listSchools({ searchQuery: tag, filters: { plan: 'none' } });
    expect(noPlan.items.map((school) => school.id).sort()).toEqual([none.id, ranOut.id].sort());
    const subscribedNone = await client.systemAdmin.listSchools({ searchQuery: tag, filters: { subscribedTier: null, plan: 'trial' } });
    expect(subscribedNone.items.map((school) => school.id)).toEqual([trialOnly.id]);
  });
});
