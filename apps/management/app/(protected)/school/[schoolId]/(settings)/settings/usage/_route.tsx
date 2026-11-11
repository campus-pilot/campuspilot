import { ChartNoAxesColumn } from 'lucide-react';
import { defineManagementPage } from '@/components/management-route';
import type { SchoolRouteParams } from '@/components/school-route';
import { settingsBreadcrumbs } from '../settings-breadcrumbs';

export const usageSettingsPage = defineManagementPage<SchoolRouteParams>({
  matches: (pathname) => /^\/school\/[^/]+\/settings\/usage$/.test(pathname),
  title: 'Usage',
  breadcrumbs: ({ schoolId }) => settingsBreadcrumbs(schoolId, { id: 'usage-settings', label: 'Usage', icon: ChartNoAxesColumn }),
});
