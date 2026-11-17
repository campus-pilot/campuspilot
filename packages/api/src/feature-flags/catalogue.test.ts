import {
  ASSISTANT_DEFAULT_ROLES,
  DISABLED_SCHOOL_FEATURE,
  missingSchoolFeatureRequirements,
  parseSchoolFeatureConfig,
  resolveSchoolFeatureActivity,
  resolveSchoolFeatureSwitches,
  resolveSchoolPlan,
  readSchoolFeatureDisabled,
  SCHOOL_FEATURE_DISABLED_REASON,
  SCHOOL_FEATURE_KEYS,
  SCHOOL_TIERS,
  type FeatureEntryIn,
  type SchoolFeatureEntry,
  type SchoolFeatureFlags,
  type SchoolFeatureKey,
  type SchoolTier,
  schoolFeatureCatalogue,
  schoolFeatureEntries,
  schoolFeatureFlagsSchema,
  schoolFeatureHasConfig,
  schoolFeatureUpdateSchema,
  schoolTierCatalogue,
  schoolTierFeatures,
  schoolTierIncludes,
  schoolTierRank,
  schoolTierSchema,
} from '@campuspilot/db/feature-flags/catalogue';
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';

import { schoolFeatureDisabledError } from './feature-flags.service';
import { DEMO_SCHOOL_TIER } from '../workflows/demo-school/constants';

describe('school feature catalogue', () => {
  it('lists every catalogue key once, each with a label and description', () => {
    expect(SCHOOL_FEATURE_KEYS).toEqual(Object.keys(schoolFeatureCatalogue));
    expect(SCHOOL_FEATURE_KEYS).toEqual(['studentManagement', 'cadet', 'notices', 'whatsapp', 'assistant']);
    for (const key of SCHOOL_FEATURE_KEYS) {
      expect(schoolFeatureCatalogue[key].label.length).toBeGreaterThan(0);
      expect(schoolFeatureCatalogue[key].description.length).toBeGreaterThan(0);
    }
  });

  it('validates a config against its own feature schema only', () => {
    expect(parseSchoolFeatureConfig('cadet', null)).toBeNull();
    expect(parseSchoolFeatureConfig('notices', undefined)).toBeNull();
    // Features without settings refuse any value.
    expect(() => parseSchoolFeatureConfig('cadet', { anything: true })).toThrow();
    expect(() => parseSchoolFeatureConfig('notices', 'on')).toThrow();
    expect(schoolFeatureHasConfig('cadet')).toBe(false);
    expect(schoolFeatureHasConfig('notices')).toBe(false);
    expect(schoolFeatureHasConfig('whatsapp')).toBe(false);
    expect(() => parseSchoolFeatureConfig('whatsapp', { anything: true })).toThrow();
    expect(schoolFeatureHasConfig('assistant')).toBe(true);
  });

  it('validates the assistant settings: a positive limit or none, and the voice switch', () => {
    const valid = { monthlyLimitUsd: 25, voice: { enabled: true } };
    expect(parseSchoolFeatureConfig('assistant', valid)).toEqual(valid);
    expect(parseSchoolFeatureConfig('assistant', { monthlyLimitUsd: null, voice: { enabled: false } })).toEqual({
      monthlyLimitUsd: null,
      voice: { enabled: false },
    });
    expect(() => parseSchoolFeatureConfig('assistant', { monthlyLimitUsd: 0 })).toThrow();
    expect(() => parseSchoolFeatureConfig('assistant', { monthlyLimitUsd: -5 })).toThrow();
    expect(() => parseSchoolFeatureConfig('assistant', { monthlyLimitUsd: 1_000_001 })).toThrow();
    expect(() => parseSchoolFeatureConfig('assistant', {})).toThrow();
    expect(() => parseSchoolFeatureConfig('assistant', { voice: { enabled: true } })).toThrow();
  });

  it('ignores the `eligibleRoles` of settings saved before the role list became the school\'s one list', () => {
    // Who may use the assistant is `school_assistant_access_role` alone; the old key is neither required nor kept.
    expect(parseSchoolFeatureConfig('assistant', { monthlyLimitUsd: 25, eligibleRoles: ['principal', 'teacher'], voice: { enabled: true } })).toEqual({
      monthlyLimitUsd: 25,
      voice: { enabled: true },
    });
    // Whatever it held, it cannot make the settings invalid any more.
    expect(parseSchoolFeatureConfig('assistant', { monthlyLimitUsd: 25, eligibleRoles: [] })).toEqual({ monthlyLimitUsd: 25, voice: { enabled: false } });
    expect(parseSchoolFeatureConfig('assistant', { monthlyLimitUsd: 25, eligibleRoles: ['janitor'] })).toEqual({ monthlyLimitUsd: 25, voice: { enabled: false } });
  });

  it('switches the assistant on for the principal, manager, exam coordinator and accountant by default, not for teachers', () => {
    expect([...ASSISTANT_DEFAULT_ROLES]).toEqual(['principal', 'manager', 'exam_coordinator', 'accountant']);
  });

  it('reads assistant settings saved before voice existed as voice off, and refuses a voice switch that is not a boolean', () => {
    expect(parseSchoolFeatureConfig('assistant', { monthlyLimitUsd: 25 })).toEqual({
      monthlyLimitUsd: 25,
      voice: { enabled: false },
    });
    expect(() => parseSchoolFeatureConfig('assistant', { monthlyLimitUsd: 25, voice: { enabled: 'yes' } })).toThrow();
    expect(() => parseSchoolFeatureConfig('assistant', { monthlyLimitUsd: 25, voice: {} })).toThrow();
  });

  it('describes all features in the flags schema and rejects a missing one', () => {
    const all = Object.fromEntries(SCHOOL_FEATURE_KEYS.map((key) => [key, DISABLED_SCHOOL_FEATURE]));
    expect(schoolFeatureFlagsSchema.parse(all)).toEqual(all);
    expect(schoolFeatureFlagsSchema.safeParse({ cadet: DISABLED_SCHOOL_FEATURE }).success).toBe(false);
  });

  it('accepts an update only for a known feature with that feature\'s config', () => {
    expect(schoolFeatureUpdateSchema.parse({ feature: 'cadet', enabled: true, config: null })).toEqual({
      feature: 'cadet',
      enabled: true,
      config: null,
    });
    expect(schoolFeatureUpdateSchema.safeParse({ feature: 'unknown', enabled: true, config: null }).success).toBe(false);
    expect(schoolFeatureUpdateSchema.safeParse({ feature: 'notices', enabled: true, config: { x: 1 } }).success).toBe(false);
    expect(schoolFeatureUpdateSchema.safeParse({ feature: 'notices', enabled: 'yes', config: null }).success).toBe(false);
    expect(schoolFeatureUpdateSchema.safeParse({ feature: 'notices', enabled: true }).success).toBe(false);
    // The adjustment may be null: the feature follows the school's tier.
    expect(schoolFeatureUpdateSchema.parse({ feature: 'whatsapp', enabled: null, config: null })).toEqual({
      feature: 'whatsapp',
      enabled: null,
      config: null,
    });
    expect(schoolFeatureUpdateSchema.safeParse({ feature: 'whatsapp', config: null }).success).toBe(false);
  });

  it('creates demo schools on the tier that includes every area the seed shows, with the assistant off', () => {
    expect(DEMO_SCHOOL_TIER).toBe('enterprise');
    expect(schoolTierFeatures(DEMO_SCHOOL_TIER)).toEqual(['studentManagement', 'cadet', 'notices', 'whatsapp']);
    expect(schoolTierIncludes(DEMO_SCHOOL_TIER, 'assistant')).toBe(false);
  });

  it('makes the Cadet Portal, notices and WhatsApp need student management, and nothing else need anything', () => {
    const requires = Object.fromEntries(SCHOOL_FEATURE_KEYS.map((key) => [key, [...schoolFeatureCatalogue[key].requires]]));
    expect(requires).toEqual({
      studentManagement: [],
      cadet: ['studentManagement'],
      notices: ['studentManagement'],
      whatsapp: ['studentManagement'],
      assistant: [],
    });
  });

  it('has no cycle in its requirements', () => {
    const allOn = Object.fromEntries(SCHOOL_FEATURE_KEYS.map((key) => [key, true])) as Record<(typeof SCHOOL_FEATURE_KEYS)[number], boolean>;
    expect(() => resolveSchoolFeatureActivity(allOn)).not.toThrow();
  });
});

describe('subscription tiers', () => {
  it('has three tiers, lowest first, each with a label and description', () => {
    expect([...SCHOOL_TIERS]).toEqual(['plus', 'pro', 'enterprise']);
    expect(Object.keys(schoolTierCatalogue)).toEqual([...SCHOOL_TIERS]);
    expect(SCHOOL_TIERS.map((tier) => schoolTierCatalogue[tier].label)).toEqual(['Plus', 'Pro', 'Enterprise']);
    for (const tier of SCHOOL_TIERS) expect(schoolTierCatalogue[tier].description.length).toBeGreaterThan(0);
    expect(schoolTierSchema.safeParse('pro').success).toBe(true);
    expect(schoolTierSchema.safeParse('free').success).toBe(false);
  });

  it('states which tiers include each feature: Plus none, Pro student management and notices, Enterprise also the Cadet Portal and WhatsApp', () => {
    const tiers = Object.fromEntries(SCHOOL_FEATURE_KEYS.map((key) => [key, [...schoolFeatureCatalogue[key].tiers]]));
    expect(tiers).toEqual({
      studentManagement: ['pro', 'enterprise'],
      cadet: ['enterprise'],
      notices: ['pro', 'enterprise'],
      whatsapp: ['enterprise'],
      // An add-on on every tier: no tier switches it on by itself.
      assistant: [],
    });
    expect(schoolTierFeatures('plus')).toEqual([]);
    expect(schoolTierFeatures('pro')).toEqual(['studentManagement', 'notices']);
    expect(schoolTierFeatures('enterprise')).toEqual(['studentManagement', 'cadet', 'notices', 'whatsapp']);
    expect(schoolTierIncludes('pro', 'cadet')).toBe(false);
    expect(schoolTierIncludes('enterprise', 'cadet')).toBe(true);
    // No subscribed tier includes nothing.
    expect(SCHOOL_FEATURE_KEYS.filter((key) => schoolTierIncludes(null, key))).toEqual([]);
  });

  it('never includes a feature in a tier without the features it requires', () => {
    for (const tier of SCHOOL_TIERS) {
      for (const key of schoolTierFeatures(tier)) {
        for (const required of schoolFeatureCatalogue[key].requires) {
          expect(schoolTierIncludes(tier, required), `${tier} includes ${key} but not ${required}`).toBe(true);
        }
      }
    }
  });

  it('switches a feature by the tier unless the school has an adjustment, which wins either way', () => {
    const on = (tier: SchoolTier | null, adjustments: Partial<Record<SchoolFeatureKey, boolean | null>> = {}) =>
      SCHOOL_FEATURE_KEYS.filter((key) => resolveSchoolFeatureSwitches(tier, adjustments)[key]);
    expect(on('plus')).toEqual([]);
    expect(on('pro')).toEqual(['studentManagement', 'notices']);
    expect(on('enterprise')).toEqual(['studentManagement', 'cadet', 'notices', 'whatsapp']);
    // An adjustment switches a feature on outside its tier and off inside it.
    expect(on('pro', { whatsapp: true, notices: false })).toEqual(['studentManagement', 'whatsapp']);
    expect(on('plus', { assistant: true })).toEqual(['assistant']);
    // Null is "follow the tier", exactly like no adjustment.
    expect(on('enterprise', { cadet: null, whatsapp: null })).toEqual(on('enterprise'));
    // Without a tier nothing is included, and adjustments still switch features on.
    expect(on(null)).toEqual([]);
    expect(on(null, { cadet: true, assistant: true, notices: false })).toEqual(['cadet', 'assistant']);
  });
});

describe('the plan of a school (subscription and trial)', () => {
  const trial = (tier: SchoolTier) => ({ tier });

  it('ranks the tiers Plus below Pro below Enterprise, stated per tier', () => {
    expect([...SCHOOL_TIERS].sort((a, b) => schoolTierRank[a] - schoolTierRank[b])).toEqual(['plus', 'pro', 'enterprise']);
    expect(new Set(Object.values(schoolTierRank)).size).toBe(SCHOOL_TIERS.length);
  });

  it('is the subscription without a trial, the trial without a subscription, and nothing without either', () => {
    expect(resolveSchoolPlan({ subscribedTier: 'pro', activeTrial: null })).toEqual({ tier: 'pro', source: 'subscription' });
    expect(resolveSchoolPlan({ subscribedTier: null, activeTrial: trial('plus') })).toEqual({ tier: 'plus', source: 'trial' });
    expect(resolveSchoolPlan({ subscribedTier: null, activeTrial: trial('enterprise') })).toEqual({ tier: 'enterprise', source: 'trial' });
    // Neither: the school has no plan (it is read-only).
    expect(resolveSchoolPlan({ subscribedTier: null, activeTrial: null })).toEqual({ tier: null, source: null });
  });

  it('takes the higher tier when both run, so a trial never takes away what the school pays for', () => {
    expect(resolveSchoolPlan({ subscribedTier: 'plus', activeTrial: trial('enterprise') })).toEqual({ tier: 'enterprise', source: 'trial' });
    expect(resolveSchoolPlan({ subscribedTier: 'pro', activeTrial: trial('enterprise') })).toEqual({ tier: 'enterprise', source: 'trial' });
    expect(resolveSchoolPlan({ subscribedTier: 'enterprise', activeTrial: trial('plus') })).toEqual({ tier: 'enterprise', source: 'subscription' });
    // A trial of the subscribed tier changes nothing: the subscription gives the plan.
    expect(resolveSchoolPlan({ subscribedTier: 'pro', activeTrial: trial('pro') })).toEqual({ tier: 'pro', source: 'subscription' });
    for (const subscribed of SCHOOL_TIERS) {
      for (const tried of SCHOOL_TIERS) {
        const plan = resolveSchoolPlan({ subscribedTier: subscribed, activeTrial: trial(tried) });
        expect(schoolTierRank[plan.tier!]).toBe(Math.max(schoolTierRank[subscribed], schoolTierRank[tried]));
      }
    }
  });
});

describe('feature activity', () => {
  const switches = { studentManagement: true, cadet: true, notices: true, whatsapp: true, assistant: true };

  it('makes a switched-on feature active while everything it requires is active', () => {
    expect(resolveSchoolFeatureActivity(switches)).toEqual(switches);
  });

  it('makes the features that need student management inactive when it is off, keeping their switches', () => {
    const active = resolveSchoolFeatureActivity({ ...switches, studentManagement: false });
    expect(active).toEqual({ studentManagement: false, cadet: false, notices: false, whatsapp: false, assistant: true });
  });

  it('never makes a switched-off feature active', () => {
    expect(resolveSchoolFeatureActivity({ ...switches, notices: false }).notices).toBe(false);
  });

  it('names the required features that are not active', () => {
    const flags: SchoolFeatureFlags = {
      studentManagement: DISABLED_SCHOOL_FEATURE,
      cadet: { included: false, adjustment: true, enabled: true, active: false, config: null },
      notices: DISABLED_SCHOOL_FEATURE,
      whatsapp: { included: false, adjustment: true, enabled: true, active: false, config: null },
      assistant: DISABLED_SCHOOL_FEATURE,
    };
    expect(missingSchoolFeatureRequirements('cadet', flags)).toEqual(['studentManagement']);
    expect(missingSchoolFeatureRequirements('whatsapp', flags)).toEqual(['studentManagement']);
    expect(missingSchoolFeatureRequirements('assistant', flags)).toEqual([]);
    expect(
      missingSchoolFeatureRequirements('cadet', {
        ...flags,
        studentManagement: { included: true, adjustment: null, enabled: true, active: true, config: null },
      }),
    ).toEqual([]);
  });
});

/**
 * Review round 1, F5. Both real features have a `null` config today, so the
 * guarantee "one feature's config can never be passed as another's" is
 * checked against a catalogue whose configs differ. These are compile-time
 * assertions: `pnpm check-types` fails if a `@ts-expect-error` stops erroring.
 */
describe('keyed feature entries', () => {
  type Shape = { label: string; description: string; tiers: readonly SchoolTier[]; requires: readonly string[] };
  type TwoConfigs = {
    plain: Shape & { config: z.ZodNull };
    limited: Shape & { config: z.ZodObject<{ limit: z.ZodNumber }> };
  };
  type Entry = FeatureEntryIn<TwoConfigs>;

  it('pairs each key with its own config, also when the key is not a literal', () => {
    const limited: Entry = { feature: 'limited', enabled: true, config: { limit: 3 } };
    const plain: Entry = { feature: 'plain', enabled: true, config: null };
    // @ts-expect-error a feature without settings cannot carry another feature's config
    const crossed: Entry = { feature: 'plain', enabled: true, config: { limit: 3 } };
    const anyKey = 'plain' as keyof TwoConfigs;
    // @ts-expect-error a key that may be any feature cannot be paired with one feature's config
    const widened: Entry = { feature: anyKey, enabled: true, config: { limit: 3 } };
    // Spreading an entry keeps the pairing, which is how the admin editor builds an update.
    const toggled: Entry = { ...limited, enabled: false };
    // The adjustment may be null (follow the tier); the pairing holds all the same.
    const followed: Entry = { ...limited, enabled: null };
    // Narrowing on the key gives exactly that feature's config type.
    const read = (entry: Entry): number | null => (entry.feature === 'limited' ? (entry.config?.limit ?? null) : entry.config);
    expect([read(limited), read(plain), read(toggled), read(followed)]).toEqual([3, null, 3, 3]);
    expect([crossed.feature, widened.feature]).toEqual(['plain', 'plain']);
  });

  it('lists a school\'s flags as entries in catalogue order, carrying what is stored and nothing derived', () => {
    const assistantConfig = { monthlyLimitUsd: null, voice: { enabled: false } };
    const entries: SchoolFeatureEntry[] = schoolFeatureEntries({
      // Included by the tier and switched off for this school.
      studentManagement: { included: true, adjustment: false, enabled: false, active: false, config: null },
      // Not in the tier and switched on for this school (inactive: it needs student management).
      cadet: { included: false, adjustment: true, enabled: true, active: false, config: null },
      // Follows its tier, which includes it: on, with no adjustment.
      notices: { included: true, adjustment: null, enabled: true, active: false, config: null },
      whatsapp: DISABLED_SCHOOL_FEATURE,
      assistant: { included: false, adjustment: true, enabled: true, active: true, config: assistantConfig },
    });
    // The adjustment and config only: `included`, the switch and `active` are derived and never part of an update.
    expect(entries).toEqual([
      { feature: 'studentManagement', enabled: false, config: null },
      { feature: 'cadet', enabled: true, config: null },
      // A feature that follows its tier is written back as "follow the tier", not as its current switch.
      { feature: 'notices', enabled: null, config: null },
      { feature: 'whatsapp', enabled: null, config: null },
      { feature: 'assistant', enabled: true, config: assistantConfig },
    ]);
    // Each entry is a valid update as it stands.
    for (const entry of entries) expect(schoolFeatureUpdateSchema.parse(entry)).toEqual(entry);
  });
});

describe('the feature-disabled error', () => {
  it('is FORBIDDEN with a stable reason and the feature, readable on both sides of the wire', () => {
    const error = schoolFeatureDisabledError('notices');
    expect(error.code).toBe('FORBIDDEN');
    expect(error.status).toBe(403);
    expect(error.data).toEqual({ reason: SCHOOL_FEATURE_DISABLED_REASON, feature: 'notices' });
    expect(error.message).toBe('Notices is not enabled for this school.');
    expect(readSchoolFeatureDisabled(error)).toBe('notices');
    // What a client receives after the JSON round trip.
    expect(readSchoolFeatureDisabled(JSON.parse(JSON.stringify(error.toJSON())))).toBe('notices');
  });

  it('is not confused with other errors', () => {
    expect(readSchoolFeatureDisabled(null)).toBeNull();
    expect(readSchoolFeatureDisabled(new Error('nope'))).toBeNull();
    expect(readSchoolFeatureDisabled({ code: 'FORBIDDEN' })).toBeNull();
    expect(readSchoolFeatureDisabled({ code: 'FORBIDDEN', data: { reason: 'OTHER', feature: 'cadet' } })).toBeNull();
    expect(readSchoolFeatureDisabled({ code: 'FORBIDDEN', data: { reason: SCHOOL_FEATURE_DISABLED_REASON, feature: 'retired' } })).toBeNull();
    expect(readSchoolFeatureDisabled({ code: 'NOT_FOUND', data: { reason: SCHOOL_FEATURE_DISABLED_REASON, feature: 'cadet' } })).toBeNull();
  });
});
