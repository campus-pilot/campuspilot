import { School } from 'lucide-react';
import { defineManagementPage } from '@/components/management-route';
import type { SchoolRouteParams } from '@/components/school-route';
import { settingsBreadcrumbs } from './settings-breadcrumbs';

export const schoolSettingsPage = defineManagementPage<SchoolRouteParams>({
  matches: (pathname) => /^\/school\/[^/]+\/settings$/.test(pathname),
  breadcrumbs: ({ schoolId }) =>
    settingsBreadcrumbs(schoolId, { id: 'school-settings', label: 'School', icon: School }),
});

