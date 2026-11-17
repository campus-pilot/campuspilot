import { db } from '@campuspilot/db';
import { schoolTable } from '@campuspilot/db/schema/school';
import { schoolFeatureFlagTable } from '@campuspilot/db/schema/school-feature-flag';
import { env as assistantEnv, isAssistantVoiceConfigured } from '@campuspilot/env/assistant';
import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import { expectRpcCode } from '../../../../test/finance/assertions';
import {
  createAdminSession,
  createRegularUserSession,
  createSchoolStaffSession,
  createTestClient,
  createTestSchool,
  type UserSession,
} from '../../../../test/fixtures';

/** A feature the tier does not include, with no adjustment: off. */
const OFF = { included: false, adjustment: null, enabled: false, active: false, config: null };
/** A feature the tier includes, with no adjustment: on. */
const IN_TIER = { included: true, adjustment: null, enabled: true, active: true, config: null };
/** A feature outside the tier, switched on for this school. */
const ADDED = { included: false, adjustment: true, enabled: true, active: true, config: null };
/** A feature of the tier, switched off for this school. */
const REMOVED = { included: true, adjustment: false, enabled: false, active: false, config: null };

/** Every feature of each tier with no adjustment; the assistant is in none. */
const TIER_FEATURES = {
  plus: { studentManagement: OFF, cadet: OFF, notices: OFF, whatsapp: OFF, assistant: OFF },
  pro: { studentManagement: IN_TIER, cadet: OFF, notices: IN_TIER, whatsapp: OFF, assistant: OFF },
  enterprise: { studentManagement: IN_TIER, cadet: IN_TIER, notices: IN_TIER, whatsapp: IN_TIER, assistant: OFF },
} as const;

const storedRows = (schoolId: string) =>
  db.select().from(schoolFeatureFlagTable).where(eq(schoolFeatureFlagTable.schoolId, schoolId));

describe('systemAdmin school feature flags', () => {
  let admin: UserSession;
  let regular: UserSession;

  beforeAll(async () => {
    [admin, regular] = await Promise.all([createAdminSession(), createRegularUserSession()]);
  });

  describe('authentication and authorization', () => {
    it('rejects anonymous callers', async () => {
      const school = await createTestSchool({ tier: 'pro' });
      const client = createTestClient(null);
      await expectRpcCode(client.systemAdmin.getSchoolFeatureFlags({ id: school.id }), 'UNAUTHORIZED');
      await expectRpcCode(
        client.systemAdmin.updateSchoolFeatureFlag({ id: school.id, feature: 'cadet', enabled: true, config: null }),
        'UNAUTHORIZED',
      );
      await expectRpcCode(client.systemAdmin.updateSchoolTier({ id: school.id, tier: 'enterprise' }), 'UNAUTHORIZED');
    });

    it("rejects ordinary users and the school's own principal, and changes nothing", async () => {
      const school = await createTestSchool({ tier: 'pro' });
      const principal = await createSchoolStaffSession(school.id, [{ role: 'principal', meta: null }]);
      for (const session of [regular, principal.session]) {
        const client = createTestClient(session);
        await expectRpcCode(client.systemAdmin.getSchoolFeatureFlags({ id: school.id }), 'FORBIDDEN');
        await expectRpcCode(
          client.systemAdmin.updateSchoolFeatureFlag({ id: school.id, feature: 'cadet', enabled: true, config: null }),
          'FORBIDDEN',
        );
        await expectRpcCode(client.systemAdmin.updateSchoolTier({ id: school.id, tier: 'enterprise' }), 'FORBIDDEN');
      }
      expect(await storedRows(school.id)).toEqual([]);
      const [stored] = await db.select({ tier: schoolTable.tier }).from(schoolTable).where(eq(schoolTable.id, school.id));
      expect(stored?.tier).toBe('pro');
    });
  });

  describe('getAssistantPlatformStatus', () => {
    it("answers platform administrators with this deployment's voice setup", async () => {
      expect(await createTestClient(admin).systemAdmin.getAssistantPlatformStatus()).toEqual({
        voiceConfigured: isAssistantVoiceConfigured(assistantEnv),
      });
    });

    it('rejects anonymous callers, ordinary users and school principals', async () => {
      const school = await createTestSchool();
      const principal = await createSchoolStaffSession(school.id, [{ role: 'principal', meta: null }]);
      await expectRpcCode(createTestClient(null).systemAdmin.getAssistantPlatformStatus(), 'UNAUTHORIZED');
      for (const session of [regular, principal.session]) {
        await expectRpcCode(createTestClient(session).systemAdmin.getAssistantPlatformStatus(), 'FORBIDDEN');
      }
    });
  });

  describe('input validation', () => {
    it('rejects a missing id, an unknown feature, a config of the wrong shape and an unknown tier', async () => {
      const school = await createTestSchool({ tier: 'pro' });
      const client = createTestClient(admin);
      await expectRpcCode(client.systemAdmin.getSchoolFeatureFlags({ id: '' }), 'BAD_REQUEST');
      await expectRpcCode(
        client.systemAdmin.updateSchoolFeatureFlag({ id: school.id, feature: 'unknown', enabled: true, config: null } as never),
        'BAD_REQUEST',
      );
      await expectRpcCode(
        client.systemAdmin.updateSchoolFeatureFlag({ id: school.id, feature: 'cadet', enabled: true, config: { any: 1 } } as never),
        'BAD_REQUEST',
      );
      await expectRpcCode(
        client.systemAdmin.updateSchoolFeatureFlag({ id: school.id, feature: 'cadet', enabled: 'yes', config: null } as never),
        'BAD_REQUEST',
      );
      await expectRpcCode(
        client.systemAdmin.updateSchoolFeatureFlag({ feature: 'cadet', enabled: true, config: null } as never),
        'BAD_REQUEST',
      );
      await expectRpcCode(client.systemAdmin.updateSchoolTier({ id: school.id, tier: 'free' } as never), 'BAD_REQUEST');
      await expectRpcCode(client.systemAdmin.updateSchoolTier({ id: school.id } as never), 'BAD_REQUEST');
      expect(await storedRows(school.id)).toEqual([]);
    });
  });

  describe('features with settings', () => {
    it('cannot be enabled without their settings, but can always be disabled', async () => {
      const school = await createTestSchool({ tier: 'pro' });
      const client = createTestClient(admin);
      await expect(
        client.systemAdmin.updateSchoolFeatureFlag({ id: school.id, feature: 'assistant', enabled: true, config: null }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      expect((await client.systemAdmin.getSchoolFeatureFlags({ id: school.id })).features.assistant).toEqual(OFF);

      await expect(
        client.systemAdmin.updateSchoolFeatureFlag({ id: school.id, feature: 'assistant', enabled: false, config: null }),
      ).resolves.toMatchObject({ features: { assistant: { ...OFF, adjustment: false } } });

      const config = { monthlyLimitUsd: 50, voice: { enabled: false } };
      await expect(
        client.systemAdmin.updateSchoolFeatureFlag({ id: school.id, feature: 'assistant', enabled: true, config }),
      ).resolves.toMatchObject({ features: { assistant: { included: false, adjustment: true, enabled: true, active: true, config } } });
      // Switching off keeps the settings.
      await expect(
        client.systemAdmin.updateSchoolFeatureFlag({ id: school.id, feature: 'assistant', enabled: false, config }),
      ).resolves.toMatchObject({ features: { assistant: { adjustment: false, enabled: false, active: false, config } } });
    });

    it('keeps the settings when the feature is returned to its tier, where the assistant is off on every tier', async () => {
      const school = await createTestSchool({ tier: 'enterprise' });
      const client = createTestClient(admin);
      const config = { monthlyLimitUsd: 50, voice: { enabled: true } };
      await client.systemAdmin.updateSchoolFeatureFlag({ id: school.id, feature: 'assistant', enabled: true, config });
      // No tier includes the assistant, so following the tier is off, and needs no settings to be valid.
      await expect(
        client.systemAdmin.updateSchoolFeatureFlag({ id: school.id, feature: 'assistant', enabled: null, config }),
      ).resolves.toMatchObject({ features: { assistant: { included: false, adjustment: null, enabled: false, active: false, config } } });
      const [row] = await db
        .select()
        .from(schoolFeatureFlagTable)
        .where(and(eq(schoolFeatureFlagTable.schoolId, school.id), eq(schoolFeatureFlagTable.feature, 'assistant')));
      expect(row).toMatchObject({ enabled: null, config, updatedBy: admin.user.id });
    });
  });

  describe('tiers', () => {
    it.each(['plus', 'pro', 'enterprise'] as const)('reads a %s school with no adjustment as exactly its tier, the assistant off', async (tier) => {
      const school = await createTestSchool({ tier });
      expect(await createTestClient(admin).systemAdmin.getSchoolFeatureFlags({ id: school.id })).toEqual({
        schoolId: school.id,
        tier,
        subscribedTier: tier,
        trial: null,
        features: TIER_FEATURES[tier],
        invalidConfigs: [],
      });
      expect(await storedRows(school.id)).toEqual([]);
    });

    it('a school created through addSchool has the features of the tier it was created on', async () => {
      const client = createTestClient(admin);
      const identity = () => ({ slug: `flags-${crypto.randomUUID().toLowerCase()}`, name: 'Flag School', location: 'Town' });
      await expectRpcCode(client.systemAdmin.addSchool({ ...identity(), tier: 'free' } as never), 'BAD_REQUEST');
      for (const tier of ['plus', 'pro', 'enterprise'] as const) {
        const created = await client.systemAdmin.addSchool({ ...identity(), tier });
        expect(created).toMatchObject({ subscribedTier: tier, planTier: tier, planSource: 'subscription', trial: null });
        expect(await client.systemAdmin.getSchoolFeatureFlags({ id: created.id })).toMatchObject({ tier, features: TIER_FEATURES[tier] });
      }
    });

    it('changes what the school has at once when its tier changes, in both directions', async () => {
      const school = await createTestSchool({ tier: 'plus' });
      const client = createTestClient(admin);
      expect(await client.systemAdmin.updateSchoolTier({ id: school.id, tier: 'enterprise' })).toEqual({
        schoolId: school.id,
        tier: 'enterprise',
        subscribedTier: 'enterprise',
        trial: null,
        features: TIER_FEATURES.enterprise,
        invalidConfigs: [],
      });
      expect(await client.systemAdmin.updateSchoolTier({ id: school.id, tier: 'pro' })).toEqual({
        schoolId: school.id,
        tier: 'pro',
        subscribedTier: 'pro',
        trial: null,
        features: TIER_FEATURES.pro,
        invalidConfigs: [],
      });
      // The tier is all that was written: a tier change stores no adjustment.
      expect(await storedRows(school.id)).toEqual([]);
      expect((await client.systemAdmin.getSchool({ id: school.id })).subscribedTier).toBe('pro');
      // Setting the tier it already has changes nothing.
      expect((await client.systemAdmin.updateSchoolTier({ id: school.id, tier: 'pro' })).features).toEqual(TIER_FEATURES.pro);
    });

    it('keeps adjustments across tier changes: one switched on survives a downgrade, one switched off survives an upgrade', async () => {
      const school = await createTestSchool({ tier: 'pro' });
      const client = createTestClient(admin);
      await client.systemAdmin.updateSchoolFeatureFlag({ id: school.id, feature: 'whatsapp', enabled: true, config: null });
      await client.systemAdmin.updateSchoolFeatureFlag({ id: school.id, feature: 'notices', enabled: false, config: null });
      expect((await client.systemAdmin.getSchoolFeatureFlags({ id: school.id })).features).toEqual({
        ...TIER_FEATURES.pro,
        whatsapp: ADDED,
        notices: REMOVED,
      });

      // Up: WhatsApp is now also in the tier and stays an adjustment; notices stays off.
      expect((await client.systemAdmin.updateSchoolTier({ id: school.id, tier: 'enterprise' })).features).toEqual({
        ...TIER_FEATURES.enterprise,
        whatsapp: { ...IN_TIER, adjustment: true },
        notices: REMOVED,
      });

      // Down to Plus: the tier has no student management, so WhatsApp stays switched on but inactive.
      expect((await client.systemAdmin.updateSchoolTier({ id: school.id, tier: 'plus' })).features).toEqual({
        ...TIER_FEATURES.plus,
        whatsapp: { ...ADDED, active: false },
        notices: { ...OFF, adjustment: false },
      });

      // Back to Pro: exactly what it had.
      expect((await client.systemAdmin.updateSchoolTier({ id: school.id, tier: 'pro' })).features).toEqual({
        ...TIER_FEATURES.pro,
        whatsapp: ADDED,
        notices: REMOVED,
      });
    });

    it('answers NOT_FOUND for a school that does not exist', async () => {
      await expectRpcCode(createTestClient(admin).systemAdmin.updateSchoolTier({ id: 'sch_missing', tier: 'pro' }), 'NOT_FOUND');
    });

    it('reads a school without a tier as having no tier feature, adjusts it, moves it onto a tier and back to none', async () => {
      const school = await createTestSchool({ tier: null });
      const teacher = await createSchoolStaffSession(school.id, [{ role: 'teacher', meta: { classIds: [] } }]);
      const client = createTestClient(admin);
      expect(await client.systemAdmin.getSchoolFeatureFlags({ id: school.id })).toEqual({
        schoolId: school.id,
        tier: null,
        subscribedTier: null,
        trial: null,
        features: TIER_FEATURES.plus,
        invalidConfigs: [],
      });
      expect((await client.systemAdmin.getSchool({ id: school.id })).subscribedTier).toBeNull();

      // Adjustments apply as on any tier.
      expect(
        (await client.systemAdmin.updateSchoolFeatureFlag({ id: school.id, feature: 'studentManagement', enabled: true, config: null }))
          .features,
      ).toEqual({ ...TIER_FEATURES.plus, studentManagement: ADDED });
      expect(await createTestClient(teacher.session).school.getFeatureFlags({ schoolId: school.id })).toEqual({
        schoolId: school.id,
        tier: null,
        features: { ...TIER_FEATURES.plus, studentManagement: ADDED },
        invalidConfigs: [],
      });

      expect(await client.systemAdmin.updateSchoolTier({ id: school.id, tier: 'pro' })).toEqual({
        schoolId: school.id,
        tier: 'pro',
        subscribedTier: 'pro',
        trial: null,
        features: { ...TIER_FEATURES.pro, studentManagement: { ...IN_TIER, adjustment: true } },
        invalidConfigs: [],
      });
      // Null removes the subscription: no plan, and the adjustment is kept.
      expect(await client.systemAdmin.updateSchoolTier({ id: school.id, tier: null })).toEqual({
        schoolId: school.id,
        tier: null,
        subscribedTier: null,
        trial: null,
        features: { ...TIER_FEATURES.plus, studentManagement: ADDED },
        invalidConfigs: [],
      });
      expect(await client.systemAdmin.getSchool({ id: school.id })).toMatchObject({ subscribedTier: null, planTier: null, planSource: null });
    });
  });

  describe('adjustments', () => {
    it('answers NOT_FOUND for a school that does not exist', async () => {
      const client = createTestClient(admin);
      await expectRpcCode(client.systemAdmin.getSchoolFeatureFlags({ id: 'sch_missing' }), 'NOT_FOUND');
      await expectRpcCode(
        client.systemAdmin.updateSchoolFeatureFlag({ id: 'sch_missing', feature: 'cadet', enabled: true, config: null }),
        'NOT_FOUND',
      );
    });

    it('switches one feature at a time on or off for one school, on top of its tier, and records the administrator', async () => {
      const [school, other] = await Promise.all([createTestSchool({ tier: 'pro' }), createTestSchool({ tier: 'pro' })]);
      const client = createTestClient(admin);

      // On, outside the tier.
      expect(
        await client.systemAdmin.updateSchoolFeatureFlag({ id: school.id, feature: 'cadet', enabled: true, config: null }),
      ).toEqual({ schoolId: school.id, tier: 'pro', subscribedTier: 'pro', trial: null, features: { ...TIER_FEATURES.pro, cadet: ADDED }, invalidConfigs: [] });
      // Off, inside the tier.
      expect(
        await client.systemAdmin.updateSchoolFeatureFlag({ id: school.id, feature: 'notices', enabled: false, config: null }),
      ).toEqual({ schoolId: school.id, tier: 'pro', subscribedTier: 'pro', trial: null, features: { ...TIER_FEATURES.pro, cadet: ADDED, notices: REMOVED }, invalidConfigs: [] });

      const rows = await storedRows(school.id);
      expect(rows.map((row) => [row.feature, row.enabled]).sort()).toEqual([
        ['cadet', true],
        ['notices', false],
      ]);
      expect(rows.every((row) => row.updatedBy === admin.user.id)).toBe(true);

      // An adjustment that says what the tier says is still an adjustment: it is the administrator's decision about this school.
      expect(
        (await client.systemAdmin.updateSchoolFeatureFlag({ id: school.id, feature: 'studentManagement', enabled: true, config: null })).features
          .studentManagement,
      ).toEqual({ ...IN_TIER, adjustment: true });

      // Another school is never touched.
      expect((await client.systemAdmin.getSchoolFeatureFlags({ id: other.id })).features).toEqual(TIER_FEATURES.pro);
      expect(await storedRows(other.id)).toEqual([]);
    });

    it('returns a feature to its tier with a null adjustment, whichever way it was adjusted', async () => {
      const school = await createTestSchool({ tier: 'pro' });
      const client = createTestClient(admin);
      await client.systemAdmin.updateSchoolFeatureFlag({ id: school.id, feature: 'cadet', enabled: true, config: null });
      await client.systemAdmin.updateSchoolFeatureFlag({ id: school.id, feature: 'notices', enabled: false, config: null });

      expect(
        (await client.systemAdmin.updateSchoolFeatureFlag({ id: school.id, feature: 'cadet', enabled: null, config: null })).features,
      ).toEqual({ ...TIER_FEATURES.pro, notices: REMOVED });
      expect(
        (await client.systemAdmin.updateSchoolFeatureFlag({ id: school.id, feature: 'notices', enabled: null, config: null })).features,
      ).toEqual(TIER_FEATURES.pro);

      // It follows the tier from then on.
      expect((await client.systemAdmin.updateSchoolTier({ id: school.id, tier: 'enterprise' })).features).toEqual(TIER_FEATURES.enterprise);
      expect((await client.systemAdmin.updateSchoolTier({ id: school.id, tier: 'plus' })).features).toEqual(TIER_FEATURES.plus);
    });

    it('reports a feature that is switched on but inactive because one it requires is off', async () => {
      const school = await createTestSchool({ tier: 'enterprise' });
      const client = createTestClient(admin);
      const { features } = await client.systemAdmin.updateSchoolFeatureFlag({
        id: school.id,
        feature: 'studentManagement',
        enabled: false,
        config: null,
      });
      expect(features).toEqual({
        studentManagement: REMOVED,
        cadet: { ...IN_TIER, active: false },
        notices: { ...IN_TIER, active: false },
        whatsapp: { ...IN_TIER, active: false },
        assistant: OFF,
      });
    });

    it("is what the school's staff then read", async () => {
      const school = await createTestSchool({ tier: 'pro' });
      const teacher = await createSchoolStaffSession(school.id, [{ role: 'teacher', meta: { classIds: [] } }]);
      const client = createTestClient(admin);
      await client.systemAdmin.updateSchoolFeatureFlag({ id: school.id, feature: 'whatsapp', enabled: true, config: null });
      expect(await createTestClient(teacher.session).school.getFeatureFlags({ schoolId: school.id })).toEqual({
        schoolId: school.id,
        tier: 'pro',
        features: { ...TIER_FEATURES.pro, whatsapp: ADDED },
        invalidConfigs: [],
      });
      await client.systemAdmin.updateSchoolTier({ id: school.id, tier: 'plus' });
      expect(await createTestClient(teacher.session).school.getFeatureFlags({ schoolId: school.id })).toMatchObject({
        tier: 'plus',
        features: { ...TIER_FEATURES.plus, whatsapp: { ...ADDED, active: false } },
      });
    });
  });
});
