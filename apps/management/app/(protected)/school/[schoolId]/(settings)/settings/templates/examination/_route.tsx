import { ClipboardCheck } from 'lucide-react';
import { defineManagementPage } from '@/components/management-route';
import type { SchoolRouteParams } from '@/components/school-route';
import { settingsBreadcrumbs } from '../../settings-breadcrumbs';

export const examinationTemplatePage = defineManagementPage<SchoolRouteParams>({
  matches: (pathname) => /^\/school\/[^/]+\/settings\/templates\/examination$/.test(pathname),
  breadcrumbs: ({ schoolId }) => settingsBreadcrumbs(schoolId, { id: 'examination-template', label: 'Examination', icon: ClipboardCheck }),
});

