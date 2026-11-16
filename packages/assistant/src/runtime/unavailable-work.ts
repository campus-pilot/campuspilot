import {
  SCHOOL_FEATURE_KEYS,
  schoolFeatureCatalogue,
  type SchoolFeatureKey,
} from '@campuspilot/db/feature-flags/catalogue';

/**
 * What the model is told a school without a feature cannot do, in the
 * assistant's own words: the staff work that is unavailable, and nothing a
 * small model could mistake for work that is still there. (The catalogue's
 * descriptions are written for a platform administrator: the Cadet Portal's
 * mentions the fees and results students see in it, which read as "no fees or
 * results" to a model.) Exhaustive, so a new feature decides its wording.
 */
const UNAVAILABLE_WORK: Record<SchoolFeatureKey, string> = {
  studentManagement:
    'student management: admissions, students in classes, fees and billing, examination results, examination timetables, attendance and student documents',
  cadet:
    "the Cadet Portal (the students' own app): issuing portal passwords and releasing examination results to the portal. Staff's work with fees, results and student records is not part of it",
  notices: 'school notices: writing and publishing notices to staff and students',
  assistant: 'the AI assistant',
};

/**
 * The lines that tell the model which parts of CampusPilot it has no tools
 * for in this school. `withheld` is the features that took at least one tool
 * out of the assistant's own listing (`toolCatalogForSchool`): a feature the
 * assistant never had tools for is not mentioned, since telling the model
 * about it could only make it refuse more. A feature that requires another
 * withheld feature is covered by that feature's line and not listed again
 * (without student management there is no Cadet Portal to describe).
 */
export function unavailableSchoolWork(withheld: ReadonlySet<string>): string[] {
  return SCHOOL_FEATURE_KEYS.filter((key) => {
    if (!withheld.has(key)) return false;
    const required: readonly SchoolFeatureKey[] = schoolFeatureCatalogue[key].requires;
    return !required.some((other) => withheld.has(other));
  }).map((key) => UNAVAILABLE_WORK[key]);
}
