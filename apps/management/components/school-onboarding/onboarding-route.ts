import { schoolHref } from '../school-route';

/** The school's guided setup (docs/school-creation.md, "Guided setup"). */
export function onboardingHref(schoolId: string): string {
  return schoolHref(schoolId, '/get-started');
}
