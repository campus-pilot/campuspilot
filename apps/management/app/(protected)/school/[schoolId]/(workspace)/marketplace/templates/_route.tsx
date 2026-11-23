import { Store } from 'lucide-react';
import { defineManagementPage } from '@/components/management-route';
import { schoolPageBreadcrumbs } from '@/components/school-page-breadcrumbs';
import type { SchoolRouteParams } from '@/components/school-route';

export const templateMarketplacePages = [
  defineManagementPage<SchoolRouteParams>({
    matches: (pathname) =>
      /^\/school\/[^/]+\/marketplace\/templates$/.test(pathname),
    title: 'Template marketplace',
    breadcrumbs: ({ schoolId }) =>
      schoolPageBreadcrumbs(schoolId, {
        id: 'template-marketplace',
        label: 'Template marketplace',
        icon: Store,
      }),
  }),
];
