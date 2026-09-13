import { AppWindow, Building2 } from 'lucide-react';
import { defineAdminPage } from '@/components/admin-route';
import { SchoolSlugBreadcrumbValue } from './school-slug-breadcrumb-value';
import type { SchoolRouteParams } from './school-route';

export const dashboardPage = defineAdminPage<SchoolRouteParams>({
  matches: (pathname) => /^\/school\/[^/]+$/.test(pathname),
  breadcrumbs: ({ schoolId }) => [
    { id: 'campuspilot', label: 'CampusPilot', href: '/', icon: AppWindow },
    { id: 'school', label: <SchoolSlugBreadcrumbValue schoolId={schoolId} />, icon: Building2 },
  ],
});
