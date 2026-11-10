import {
  DISABLED_SCHOOL_FEATURE,
  parseSchoolFeatureConfig,
  readSchoolFeatureDisabled,
  SCHOOL_FEATURE_DISABLED_REASON,
  SCHOOL_FEATURE_KEYS,
  schoolFeatureCatalogue,
  schoolFeatureFlagsSchema,
  schoolFeatureHasConfig,
  schoolFeatureUpdateSchema,
} from '@campuspilot/db/feature-flags/catalogue';
import { describe, expect, it } from 'vitest';

import { schoolFeatureDisabledError } from './feature-flags.service';
import { DEMO_SCHOOL_FEATURE_DEFAULTS } from '../workflows/demo-school/constants';

describe('school feature catalogue', () => {
  it('lists every catalogue key once, each with a label and description', () => {
    expect(SCHOOL_FEATURE_KEYS).toEqual(Object.keys(schoolFeatureCatalogue));
    expect(SCHOOL_FEATURE_KEYS).toEqual(['cadet', 'notices']);
    for (const key of SCHOOL_FEATURE_KEYS) {
      expect(schoolFeatureCatalogue[key].label.length).toBeGreaterThan(0);
      expect(schoolFeatureCatalogue[key].description.length).toBeGreaterThan(0);
    }
  });

  it('validates a config against its own feature schema only', () => {
    expect(parseSchoolFeatureConfig('cadet', null)).toBeNull();
    expect(parseSchoolFeatureConfig('notices', undefined)).toBeNull();
    // Both current features declare no settings, so any value is refused.
    expect(() => parseSchoolFeatureConfig('cadet', { anything: true })).toThrow();
    expect(() => parseSchoolFeatureConfig('notices', 'on')).toThrow();
    expect(schoolFeatureHasConfig('cadet')).toBe(false);
    expect(schoolFeatureHasConfig('notices')).toBe(false);
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

  it('decides every feature explicitly for demo schools', () => {
    expect(Object.keys(DEMO_SCHOOL_FEATURE_DEFAULTS).sort()).toEqual([...SCHOOL_FEATURE_KEYS].sort());
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
