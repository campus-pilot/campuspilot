import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveSchoolFeature } from './require-feature-model';

const features = {
  cadet: { enabled: true, config: null },
  notices: { enabled: false, config: null },
};

test('a feature fails closed while the flags are pending, failed or missing', () => {
  const closed = { enabled: false, config: null };
  assert.deepEqual(resolveSchoolFeature({ isPending: true, isError: false, features: undefined }, 'cadet'), { ...closed, status: 'pending' });
  assert.deepEqual(resolveSchoolFeature({ isPending: false, isError: true, features }, 'cadet'), { ...closed, status: 'error' });
  assert.deepEqual(resolveSchoolFeature({ isPending: false, isError: false, features: undefined }, 'cadet'), { ...closed, status: 'error' });
});

test('exactly the requested feature is returned once the flags loaded', () => {
  const loaded = { isPending: false, isError: false, features };
  assert.deepEqual(resolveSchoolFeature(loaded, 'cadet'), { enabled: true, config: null, status: 'ready' });
  assert.deepEqual(resolveSchoolFeature(loaded, 'notices'), { enabled: false, config: null, status: 'ready' });
});
