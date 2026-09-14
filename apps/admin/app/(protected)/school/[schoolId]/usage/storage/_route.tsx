import { AppWindow, Database } from 'lucide-react';
import { defineAdminPage } from '@/components/admin-route';
import { SchoolSlugBreadcrumbValue } from '../../school-slug-breadcrumb-value';
import { schoolHref, type SchoolRouteParams } from '../../school-route';

export const storageUsagePage = defineAdminPage<SchoolRouteParams>({
  matches: (pathname) => /^\/school\/[^/]+\/usage\/storage$/.test(pathname),
  breadcrumbs: ({ schoolId }) => [
    { id: 'campuspilot', label: 'CampusPilot', href: '/', icon: AppWindow },
    { id: 'school', label: <SchoolSlugBreadcrumbValue schoolId={schoolId} />, href: schoolHref(schoolId) },
    { id: 'storage-usage', label: 'Storage Usage', icon: Database },
  ],
});
