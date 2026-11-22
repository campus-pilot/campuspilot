import { SCHOOL_FEATURE_KEYS, type SchoolFeatureKey } from '@campuspilot/db/feature-flags/catalogue';
import { getSchoolFeatureFlags } from '@campuspilot/db/feature-flags/store';
import type { SchoolKind } from '@campuspilot/db/school-kind';
import { getSchoolKind } from '@campuspilot/db/school-kind-store';

import { db } from '../db';

/**
 * The features a school has now (each one active: its switch and every
 * feature it requires; see the feature catalogue). Read fresh for every model
 * request and tool call, from the same store every API gate reads, so the
 * assistant stops offering a feature's tools as soon as an administrator
 * switches it off. The API refuses such a call anyway.
 */
export async function readActiveSchoolFeatures(schoolId: string): Promise<ReadonlySet<SchoolFeatureKey>> {
  const features = await getSchoolFeatureFlags(db, schoolId);
  return new Set(SCHOOL_FEATURE_KEYS.filter((key) => features[key].active));
}

/**
 * The school's kind (docs/personal-space.md), read with its features for
 * every model request and tool call. A school that cannot be found is read as
 * a real school: its tools are refused by the API anyway, and a real school's
 * tools never reach a personal space's data.
 */
export async function readSchoolKind(schoolId: string): Promise<SchoolKind> {
  return (await getSchoolKind(db, schoolId)) ?? 'school';
}
