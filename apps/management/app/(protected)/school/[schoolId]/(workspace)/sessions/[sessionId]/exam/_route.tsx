import { ClipboardCheck } from 'lucide-react';
import { defineManagementPage } from '@/components/management-route';
import { sessionPageBreadcrumbs } from '@/components/session-page-breadcrumbs';
import type { SchoolSessionRouteParams } from '@/components/school-route';

export const examPage = defineManagementPage<SchoolSessionRouteParams>({
  matches: (pathname) =>
    /^\/school\/[^/]+\/sessions\/[^/]+\/exam(?:\/|$)/.test(pathname),
  breadcrumbs: ({ schoolId, sessionId }) =>
    sessionPageBreadcrumbs(schoolId, sessionId, { id: 'exam', label: 'Examinations', icon: ClipboardCheck }),
});
