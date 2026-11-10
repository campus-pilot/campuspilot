import {
  readSchoolFeatureDisabled,
  type SchoolFeatureKey,
} from '@campuspilot/db/feature-flags/catalogue';
import { expect } from 'vitest';

/**
 * Asserts that a call was refused because the school's `feature` is
 * disabled: FORBIDDEN carrying `data: { reason: 'SCHOOL_FEATURE_DISABLED',
 * feature }`, which is what distinguishes it from a permission denial.
 */
export async function expectFeatureDisabled(
  promise: Promise<unknown>,
  feature: SchoolFeatureKey,
): Promise<void> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error, 'the call should have been refused').not.toBeNull();
  expect(error).toMatchObject({ code: 'FORBIDDEN' });
  expect(readSchoolFeatureDisabled(error)).toBe(feature);
}

/** Asserts a plain FORBIDDEN that is *not* a feature-disabled refusal. */
export async function expectPermissionDenied(promise: Promise<unknown>): Promise<void> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toMatchObject({ code: 'FORBIDDEN' });
  expect(readSchoolFeatureDisabled(error)).toBeNull();
}
