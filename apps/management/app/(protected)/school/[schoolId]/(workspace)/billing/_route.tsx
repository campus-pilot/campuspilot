import { CreditCard } from 'lucide-react';
import { defineManagementPage } from '@/components/management-route';
import { schoolPageBreadcrumbs } from '@/components/school-page-breadcrumbs';
import type { SchoolRouteParams } from '@/components/school-route';

export const billingPage = defineManagementPage<SchoolRouteParams>({
  matches: (pathname) => /^\/school\/[^/]+\/billing$/.test(pathname),
  breadcrumbs: ({ schoolId }) =>
    schoolPageBreadcrumbs(schoolId, { id: 'billing', label: 'Billing', icon: CreditCard }),
});

