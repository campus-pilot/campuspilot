import { db } from '@campuspilot/db';
import { schoolFeatureFlagTable } from '@campuspilot/db/schema/school-feature-flag';
import { createRouterClient } from '@orpc/server';
import { eq, sql } from 'drizzle-orm';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cwd } from 'node:process';
import { z } from 'zod';
import { describe, expect, it } from 'vitest';

import { expectFeatureDisabled, expectPermissionDenied } from '../../../../test/feature-flags';
import { expectRpcCode } from '../../../../test/finance/assertions';
import {
  createAdminSession,
  createHandlerContext,
  createRegularUserSession,
  createSchoolStaffSession,
  createTestClient,
  createTestSchool,
  createTestSession,
  setTestSchoolFeature,
} from '../../../../test/fixtures';
import {
  assertSchoolFeatureEnabled,
  getSchoolFeatureConfig,
  getSchoolFeatureFlags,
  readSchoolFeatureFlags,
  isSchoolFeatureEnabled,
  setSchoolFeature,
} from '../../../feature-flags/feature-flags.service';
import { protectedProcedure } from '../../../index';
import { requireSchoolFeature } from '../../../permissions/feature';
import { requireSchoolMember } from '../../../permissions/school-member';

/** A feature the tier does not include, with no adjustment: off. */
const OFF = { included: false, adjustment: null, enabled: false, active: false, config: null };
/** A feature the tier includes, with no adjustment: on. */
const IN_TIER = { included: true, adjustment: null, enabled: true, active: true, config: null };
/** A feature outside the tier, switched on for this school (what `setTestSchoolFeature(..., true)` writes). */
const ADDED = { included: false, adjustment: true, enabled: true, active: true, config: null };
/** A feature outside the tier, explicitly switched off for this school. */
const DECLINED = { included: false, adjustment: false, enabled: false, active: false, config: null };
/** A feature of the tier, switched off for this school. */
const REMOVED = { included: true, adjustment: false, enabled: false, active: false, config: null };

/** A Pro school with no adjustment: student management and notices. */
const PRO = { studentManagement: IN_TIER, cadet: OFF, notices: IN_TIER, whatsapp: OFF, assistant: OFF };
/**
 * A test school created without a tier (`createTestSchool()`): a Plus school
 * with student management and WhatsApp switched on for it, and nothing else.
 */
const BASELINE = { studentManagement: ADDED, cadet: OFF, notices: OFF, whatsapp: ADDED, assistant: OFF };

describe('school feature flag storage', () => {
  it('reads a school without rows as exactly its tier, and a school that does not exist as having nothing', async () => {
    const school = await createTestSchool({ tier: 'pro' });
    expect(await getSchoolFeatureFlags(db, school.id)).toEqual(PRO);
    expect(await readSchoolFeatureFlags(db, school.id)).toEqual({ tier: 'pro', subscribedTier: 'pro', trial: null, features: PRO, invalidConfigs: [] });
    expect(await getSchoolFeatureConfig(db, school.id, 'cadet')).toBeNull();
    expect(await isSchoolFeatureEnabled(db, school.id, 'studentManagement')).toBe(true);
    expect(await isSchoolFeatureEnabled(db, school.id, 'notices')).toBe(true);
    expect(await isSchoolFeatureEnabled(db, school.id, 'cadet')).toBe(false);
    expect(await isSchoolFeatureEnabled(db, school.id, 'whatsapp')).toBe(false);

    // No school, no feature: also the ones every tier but Plus includes.
    expect(await isSchoolFeatureEnabled(db, 'sch_missing', 'cadet')).toBe(false);
    expect(await isSchoolFeatureEnabled(db, 'sch_missing', 'studentManagement')).toBe(false);
    expect(await getSchoolFeatureFlags(db, 'sch_missing')).toEqual({
      studentManagement: OFF,
      cadet: OFF,
      notices: OFF,
      whatsapp: OFF,
      assistant: OFF,
    });
    expect(await readSchoolFeatureFlags(db, 'sch_missing')).toBeNull();
  });

  it('reads a school without a tier as having no tier feature, while its adjustments still apply', async () => {
    const school = await createTestSchool({ tier: null });
    const NONE = { studentManagement: OFF, cadet: OFF, notices: OFF, whatsapp: OFF, assistant: OFF };
    expect(await readSchoolFeatureFlags(db, school.id)).toEqual({ tier: null, subscribedTier: null, trial: null, features: NONE, invalidConfigs: [] });
    expect(await isSchoolFeatureEnabled(db, school.id, 'studentManagement')).toBe(false);

    await setSchoolFeature(db, { schoolId: school.id, feature: 'studentManagement', enabled: true, config: null, updatedBy: null });
    await setSchoolFeature(db, { schoolId: school.id, feature: 'notices', enabled: true, config: null, updatedBy: null });
    expect(await readSchoolFeatureFlags(db, school.id)).toEqual({
      tier: null,
      subscribedTier: null,
      trial: null,
      features: { ...NONE, studentManagement: ADDED, notices: ADDED },
      invalidConfigs: [],
    });
    expect(await isSchoolFeatureEnabled(db, school.id, 'notices')).toBe(true);
    // Following the tier means off: no tier includes anything for it.
    await setSchoolFeature(db, { schoolId: school.id, feature: 'notices', enabled: null, config: null, updatedBy: null });
    expect(await isSchoolFeatureEnabled(db, school.id, 'notices')).toBe(false);
  });

  it('gives a test school created without a tier student management and WhatsApp, as adjustments on a Plus school', async () => {
    const school = await createTestSchool();
    expect(await readSchoolFeatureFlags(db, school.id)).toEqual({ tier: 'plus', subscribedTier: 'plus', trial: null, features: BASELINE, invalidConfigs: [] });
  });

  it('stores each feature and school independently and records who changed it', async () => {
    const [school, other] = await Promise.all([createTestSchool({ tier: 'pro' }), createTestSchool({ tier: 'pro' })]);
    const admin = await createAdminSession();
    await setSchoolFeature(db, { schoolId: school.id, feature: 'cadet', enabled: true, config: null, updatedBy: admin.user.id });

    expect(await getSchoolFeatureFlags(db, school.id)).toEqual({ ...PRO, cadet: ADDED });
    expect(await getSchoolFeatureFlags(db, other.id)).toEqual(PRO);
    const rows = await db.select().from(schoolFeatureFlagTable).where(eqSchool(school.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ feature: 'cadet', enabled: true, config: null, updatedBy: admin.user.id });

    // Replacing keeps one row per (school, feature).
    await setSchoolFeature(db, { schoolId: school.id, feature: 'cadet', enabled: false, config: null, updatedBy: null });
    const replaced = await db.select().from(schoolFeatureFlagTable).where(eqSchool(school.id));
    expect(replaced).toHaveLength(1);
    expect(replaced[0]).toMatchObject({ enabled: false, updatedBy: null });
    expect(await isSchoolFeatureEnabled(db, school.id, 'cadet')).toBe(false);

    // A null adjustment follows the tier again; the row stays, holding no decision.
    await setSchoolFeature(db, { schoolId: school.id, feature: 'notices', enabled: false, config: null, updatedBy: null });
    expect(await isSchoolFeatureEnabled(db, school.id, 'notices')).toBe(false);
    await setSchoolFeature(db, { schoolId: school.id, feature: 'notices', enabled: null, config: null, updatedBy: null });
    expect(await isSchoolFeatureEnabled(db, school.id, 'notices')).toBe(true);
    expect((await getSchoolFeatureFlags(db, school.id)).notices).toEqual(IN_TIER);
  });

  it('refuses a config that does not match the feature and writes nothing, and a school that does not exist', async () => {
    const school = await createTestSchool({ tier: 'pro' });
    await expect(
      setSchoolFeature(db, { schoolId: school.id, feature: 'cadet', enabled: true, config: { nope: 1 } as never, updatedBy: null }),
    ).rejects.toThrow();
    expect(await db.select().from(schoolFeatureFlagTable).where(eqSchool(school.id))).toEqual([]);
    await expect(
      setSchoolFeature(db, { schoolId: 'sch_missing', feature: 'cadet', enabled: true, config: null, updatedBy: null }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('ignores rows of a retired feature key', async () => {
    const school = await createTestSchool({ tier: 'pro', features: ['cadet'] });
    await db.insert(schoolFeatureFlagTable).values({ schoolId: school.id, feature: 'retired-feature' as never, enabled: true });
    expect(await getSchoolFeatureFlags(db, school.id)).toEqual({ ...PRO, cadet: ADDED });
    expect(await readSchoolFeatureFlags(db, school.id)).toEqual({ tier: 'pro', subscribedTier: 'pro', trial: null, features: { ...PRO, cadet: ADDED }, invalidConfigs: [] });
  });

  /**
   * Review rounds 1 and 2, F6. A stored config that no longer matches its
   * schema (as after a schema change) stops the code that uses that config,
   * with a clear error, and nothing else: "is it enabled" and "what does
   * this school have" are answered from the facts they ask for.
   */
  it('answers "is it enabled" from the enabled fact alone, whatever the stored config looks like', async () => {
    const school = await createTestSchool({ tier: 'pro' });
    await db.insert(schoolFeatureFlagTable).values([
      { schoolId: school.id, feature: 'cadet', enabled: true, config: { stale: true } },
      { schoolId: school.id, feature: 'notices', enabled: false, config: { stale: true } },
    ]);
    expect(await isSchoolFeatureEnabled(db, school.id, 'cadet')).toBe(true);
    expect(await isSchoolFeatureEnabled(db, school.id, 'notices')).toBe(false);
    await expect(assertSchoolFeatureEnabled(db, school.id, 'cadet')).resolves.toBeUndefined();
    await expectFeatureDisabled(assertSchoolFeatureEnabled(db, school.id, 'notices'), 'notices');
    // Only the read of the config fails, and it says what is wrong and for which feature.
    await expect(getSchoolFeatureConfig(db, school.id, 'cadet')).rejects.toMatchObject({
      code: 'CONFLICT',
      status: 409,
      data: { reason: 'SCHOOL_FEATURE_CONFIG_INVALID', feature: 'cadet' },
      message: 'The stored settings of Cadet Portal for this school are not valid. A platform administrator must save them again.',
    });
    // Every feature is still listed with its real enabled fact; the unusable configs are named.
    expect(await readSchoolFeatureFlags(db, school.id)).toEqual({ tier: 'pro', subscribedTier: 'pro', trial: null, features: { ...PRO, cadet: ADDED, notices: REMOVED }, invalidConfigs: ['cadet', 'notices'] });
    // A feature with nothing stored has a valid, empty config.
    const fresh = await createTestSchool({ features: ['notices'] });
    await expect(getSchoolFeatureConfig(db, fresh.id, 'notices')).resolves.toBeNull();
    await expect(getSchoolFeatureConfig(db, fresh.id, 'cadet')).resolves.toBeNull();
  });

  it('keeps every gate, flag read and feature procedure working with a stale config, until an administrator saves it again', async () => {
    const school = await createTestSchool({ tier: 'pro' });
    await db.insert(schoolFeatureFlagTable).values([
      { schoolId: school.id, feature: 'cadet', enabled: true, config: { stale: true } },
      { schoolId: school.id, feature: 'notices', enabled: true, config: ['stale'] },
    ]);
    const principal = createTestClient((await createSchoolStaffSession(school.id, [{ role: 'principal', meta: null }])).session);
    const admin = createTestClient(await createAdminSession());
    // Staff procedures behind `requireSchoolFeature` answer normally (they were 500 while the gate parsed the config).
    await expect(principal.school.getCadetPortalSettings({ schoolId: school.id })).resolves.toEqual({ schoolId: school.id, showClassAverages: false });
    const session = (await createTestSession({ schoolId: school.id, sessionStartYear: 2026, sessionEndYear: 2027 })).id;
    await expect(principal.school.listNotices({ schoolId: school.id, sessionId: session })).resolves.toMatchObject({ items: [] });
    // The app's own read of the flags, which gates every page, does too.
    await expect(principal.school.getFeatureFlags({ schoolId: school.id })).resolves.toEqual({
      schoolId: school.id,
      tier: 'pro',
      features: { ...PRO, cadet: ADDED, notices: { ...IN_TIER, adjustment: true } },
      invalidConfigs: ['cadet', 'notices'],
    });
    // The administrator sees which settings need saving, and saving heals that feature.
    await expect(admin.systemAdmin.getSchoolFeatureFlags({ id: school.id })).resolves.toMatchObject({ invalidConfigs: ['cadet', 'notices'] });
    await expect(admin.systemAdmin.updateSchoolFeatureFlag({ id: school.id, feature: 'cadet', enabled: true, config: null })).resolves.toEqual({
      schoolId: school.id,
      tier: 'pro',
      subscribedTier: 'pro',
      trial: null,
      features: { ...PRO, cadet: ADDED, notices: { ...IN_TIER, adjustment: true } },
      invalidConfigs: ['notices'],
    });
    await expect(getSchoolFeatureConfig(db, school.id, 'cadet')).resolves.toBeNull();
  });
});

describe('migration 0048 backfill', () => {
  /** The backfill statement exactly as the migration file ships it. */
  const backfill = readFileSync(
    resolve(cwd(), '../db/src/migrations/0048_school-feature-flags.sql'),
    'utf8',
  )
    .split('--> statement-breakpoint')
    .map((statement) => statement.trim())
    .find((statement) => statement.includes('INSERT INTO "school_feature_flag"'))!;

  it('enables cadet (and only cadet) for schools that existed before flags, without touching decided ones', async () => {
    const [untouched, decided] = await Promise.all([createTestSchool({ tier: 'pro' }), createTestSchool({ tier: 'pro' })]);
    await setTestSchoolFeature(decided.id, 'cadet', false);

    // Run inside a transaction that is rolled back: the statement covers
    // every school of the shared test database.
    class Rollback extends Error {}
    await db
      .transaction(async (transaction) => {
        await transaction.execute(sql.raw(backfill));
        await transaction.execute(sql.raw(backfill));
        expect(await getSchoolFeatureFlags(transaction, untouched.id)).toEqual({ ...PRO, cadet: ADDED });
        const rows = await transaction.select().from(schoolFeatureFlagTable).where(eqSchool(untouched.id));
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ feature: 'cadet', enabled: true, config: null, updatedBy: null });
        // An existing row is never overwritten.
        expect(await getSchoolFeatureFlags(transaction, decided.id)).toEqual({ ...PRO, cadet: DECLINED });
        throw new Rollback();
      })
      .catch((error: unknown) => {
        if (!(error instanceof Rollback)) throw error;
      });
    expect(await getSchoolFeatureFlags(db, untouched.id)).toEqual(PRO);
  });
});

describe('school.getFeatureFlags', () => {
  it('rejects anonymous callers and anyone who is not a member of the school', async () => {
    const [school, otherSchool] = await Promise.all([createTestSchool({ features: ['cadet'] }), createTestSchool()]);
    const outsider = await createSchoolStaffSession(otherSchool.id, [{ role: 'principal', meta: null }]);

    await expectRpcCode(createTestClient(null).school.getFeatureFlags({ schoolId: school.id }), 'UNAUTHORIZED');
    await expectRpcCode(createTestClient(outsider.session).school.getFeatureFlags({ schoolId: school.id }), 'FORBIDDEN');
    await expectRpcCode(createTestClient(await createRegularUserSession()).school.getFeatureFlags({ schoolId: school.id }), 'FORBIDDEN');
    // Platform administrators read flags through systemAdmin, not as members.
    await expectRpcCode(createTestClient(await createAdminSession()).school.getFeatureFlags({ schoolId: school.id }), 'FORBIDDEN');
  });

  it('validates the school id', async () => {
    const client = createTestClient(await createRegularUserSession());
    await expectRpcCode(client.school.getFeatureFlags({ schoolId: '' }), 'BAD_REQUEST');
    await expectRpcCode(client.school.getFeatureFlags({} as never), 'BAD_REQUEST');
  });

  it('returns every feature to any member, whatever their role, following later changes', async () => {
    const school = await createTestSchool({ features: ['cadet'] });
    const staffOfEveryKind = await Promise.all([
      createSchoolStaffSession(school.id, [{ role: 'principal', meta: null }]),
      createSchoolStaffSession(school.id, [{ role: 'teacher', meta: { classIds: [] } }]),
      createSchoolStaffSession(school.id, [{ role: 'accountant', meta: null }]),
    ]);
    for (const staff of staffOfEveryKind) {
      expect(await createTestClient(staff.session).school.getFeatureFlags({ schoolId: school.id })).toEqual({
        schoolId: school.id,
        tier: 'plus',
        features: { ...BASELINE, cadet: ADDED },
        invalidConfigs: [],
      });
    }

    const teacher = await createSchoolStaffSession(school.id, [{ role: 'teacher', meta: { classIds: [] } }]);
    await setTestSchoolFeature(school.id, 'notices', true);
    await setTestSchoolFeature(school.id, 'cadet', false);
    expect((await createTestClient(teacher.session).school.getFeatureFlags({ schoolId: school.id })).features).toEqual({
      ...BASELINE,
      cadet: DECLINED,
      notices: ADDED,
    });

    // Returned to the tier, a feature reads as the tier says, with no adjustment.
    await setTestSchoolFeature(school.id, 'notices', null);
    await setTestSchoolFeature(school.id, 'cadet', null);
    expect((await createTestClient(teacher.session).school.getFeatureFlags({ schoolId: school.id })).features).toEqual(BASELINE);
  });
});

/**
 * `requireSchoolFeature` on a probe procedure shaped like the notices
 * procedures later phases add (membership check, then the feature).
 */
describe('requireSchoolFeature', () => {
  const probe = protectedProcedure
    .input(z.object({ schoolId: z.string().min(1) }))
    .use(requireSchoolMember())
    .use(requireSchoolFeature('notices'))
    .handler(() => 'reached');

  async function callProbe(session: Parameters<typeof createHandlerContext>[0], schoolId: string) {
    return createRouterClient({ probe }, { context: createHandlerContext(session) }).probe({ schoolId });
  }

  it('refuses a school without the feature with the feature-disabled error', async () => {
    const school = await createTestSchool({ features: ['cadet'] });
    const staff = await createSchoolStaffSession(school.id, [{ role: 'principal', meta: null }]);
    await expectFeatureDisabled(callProbe(staff.session, school.id), 'notices');

    // An explicitly disabled row behaves like a missing one on a tier without the feature.
    await setTestSchoolFeature(school.id, 'notices', false);
    await expectFeatureDisabled(callProbe(staff.session, school.id), 'notices');
  });

  it('follows the school\'s tier, and an adjustment over it', async () => {
    const school = await createTestSchool({ tier: 'plus' });
    const staff = await createSchoolStaffSession(school.id, [{ role: 'principal', meta: null }]);
    const admin = createTestClient(await createAdminSession());
    // Plus has no notices (nor the student management they need).
    await expectFeatureDisabled(callProbe(staff.session, school.id), 'notices');
    // Pro includes both: the gate opens with the tier change alone.
    await admin.systemAdmin.updateSchoolTier({ id: school.id, tier: 'pro' });
    expect(await callProbe(staff.session, school.id)).toBe('reached');
    // Switched off for this school, whatever its tier.
    await setTestSchoolFeature(school.id, 'notices', false);
    await expectFeatureDisabled(callProbe(staff.session, school.id), 'notices');
    await admin.systemAdmin.updateSchoolTier({ id: school.id, tier: 'enterprise' });
    await expectFeatureDisabled(callProbe(staff.session, school.id), 'notices');
    // Back to the tier: on again; and off again on a tier without it.
    await setTestSchoolFeature(school.id, 'notices', null);
    expect(await callProbe(staff.session, school.id)).toBe('reached');
    await admin.systemAdmin.updateSchoolTier({ id: school.id, tier: 'plus' });
    await expectFeatureDisabled(callProbe(staff.session, school.id), 'notices');
  });

  it('lets the handler run once the feature is enabled, per school, also when the stored config is stale', async () => {
    const [school, other] = await Promise.all([createTestSchool(), createTestSchool({ features: ['notices'] })]);
    const staff = await createSchoolStaffSession(school.id, [{ role: 'principal', meta: null }]);
    await expectFeatureDisabled(callProbe(staff.session, school.id), 'notices');
    await setTestSchoolFeature(school.id, 'notices', true);
    expect(await callProbe(staff.session, school.id)).toBe('reached');
    // The gate reads the enabled fact only: a config it does not use cannot fail it.
    await db.update(schoolFeatureFlagTable).set({ config: { stale: true } }).where(eqSchool(school.id));
    expect(await callProbe(staff.session, school.id)).toBe('reached');
    // Another school's flag never applies.
    await setTestSchoolFeature(school.id, 'notices', false);
    await expectFeatureDisabled(callProbe(staff.session, school.id), 'notices');
    expect(await isSchoolFeatureEnabled(db, other.id, 'notices')).toBe(true);
  });

  it('lets the permission check answer first, so outsiders cannot probe a school\'s features', async () => {
    const [school, otherSchool] = await Promise.all([createTestSchool(), createTestSchool()]);
    const outsider = await createSchoolStaffSession(otherSchool.id, [{ role: 'principal', meta: null }]);
    await expectPermissionDenied(callProbe(outsider.session, school.id));
    await setTestSchoolFeature(school.id, 'notices', true);
    await expectPermissionDenied(callProbe(outsider.session, school.id));
    await expectRpcCode(callProbe(null, school.id), 'UNAUTHORIZED');
  });
});

/** The real procedures of each area, on a school of each tier with no adjustment. */
describe('what a school of each tier can do', () => {
  async function schoolOn(tier: 'plus' | 'pro' | 'enterprise') {
    const school = await createTestSchool({ tier });
    const session = await createTestSession({ schoolId: school.id, sessionStartYear: 2026, sessionEndYear: 2027, isActive: true });
    const principal = createTestClient((await createSchoolStaffSession(school.id, [{ role: 'principal', meta: null }])).session);
    return {
      school,
      admissions: () => principal.school.listAdmissions({ schoolId: school.id }),
      notices: () => principal.school.listNotices({ schoolId: school.id, sessionId: session.id }),
      cadetSettings: () => principal.school.getCadetPortalSettings({ schoolId: school.id }),
      // Staff, classes and examinations are every school's, whatever its tier.
      classes: () => principal.school.listClasses({ schoolId: school.id }),
      assistant: () => principal.school.getAssistantAccess({ schoolId: school.id }),
    };
  }

  it('Plus: staff, classes and examinations only', async () => {
    const plus = await schoolOn('plus');
    await expect(plus.classes()).resolves.toEqual([]);
    await expectFeatureDisabled(plus.admissions(), 'studentManagement');
    await expectFeatureDisabled(plus.notices(), 'notices');
    await expectFeatureDisabled(plus.cadetSettings(), 'cadet');
    await expectFeatureDisabled(plus.assistant(), 'assistant');
  });

  it('Pro: also student management and notices', async () => {
    const pro = await schoolOn('pro');
    await expect(pro.classes()).resolves.toEqual([]);
    await expect(pro.admissions()).resolves.toMatchObject({ items: [] });
    await expect(pro.notices()).resolves.toMatchObject({ items: [] });
    await expectFeatureDisabled(pro.cadetSettings(), 'cadet');
    await expectFeatureDisabled(pro.assistant(), 'assistant');
  });

  it('Enterprise: also the Cadet Portal', async () => {
    const enterprise = await schoolOn('enterprise');
    await expect(enterprise.admissions()).resolves.toMatchObject({ items: [] });
    await expect(enterprise.notices()).resolves.toMatchObject({ items: [] });
    await expect(enterprise.cadetSettings()).resolves.toEqual({ schoolId: enterprise.school.id, showClassAverages: false });
    // The assistant is in no tier: off here too until an administrator switches it on.
    await expectFeatureDisabled(enterprise.assistant(), 'assistant');
  });

  it('the assistant can be switched on for a school of any tier, with its limit', async () => {
    for (const tier of ['plus', 'pro', 'enterprise'] as const) {
      const school = await schoolOn(tier);
      await setTestSchoolFeature(school.school.id, 'assistant', true, { monthlyLimitUsd: 12 });
      await expect(school.assistant()).resolves.toMatchObject({ schoolId: school.school.id, monthlyLimitUsd: 12 });
    }
  });
});

describe('Cadet Portal settings need the cadet feature', () => {
  it('refuses reading and updating the settings while the feature is off', async () => {
    const school = await createTestSchool();
    const principal = createTestClient((await createSchoolStaffSession(school.id, [{ role: 'principal', meta: null }])).session);
    await expectFeatureDisabled(principal.school.getCadetPortalSettings({ schoolId: school.id }), 'cadet');
    await expectFeatureDisabled(principal.school.updateCadetPortalSettings({ schoolId: school.id, showClassAverages: true }), 'cadet');

    await setTestSchoolFeature(school.id, 'cadet', true);
    expect(await principal.school.getCadetPortalSettings({ schoolId: school.id })).toEqual({ schoolId: school.id, showClassAverages: false });
    expect(await principal.school.updateCadetPortalSettings({ schoolId: school.id, showClassAverages: true })).toEqual({ schoolId: school.id, showClassAverages: true });

    // Disabling keeps the stored setting but closes both procedures again.
    await setTestSchoolFeature(school.id, 'cadet', false);
    await expectFeatureDisabled(principal.school.getCadetPortalSettings({ schoolId: school.id }), 'cadet');
  });

  it('still answers a caller without the permission with a plain FORBIDDEN', async () => {
    const [school, otherSchool] = await Promise.all([createTestSchool(), createTestSchool()]);
    const outsider = createTestClient((await createSchoolStaffSession(otherSchool.id, [{ role: 'principal', meta: null }])).session);
    await expectPermissionDenied(outsider.school.getCadetPortalSettings({ schoolId: school.id }));
  });
});

function eqSchool(schoolId: string) {
  return eq(schoolFeatureFlagTable.schoolId, schoolId);
}
