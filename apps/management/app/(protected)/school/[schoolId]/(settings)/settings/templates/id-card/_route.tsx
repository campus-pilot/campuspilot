import { FileBadge } from 'lucide-react';
import { defineManagementPage } from '@/components/management-route';
import type { SchoolRouteParams } from '@/components/school-route';
import { settingsBreadcrumbs } from '../../settings-breadcrumbs';

export const idCardTemplatePage = defineManagementPage<SchoolRouteParams>({
  matches: (pathname) => /^\/school\/[^/]+\/settings\/templates\/id-card$/.test(pathname),
  breadcrumbs: ({ schoolId }) => settingsBreadcrumbs(schoolId, { id: 'id-card-template', label: 'ID card', icon: FileBadge }),
});

