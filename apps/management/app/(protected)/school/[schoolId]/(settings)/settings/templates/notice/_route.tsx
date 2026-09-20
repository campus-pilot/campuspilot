import { BookOpenCheck } from 'lucide-react';
import { defineManagementPage } from '@/components/management-route';
import type { SchoolRouteParams } from '@/components/school-route';
import { settingsBreadcrumbs } from '../../settings-breadcrumbs';

export const noticeTemplatePage = defineManagementPage<SchoolRouteParams>({
  matches: (pathname) => /^\/school\/[^/]+\/settings\/templates\/notice$/.test(pathname),
  breadcrumbs: ({ schoolId }) => settingsBreadcrumbs(schoolId, { id: 'notice-template', label: 'Notice', icon: BookOpenCheck }),
});

