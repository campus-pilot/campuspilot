import { Files } from 'lucide-react';
import { defineManagementPage } from '@/components/management-route';
import { sessionPageBreadcrumbs } from '@/components/session-page-breadcrumbs';
import type { SchoolSessionRouteParams } from '@/components/school-route';
export const documentsPage = defineManagementPage<SchoolSessionRouteParams>({
  matches: (pathname) =>
    /^\/school\/[^/]+\/sessions\/[^/]+\/documents$/.test(pathname),
  breadcrumbs: ({ schoolId, sessionId }) =>
    sessionPageBreadcrumbs(schoolId, sessionId, {
      id: 'documents',
      label: 'Documents',
      icon: Files,
    }),
});
