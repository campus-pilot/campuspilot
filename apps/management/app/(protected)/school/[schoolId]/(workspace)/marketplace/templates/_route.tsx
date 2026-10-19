import { Store } from 'lucide-react';
import { defineManagementPage } from '@/components/management-route';
import { schoolPageBreadcrumbs } from '@/components/school-page-breadcrumbs';
import { schoolHref, type SchoolRouteParams } from '@/components/school-route';

export const templateMarketplacePages = [
  defineManagementPage<SchoolRouteParams>({
    matches: (pathname) =>
      /^\/school\/[^/]+\/marketplace\/templates$/.test(pathname),
    breadcrumbs: ({ schoolId }) =>
      schoolPageBreadcrumbs(schoolId, {
        id: 'template-marketplace',
        label: 'Template marketplace',
        icon: Store,
      }),
  }),
  defineManagementPage<SchoolRouteParams>({
    matches: (pathname) =>
      /^\/school\/[^/]+\/marketplace\/templates\/[^/]+\/[^/]+$/.test(
        pathname,
      ),
    breadcrumbs: ({ schoolId }) => [
      ...schoolPageBreadcrumbs(schoolId, {
        id: 'template-marketplace',
        label: 'Template marketplace',
        icon: Store,
      }).map((breadcrumb) =>
        breadcrumb.id === 'template-marketplace'
          ? {
              ...breadcrumb,
              href: schoolHref(schoolId, '/marketplace/templates'),
            }
          : breadcrumb,
      ),
      { id: 'template-preview', label: 'Preview' },
    ],
  }),
];
