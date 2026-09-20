import { GraduationCap } from 'lucide-react';
import { defineManagementPage } from '@/components/management-route';
import type { SchoolRouteParams } from '@/components/school-route';
import { settingsBreadcrumbs } from '../../settings-breadcrumbs';

export const admitCardTemplatePage = defineManagementPage<SchoolRouteParams>({
  matches: (pathname) => /^\/school\/[^/]+\/settings\/templates\/admit-card$/.test(pathname),
  breadcrumbs: ({ schoolId }) => settingsBreadcrumbs(schoolId, { id: 'admit-card-template', label: 'Admit card', icon: GraduationCap }),
});

