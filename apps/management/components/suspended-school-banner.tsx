'use client';

import { useQuery } from '@tanstack/react-query';
import { SCHOOL_SUSPENDED_MESSAGE } from '@campuspilot/api/school-suspension/school-suspension.contract';
import { AppShellAlert } from '@campuspilot/components/app-shell';
import { orpc } from '@/lib/orpc';

/**
 * Permanent warning on every page of a suspended school
 * (`school.isSuspended`, docs/school-suspension.md). The school is
 * read-only: screens stay as they are and every change is refused by the
 * server, so this is where staff learn why. It has no action, so it cannot
 * be dismissed; the registration lives as long as the school shell is
 * mounted and the school stays suspended. Reads the same cached school list
 * as the switcher, which the query client reads again whenever the server
 * answers with the suspended-school error (`lib/orpc.ts`).
 */
export function SuspendedSchoolBanner({ schoolId }: { schoolId: string }) {
  const schoolsQuery = useQuery(orpc.school.listMySchools.queryOptions());
  const isSuspended = schoolsQuery.data?.some((school) => school.id === schoolId && school.isSuspended) ?? false;
  if (!isSuspended) return null;
  return <AppShellAlert slug={`school:${schoolId}:suspended`} type="warning" message={SCHOOL_SUSPENDED_MESSAGE} />;
}
