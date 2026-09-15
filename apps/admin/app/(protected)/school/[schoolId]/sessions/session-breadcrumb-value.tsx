'use client';

import { useQuery } from '@tanstack/react-query';
import { orpc } from '@/lib/orpc';

/**
 * Resolves and renders the academic session year boundaries in the breadcrumb list.
 */
export function SessionBreadcrumbValue({
  schoolId,
  sessionId,
}: {
  schoolId: string;
  sessionId: string;
}) {
  const sessionQuery = useQuery(
    orpc.school.getSession.queryOptions({ input: { schoolId, sessionId } }),
  );

  if (sessionQuery.isPending) {
    return (
      <span
        className="inline-block h-3.5 w-16 animate-pulse rounded bg-muted"
        aria-label="Loading session"
      />
    );
  }

  if (sessionQuery.isError || !sessionQuery.data) {
    return <span>Session</span>;
  }

  return (
    <span>
      {sessionQuery.data.sessionStartYear}&ndash;{sessionQuery.data.sessionEndYear}
    </span>
  );
}
