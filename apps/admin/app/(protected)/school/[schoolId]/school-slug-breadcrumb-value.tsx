'use client';

import { useQuery } from '@tanstack/react-query';
import { orpc } from '@/lib/orpc';

export function SchoolSlugBreadcrumbValue({ schoolId }: { schoolId: string }) {
  const schoolQuery = useQuery(
    orpc.systemAdmin.getSchool.queryOptions({ input: { id: schoolId } }),
  );

  if (schoolQuery.isPending) {
    return (
      <span
        aria-label="Loading school"
        className="inline-block h-3.5 w-20 animate-pulse rounded bg-muted"
      />
    );
  }

  if (schoolQuery.isError) {
    return <span>School unavailable</span>;
  }

  return <span>{schoolQuery.data.slug}</span>;
}
