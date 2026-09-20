import { ReceiptText } from 'lucide-react';
import { defineManagementPage } from '@/components/management-route';
import type { SchoolRouteParams } from '@/components/school-route';
import { settingsBreadcrumbs } from '../../settings-breadcrumbs';

export const receiptTemplatePage = defineManagementPage<SchoolRouteParams>({
  matches: (pathname) => /^\/school\/[^/]+\/settings\/templates\/receipt$/.test(pathname),
  breadcrumbs: ({ schoolId }) => settingsBreadcrumbs(schoolId, { id: 'receipt-template', label: 'Receipt', icon: ReceiptText }),
});

