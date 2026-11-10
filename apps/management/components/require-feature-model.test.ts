import assert from 'node:assert/strict';
import { test } from 'node:test';
import { featureFlagsOutdatedBy, resolveSchoolFeature } from './require-feature-model';

const features = {
  cadet: { enabled: true, config: null },
  notices: { enabled: false, config: null },
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

test('only the server\'s disabled-feature answer makes the cached flags outdated (review U6)', () => {
  assert.equal(featureFlagsOutdatedBy({ code: 'FORBIDDEN', data: { reason: 'SCHOOL_FEATURE_DISABLED', feature: 'notices' } }), true);
  assert.equal(featureFlagsOutdatedBy({ code: 'FORBIDDEN', data: { reason: 'SCHOOL_FEATURE_DISABLED', feature: 'cadet' } }), true);
  // A permission denial, a missing record and a network failure say nothing about the flags.
  assert.equal(featureFlagsOutdatedBy({ code: 'FORBIDDEN' }), false);
  assert.equal(featureFlagsOutdatedBy({ code: 'NOT_FOUND' }), false);
  assert.equal(featureFlagsOutdatedBy(new Error('Failed to fetch')), false);
  assert.equal(featureFlagsOutdatedBy(null), false);
});
