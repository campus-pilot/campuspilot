import {
  DISABLED_SCHOOL_FEATURE,
  missingSchoolFeatureRequirements,
  parseSchoolFeatureConfig,
  resolveSchoolFeatureActivity,
  readSchoolFeatureDisabled,
  SCHOOL_FEATURE_DISABLED_REASON,
  SCHOOL_FEATURE_KEYS,
  type FeatureEntryIn,
  type SchoolFeatureEntry,
  schoolFeatureCatalogue,
  schoolFeatureEntries,
  schoolFeatureFlagsSchema,
  schoolFeatureHasConfig,
  schoolFeatureUpdateSchema,
} from '@campuspilot/db/feature-flags/catalogue';
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';

import { schoolFeatureDisabledError } from './feature-flags.service';
import { DEMO_SCHOOL_FEATURE_DEFAULTS } from '../workflows/demo-school/constants';

describe('school feature catalogue', () => {
  it('lists every catalogue key once, each with a label and description', () => {
    expect(SCHOOL_FEATURE_KEYS).toEqual(Object.keys(schoolFeatureCatalogue));
    expect(SCHOOL_FEATURE_KEYS).toEqual(['studentManagement', 'cadet', 'notices', 'assistant']);
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
    expect(schoolFeatureHasConfig('assistant')).toBe(true);
  });

  it('validates the assistant settings: a positive limit or none, and at least one eligible role, each once', () => {
    const valid = { monthlyLimitUsd: 25, eligibleRoles: ['principal', 'teacher'] };
    expect(parseSchoolFeatureConfig('assistant', valid)).toEqual(valid);
    expect(parseSchoolFeatureConfig('assistant', { monthlyLimitUsd: null, eligibleRoles: ['manager'] })).toEqual({
      monthlyLimitUsd: null,
      eligibleRoles: ['manager'],
    });
    expect(() => parseSchoolFeatureConfig('assistant', { monthlyLimitUsd: 0, eligibleRoles: ['principal'] })).toThrow();
    expect(() => parseSchoolFeatureConfig('assistant', { monthlyLimitUsd: -5, eligibleRoles: ['principal'] })).toThrow();
    expect(() => parseSchoolFeatureConfig('assistant', { monthlyLimitUsd: 10, eligibleRoles: [] })).toThrow();
    expect(() => parseSchoolFeatureConfig('assistant', { monthlyLimitUsd: 10, eligibleRoles: ['janitor'] })).toThrow();
    expect(() => parseSchoolFeatureConfig('assistant', { monthlyLimitUsd: 10, eligibleRoles: ['teacher', 'teacher'] })).toThrow();
    expect(() => parseSchoolFeatureConfig('assistant', { eligibleRoles: ['teacher'] })).toThrow();
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
  });

  it('decides every feature explicitly for demo schools, with the assistant off', () => {
    expect(Object.keys(DEMO_SCHOOL_FEATURE_DEFAULTS).sort()).toEqual([...SCHOOL_FEATURE_KEYS].sort());
    expect(DEMO_SCHOOL_FEATURE_DEFAULTS.assistant).toBe(false);
    expect(DEMO_SCHOOL_FEATURE_DEFAULTS.studentManagement).toBe(true);
  });

  it('gives student management to a school with no row, and nothing else', () => {
    const defaults = Object.fromEntries(SCHOOL_FEATURE_KEYS.map((key) => [key, schoolFeatureCatalogue[key].defaultEnabled]));
    expect(defaults).toEqual({ studentManagement: true, cadet: false, notices: false, assistant: false });
  });

  it('makes the Cadet Portal and notices need student management, and nothing else need anything', () => {
    const requires = Object.fromEntries(SCHOOL_FEATURE_KEYS.map((key) => [key, [...schoolFeatureCatalogue[key].requires]]));
    expect(requires).toEqual({ studentManagement: [], cadet: ['studentManagement'], notices: ['studentManagement'], assistant: [] });
  });

  it('has no cycle in its requirements', () => {
    const allOn = Object.fromEntries(SCHOOL_FEATURE_KEYS.map((key) => [key, true])) as Record<(typeof SCHOOL_FEATURE_KEYS)[number], boolean>;
    expect(() => resolveSchoolFeatureActivity(allOn)).not.toThrow();
  });
});

describe('feature activity', () => {
  const switches = { studentManagement: true, cadet: true, notices: true, assistant: true };

  it('makes a switched-on feature active while everything it requires is active', () => {
    expect(resolveSchoolFeatureActivity(switches)).toEqual(switches);
  });

  it('makes the features that need student management inactive when it is off, keeping their switches', () => {
    const active = resolveSchoolFeatureActivity({ ...switches, studentManagement: false });
    expect(active).toEqual({ studentManagement: false, cadet: false, notices: false, assistant: true });
  });

  it('never makes a switched-off feature active', () => {
    expect(resolveSchoolFeatureActivity({ ...switches, notices: false }).notices).toBe(false);
  });

  it('names the required features that are not active', () => {
    const flags = {
      studentManagement: { enabled: false, active: false, config: null },
      cadet: { enabled: true, active: false, config: null },
      notices: { enabled: false, active: false, config: null },
      assistant: { enabled: false, active: false, config: null },
    };
    expect(missingSchoolFeatureRequirements('cadet', flags)).toEqual(['studentManagement']);
    expect(missingSchoolFeatureRequirements('assistant', flags)).toEqual([]);
    expect(missingSchoolFeatureRequirements('cadet', { ...flags, studentManagement: { enabled: true, active: true, config: null } })).toEqual([]);
  });
});

/**
 * Review round 1, F5. Both real features have a `null` config today, so the
 * guarantee "one feature's config can never be passed as another's" is
 * checked against a catalogue whose configs differ. These are compile-time
 * assertions: `pnpm check-types` fails if a `@ts-expect-error` stops erroring.
 */
describe('keyed feature entries', () => {
  type Shape = { label: string; description: string; defaultEnabled: boolean; requires: readonly string[] };
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
    // Narrowing on the key gives exactly that feature's config type.
    const read = (entry: Entry): number | null => (entry.feature === 'limited' ? (entry.config?.limit ?? null) : entry.config);
    expect([read(limited), read(plain), read(toggled)]).toEqual([3, null, 3]);
    expect([crossed.feature, widened.feature]).toEqual(['plain', 'plain']);
  });

  it('lists a school\'s flags as entries in catalogue order', () => {
    const assistant = { enabled: true, config: { monthlyLimitUsd: null, eligibleRoles: ['principal' as const] } };
    const entries: SchoolFeatureEntry[] = schoolFeatureEntries({
      studentManagement: { enabled: false, active: false, config: null },
      cadet: { enabled: true, active: false, config: null },
      notices: DISABLED_SCHOOL_FEATURE,
      assistant: { ...assistant, active: true },
    });
    // The switch and config only: `active` is derived and never part of an update.
    expect(entries).toEqual([
      { feature: 'studentManagement', enabled: false, config: null },
      { feature: 'cadet', enabled: true, config: null },
      { feature: 'notices', enabled: false, config: null },
      { feature: 'assistant', ...assistant },
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
