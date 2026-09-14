import { AppWindow, Flag } from 'lucide-react';
import { defineAdminPage } from '@/components/admin-route';
import { SchoolSlugBreadcrumbValue } from '../../school-slug-breadcrumb-value';
import { schoolHref, type SchoolRouteParams } from '../../school-route';

export const featureFlagsPage = defineAdminPage<SchoolRouteParams>({
  matches: (pathname) => /^\/school\/[^/]+\/usage\/feature-flags$/.test(pathname),
  breadcrumbs: ({ schoolId }) => [
    { id: 'campuspilot', label: 'CampusPilot', href: '/', icon: AppWindow },
    { id: 'school', label: <SchoolSlugBreadcrumbValue schoolId={schoolId} />, href: schoolHref(schoolId) },
    { id: 'feature-flags', label: 'Feature Flags', icon: Flag },
  ],
});
