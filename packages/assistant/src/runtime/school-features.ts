import {
  SCHOOL_FEATURE_KEYS,
  schoolFeatureCatalogue,
  type SchoolFeatureKey,
} from '@campuspilot/db/feature-flags/catalogue';
import { readSchoolFeatureFlags } from '@campuspilot/db/feature-flags/store';

import { db } from '../db';

/**
 * The features a school has now (each one active: its switch and every
 * feature it requires; see the feature catalogue). Read fresh for every model
 * request and tool call, from the same store every API gate reads, so the
 * assistant stops offering a feature's tools as soon as an administrator
 * switches it off. The API refuses such a call anyway.
 */
export async function readActiveSchoolFeatures(schoolId: string): Promise<ReadonlySet<SchoolFeatureKey>> {
  const { features } = await readSchoolFeatureFlags(db, schoolId);
  return new Set(SCHOOL_FEATURE_KEYS.filter((key) => features[key].active));
}

/** A feature the school does not have, as the model is told about it. */
export type MissingSchoolFeature = { label: string; description: string };

/** The catalogue features the school does not have, in catalogue order. */
export function missingSchoolFeatures(active: ReadonlySet<SchoolFeatureKey>): MissingSchoolFeature[] {
  return SCHOOL_FEATURE_KEYS.filter((key) => !active.has(key)).map((key) => ({
    label: schoolFeatureCatalogue[key].label,
    description: schoolFeatureCatalogue[key].description,
  }));
}
