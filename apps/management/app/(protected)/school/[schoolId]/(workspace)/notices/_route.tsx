import { Bell } from 'lucide-react';
import { defineManagementPage } from '@/components/management-route';
import { schoolPageBreadcrumbs } from '@/components/school-page-breadcrumbs';
import type { SchoolRouteParams } from '@/components/school-route';

export const noticesPage = defineManagementPage<SchoolRouteParams>({
  matches: (pathname) => /^\/school\/[^/]+\/notices$/.test(pathname),
  breadcrumbs: ({ schoolId }) =>
    schoolPageBreadcrumbs(schoolId, { id: 'notices', label: 'Notices', icon: Bell }),
});

