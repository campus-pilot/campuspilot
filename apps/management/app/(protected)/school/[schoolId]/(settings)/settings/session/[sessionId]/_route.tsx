import { CalendarDays } from 'lucide-react';
import { defineManagementPage } from '@/components/management-route';
import { AllSessionsAction } from '@/components/session/all-sessions-action';
import { schoolHref, type SchoolRouteParams } from '@/components/school-route';
import { settingsBreadcrumbs } from '../../settings-breadcrumbs';
import { SessionBreadcrumbValue } from '../session-breadcrumb-value';

export type SessionDetailRouteParams = SchoolRouteParams & {
  sessionId: string;
};

export const sessionDetailPage =
  defineManagementPage<SessionDetailRouteParams>({
    matches: (pathname) =>
      /^\/school\/[^/]+\/settings\/session\/[^/]+$/.test(pathname),
    breadcrumbs: ({ schoolId, sessionId }) => [
      ...settingsBreadcrumbs(schoolId, {
        id: 'session-settings',
        label: 'Sessions',
        icon: CalendarDays,
      }).map((breadcrumb) =>
        breadcrumb.id === 'session-settings'
          ? {
              ...breadcrumb,
              href: schoolHref(schoolId, '/settings/session'),
            }
          : breadcrumb,
      ),
      {
        id: 'session',
        label: (
          <SessionBreadcrumbValue
            schoolId={schoolId}
            sessionId={sessionId}
          />
        ),
      },
    ],
    actions: ({ schoolId }) => <AllSessionsAction schoolId={schoolId} />,
  });
