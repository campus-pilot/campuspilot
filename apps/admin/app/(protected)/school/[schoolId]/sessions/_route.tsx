import { AppWindow, CalendarDays } from 'lucide-react';
import { defineAdminPage } from '@/components/admin-route';
import { SchoolSlugBreadcrumbValue } from '../school-slug-breadcrumb-value';
import { schoolHref, type SchoolRouteParams } from '../school-route';

export const sessionsPage = defineAdminPage<SchoolRouteParams>({
  matches: (pathname) => /^\/school\/[^/]+\/sessions$/.test(pathname),
  breadcrumbs: ({ schoolId }) => [
    { id: 'campuspilot', label: 'CampusPilot', href: '/', icon: AppWindow },
    { id: 'school', label: <SchoolSlugBreadcrumbValue schoolId={schoolId} />, href: schoolHref(schoolId) },
    { id: 'sessions', label: 'Sessions', icon: CalendarDays },
  ],
});
