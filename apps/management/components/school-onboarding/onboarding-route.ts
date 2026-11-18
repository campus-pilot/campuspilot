import { SCHOOL_ACTIONS } from '@campuspilot/api/routers/authorization/authorization.dto';
import { schoolPermission } from '../exam/exam-model';
import { schoolHref } from '../school-route';

/** The school's guided setup (docs/school-creation.md, "Guided setup"). */
export function onboardingHref(schoolId: string): string {
  return schoolHref(schoolId, '/get-started');
}

/**
 * The permissions `school.completeOnboarding` checks, one per step it takes.
 * Only someone who holds all of them is offered or sent to the guide.
 */
export function onboardingPermissions(schoolId: string) {
  return [
    SCHOOL_ACTIONS.CREATE_SESSION,
    SCHOOL_ACTIONS.CREATE_EXAM,
    SCHOOL_ACTIONS.CREATE_CLASS,
    SCHOOL_ACTIONS.CREATE_EXAM_PLAN,
  ].map((action) => schoolPermission(schoolId, action));
}
