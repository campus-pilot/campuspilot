'use client';

import { useQuery } from '@tanstack/react-query';
import type {
  AppShellBreadcrumb,
  AppShellIcon,
} from '@campuspilot/components/app-shell';
import { CalendarRange, House } from 'lucide-react';
import { orpc } from '@/lib/orpc';
import { schoolHref, schoolSessionHref } from './school-route';

function SessionBreadcrumbValue({
  schoolId,
  sessionId,
}: {
  schoolId: string;
  sessionId: string;
}) {
  const sessionQuery = useQuery(
    orpc.school.getSession.queryOptions({ input: { schoolId, sessionId } }),
  );

  if (!sessionQuery.data) return <>Session</>;
  return (
    <>
      {sessionQuery.data.sessionStartYear}-
      {sessionQuery.data.sessionEndYear}
    </>
  );
}

/** Adds the human-readable academic session between school home and the page. */
export function sessionPageBreadcrumbs(
  schoolId: string,
  sessionId: string,
  leaf?: { id: string; label: string; icon: AppShellIcon },
): AppShellBreadcrumb[] {
  const sessionHref = schoolSessionHref(schoolId, sessionId);
  const breadcrumbs: AppShellBreadcrumb[] = [
    {
      id: 'school-home',
      label: <span className="sr-only">Home</span>,
      href: schoolHref(schoolId),
      icon: House,
    },
    {
      id: 'school-session',
      label: (
        <SessionBreadcrumbValue schoolId={schoolId} sessionId={sessionId} />
      ),
      href: leaf ? sessionHref : undefined,
      icon: CalendarRange,
    },
  ];

  if (leaf) breadcrumbs.push(leaf);
  return breadcrumbs;
}
