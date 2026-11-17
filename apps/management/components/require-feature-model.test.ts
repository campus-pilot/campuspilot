import assert from 'node:assert/strict';
import { test } from 'node:test';
import { featureFlagsOutdatedBy, resolveSchoolFeature, schoolListOutdatedBy } from './require-feature-model';

/** A feature the school's tier includes, with no adjustment. */
const on = { included: true, adjustment: null, enabled: true, active: true, config: null };
/** A feature the school's tier does not include, with no adjustment. */
const off = { included: false, adjustment: null, enabled: false, active: false, config: null };
const features = {
  studentManagement: on,
  cadet: on,
  notices: off,
  whatsapp: off,
  assistant: off,
};
const closed = { enabled: false, config: null };

test('a feature fails closed while the first read is pending', () => {
  assert.deepEqual(resolveSchoolFeature({ isPending: true, isError: false, features: undefined }, 'cadet'), { ...closed, status: 'pending' });
});

test('a read that never succeeded is unknown, not disabled', () => {
  assert.deepEqual(resolveSchoolFeature({ isPending: false, isError: true, features: undefined }, 'cadet'), { ...closed, status: 'unknown' });
  assert.deepEqual(resolveSchoolFeature({ isPending: false, isError: false, features: undefined }, 'cadet'), { ...closed, status: 'unknown' });
});

test('a failed refetch keeps the flags that are already known (review U1)', () => {
  // What TanStack Query reports after a background refetch failed: isError with the last good data.
  const refetchFailed = { isPending: false, isError: true, features };
  assert.deepEqual(resolveSchoolFeature(refetchFailed, 'cadet'), { enabled: true, config: null, status: 'ready' });
  assert.deepEqual(resolveSchoolFeature(refetchFailed, 'notices'), { enabled: false, config: null, status: 'ready' });
});

test('exactly the requested feature is returned once the flags loaded', () => {
  const loaded = { isPending: false, isError: false, features };
  assert.deepEqual(resolveSchoolFeature(loaded, 'cadet'), { enabled: true, config: null, status: 'ready' });
  assert.deepEqual(resolveSchoolFeature(loaded, 'notices'), { enabled: false, config: null, status: 'ready' });
});

test('the UI follows whether the school has a feature, not its switch', () => {
  // Cadet is switched on but student management, which it requires, is off.
  const loaded = {
    isPending: false,
    isError: false,
    features: {
      ...features,
      // Student management adjusted off for this school on a tier that includes it.
      studentManagement: { ...on, adjustment: false, enabled: false, active: false },
      cadet: { ...on, active: false },
    },
  };
  assert.deepEqual(resolveSchoolFeature(loaded, 'cadet'), { enabled: false, config: null, status: 'ready' });
  assert.deepEqual(resolveSchoolFeature(loaded, 'studentManagement'), { enabled: false, config: null, status: 'ready' });
});

test('an answer from an older API is unknown, not a crash and not disabled', () => {
  // No entry for a feature the API does not know yet.
  const { studentManagement: _new, ...withoutNewFeature } = features;
  const older = { isPending: false, isError: false, features: withoutNewFeature as typeof features };
  assert.deepEqual(resolveSchoolFeature(older, 'studentManagement'), { ...closed, status: 'unknown' });
  // Entries without `active`: the switch alone does not say whether the school has the feature.
  const withoutActive = {
    isPending: false,
    isError: false,
    features: { ...features, cadet: { enabled: true, config: null } } as unknown as typeof features,
  };
  assert.deepEqual(resolveSchoolFeature(withoutActive, 'cadet'), { ...closed, status: 'unknown' });
});

test('only the server\'s disabled-feature answer makes the cached flags outdated (review U6)', () => {
  assert.equal(featureFlagsOutdatedBy({ code: 'FORBIDDEN', data: { reason: 'SCHOOL_FEATURE_DISABLED', feature: 'notices' } }), true);
  assert.equal(featureFlagsOutdatedBy({ code: 'FORBIDDEN', data: { reason: 'SCHOOL_FEATURE_DISABLED', feature: 'cadet' } }), true);
  // A permission denial, a missing record and a network failure say nothing about the flags.
  assert.equal(featureFlagsOutdatedBy({ code: 'FORBIDDEN' }), false);
  assert.equal(featureFlagsOutdatedBy({ code: 'NOT_FOUND' }), false);
  assert.equal(featureFlagsOutdatedBy(new Error('Failed to fetch')), false);
  assert.equal(featureFlagsOutdatedBy(null), false);
});

test('only the server\'s suspended-school answer makes the cached school list outdated', () => {
  assert.equal(schoolListOutdatedBy({ code: 'FORBIDDEN', data: { reason: 'SCHOOL_SUSPENDED' } }), true);
  // A disabled feature, a permission denial and a network failure say nothing about a suspension.
  assert.equal(schoolListOutdatedBy({ code: 'FORBIDDEN', data: { reason: 'SCHOOL_FEATURE_DISABLED', feature: 'notices' } }), false);
  assert.equal(schoolListOutdatedBy({ code: 'FORBIDDEN' }), false);
  assert.equal(schoolListOutdatedBy({ code: 'PRECONDITION_FAILED', data: { reason: 'SCHOOL_SUSPENDED' } }), false);
  assert.equal(schoolListOutdatedBy(new Error('Failed to fetch')), false);
  assert.equal(schoolListOutdatedBy(null), false);
});
