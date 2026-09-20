import { CalendarDays } from 'lucide-react';
import { defineManagementPage } from '@/components/management-route';
import type { SchoolRouteParams } from '@/components/school-route';
import { settingsBreadcrumbs } from '../settings-breadcrumbs';

export const sessionSettingsPage = defineManagementPage<SchoolRouteParams>({
  matches: (pathname) => /^\/school\/[^/]+\/settings\/session$/.test(pathname),
  breadcrumbs: ({ schoolId }) =>
    settingsBreadcrumbs(schoolId, { id: 'session-settings', label: 'Session', icon: CalendarDays }),
});

