'use client';

import { useQuery } from '@tanstack/react-query';
import { AppShellAlert } from '@campuspilot/components/app-shell';
import { orpc } from '@/lib/orpc';

/**
 * Permanent notice on every page of a demo school (`school.isDemo`). It has no
 * action, so it cannot be dismissed; the registration lives as long as the
 * school shell is mounted. Reads the same cached school list as the switcher.
 */
export function DemoSchoolBanner({ schoolId }: { schoolId: string }) {
  const schoolsQuery = useQuery(orpc.school.listMySchools.queryOptions());
  const isDemo = schoolsQuery.data?.some((school) => school.id === schoolId && school.isDemo) ?? false;
  if (!isDemo) return null;
  return (
    <AppShellAlert
      slug={`school:${schoolId}:demo`}
      type="normal"
      message="Demo school: all data is sample data, not real students or staff."
    />
  );
}
