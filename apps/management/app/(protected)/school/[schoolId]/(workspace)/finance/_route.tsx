import { WalletCards } from 'lucide-react';
import { defineManagementPage } from '@/components/management-route';
import { schoolPageBreadcrumbs } from '@/components/school-page-breadcrumbs';
import type { SchoolRouteParams } from '@/components/school-route';

export const financePage = defineManagementPage<SchoolRouteParams>({
  matches: (pathname) => /^\/school\/[^/]+\/finance$/.test(pathname),
  breadcrumbs: ({ schoolId }) =>
    schoolPageBreadcrumbs(schoolId, { id: 'finance', label: 'Finance', icon: WalletCards }),
});

