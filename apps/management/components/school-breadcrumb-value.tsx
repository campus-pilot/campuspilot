'use client';

import { useQuery } from '@tanstack/react-query';
import { orpc } from '@/lib/orpc';

export function SchoolBreadcrumbValue({ schoolId }: { schoolId: string }) {
  const schoolsQuery = useQuery(orpc.school.listMySchools.queryOptions());
  const school = schoolsQuery.data?.find((candidate) => candidate.id === schoolId);

  return school?.name ?? 'School';
}

