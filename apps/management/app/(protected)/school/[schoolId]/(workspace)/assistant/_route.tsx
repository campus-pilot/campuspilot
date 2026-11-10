import { Sparkles } from 'lucide-react';
import { defineManagementPage } from '@/components/management-route';
import { schoolPageBreadcrumbs } from '@/components/school-page-breadcrumbs';
import type { SchoolRouteParams } from '@/components/school-route';

/** The assistant page and its conversations share one breadcrumb trail. */
export const assistantPage = defineManagementPage<SchoolRouteParams>({
  matches: (pathname) => /^\/school\/[^/]+\/assistant(\/[^/]+)?$/.test(pathname),
  title: 'Assistant',
  breadcrumbs: ({ schoolId }) =>
    schoolPageBreadcrumbs(schoolId, { id: 'assistant', label: 'Assistant', icon: Sparkles }),
});
