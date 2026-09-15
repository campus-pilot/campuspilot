import { AppWindow, CalendarDays } from 'lucide-react';
import { defineAdminPage } from '@/components/admin-route';
import { AllSessionsAction } from '@/components/session/all-sessions-action';
import { SchoolSlugBreadcrumbValue } from '../../school-slug-breadcrumb-value';
import { schoolHref, type SchoolRouteParams } from '../../school-route';
import { SessionBreadcrumbValue } from '../session-breadcrumb-value';

export type SessionDetailRouteParams = SchoolRouteParams & {
  sessionId: string;
};

export const sessionDetailPage = defineAdminPage<SessionDetailRouteParams>({
  matches: (pathname) => /^\/school\/[^/]+\/sessions\/[^/]+$/.test(pathname),
  breadcrumbs: ({ schoolId, sessionId }) => [
    { id: 'campuspilot', label: 'CampusPilot', href: '/', icon: AppWindow },
    {
      id: 'school',
      label: <SchoolSlugBreadcrumbValue schoolId={schoolId} />,
      href: schoolHref(schoolId),
    },
    {
      id: 'sessions',
      label: 'Sessions',
      href: schoolHref(schoolId, '/sessions'),
      icon: CalendarDays,
    },
    {
      id: 'session',
      label: (
        <SessionBreadcrumbValue schoolId={schoolId} sessionId={sessionId} />
      ),
    },
  ],
  actions: ({ schoolId }) => <AllSessionsAction schoolId={schoolId} />,
});
