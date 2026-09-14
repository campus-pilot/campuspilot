'use client';

import { useQuery } from '@tanstack/react-query';
import { orpc } from '@/lib/orpc';
import { SchoolAvatar } from '@/components/school-avatar';

export function SchoolSlugBreadcrumbValue({ schoolId }: { schoolId: string }) {
  const schoolQuery = useQuery(
    orpc.systemAdmin.getSchool.queryOptions({ input: { id: schoolId } }),
  );

  if (schoolQuery.isPending) {
    return (
      <span className="flex items-center gap-1.5" aria-label="Loading school">
        <span className="size-4 animate-pulse rounded-sm bg-muted" />
        <span className="h-3.5 w-20 animate-pulse rounded bg-muted" />
      </span>
    );
  }

  if (schoolQuery.isError) {
    return <span>School unavailable</span>;
  }

  return (
    <span className="flex items-center gap-1.5">
      <SchoolAvatar school={schoolQuery.data} className="size-4!" />
      <span>{schoolQuery.data.slug}</span>
    </span>
  );
}
