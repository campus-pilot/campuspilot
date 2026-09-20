import { UserRoundPlus } from 'lucide-react';
import { defineManagementPage } from '@/components/management-route';
import { schoolPageBreadcrumbs } from '@/components/school-page-breadcrumbs';
import type { SchoolRouteParams } from '@/components/school-route';

export const admissionsPage = defineManagementPage<SchoolRouteParams>({
  matches: (pathname) => /^\/school\/[^/]+\/admissions$/.test(pathname),
  breadcrumbs: ({ schoolId }) =>
    schoolPageBreadcrumbs(schoolId, { id: 'admissions', label: 'Admissions', icon: UserRoundPlus }),
});

