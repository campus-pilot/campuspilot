import { CreditCard } from 'lucide-react';
import { defineManagementPage } from '@/components/management-route';
import { sessionPageBreadcrumbs } from '@/components/session-page-breadcrumbs';
import type { SchoolSessionRouteParams } from '@/components/school-route';

const labels: Record<string, string> = { runs: 'Billing runs', payments: 'Payments', reports: 'Reports' };
export const billingPages = [undefined, 'runs', 'payments', 'reports'].map((section) => defineManagementPage<SchoolSessionRouteParams>({
  matches: (pathname) => new RegExp(`^/school/[^/]+/sessions/[^/]+/billing${section ? `/${section}` : ''}$`).test(pathname),
  breadcrumbs: ({ schoolId, sessionId }) => {
    const crumbs = sessionPageBreadcrumbs(schoolId, sessionId, { id: 'billing', label: 'Billing', icon: CreditCard });
    if (section) { crumbs[crumbs.length - 1]!.href = `/school/${schoolId}/sessions/${sessionId}/billing`; crumbs.push({ id: section, label: labels[section]! }); }
    return crumbs;
  },
}));
export const billingRunDetailPage = defineManagementPage<SchoolSessionRouteParams & { billRunId: string }>({
  matches: (pathname) => /^\/school\/[^/]+\/sessions\/[^/]+\/billing\/runs\/[^/]+$/.test(pathname),
  breadcrumbs: ({ schoolId, sessionId, billRunId }) => {
    const crumbs = sessionPageBreadcrumbs(schoolId, sessionId, { id: 'billing', label: 'Billing', icon: CreditCard });
    crumbs[crumbs.length - 1]!.href = `/school/${schoolId}/sessions/${sessionId}/billing`;
    crumbs.push({ id: 'runs', label: 'Billing runs', href: `/school/${schoolId}/sessions/${sessionId}/billing/runs` });
    crumbs.push({ id: billRunId, label: `Run ${billRunId.slice(0, 8)}` });
    return crumbs;
  },
});
export const billingPage = billingPages[0]!;
