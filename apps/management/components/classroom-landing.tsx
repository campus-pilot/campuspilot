'use client';

import { redirect } from 'next/navigation';
import { classroomHref, classroomSections } from './classroom-sections';
import { useSchoolFeature } from './require-feature';

/**
 * A classroom's root: redirects to its first section and renders nothing
 * else. The first section depends on the school's features (Students with
 * student management, Teachers without), so it waits until they are known.
 * `redirect()` during render replaces the history entry, so Back does not
 * return to the root and loop (and no effect is involved).
 */
export function ClassroomLanding({ scope }: { scope: { schoolId: string; sessionId: string; classId: string } }) {
  const studentManagement = useSchoolFeature(scope.schoolId, 'studentManagement');
  if (studentManagement.status === 'pending') return null;
  // Unknown flags fail closed to the sections every school has.
  const [first] = classroomSections(studentManagement.enabled);
  redirect(classroomHref(scope, first!.id));
}
