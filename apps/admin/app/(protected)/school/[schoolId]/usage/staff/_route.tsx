import { AppWindow, Building2, UserRoundCog } from 'lucide-react';
import { defineAdminPage } from '@/components/admin-route';
import { SchoolSlugBreadcrumbValue } from '../../school-slug-breadcrumb-value';
import { schoolHref, type SchoolRouteParams } from '../../school-route';

export const staffUsagePage = defineAdminPage<SchoolRouteParams>({
  matches: (pathname) => /^\/school\/[^/]+\/usage\/staff$/.test(pathname),
  breadcrumbs: ({ schoolId }) => [
    { id: 'campuspilot', label: 'CampusPilot', href: '/', icon: AppWindow },
    { id: 'school', label: <SchoolSlugBreadcrumbValue schoolId={schoolId} />, href: schoolHref(schoolId), icon: Building2 },
    { id: 'staff-usage', label: 'Staff Usage', icon: UserRoundCog },
  ],
});
