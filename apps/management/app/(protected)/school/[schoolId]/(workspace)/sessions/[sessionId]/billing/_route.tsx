import { CreditCard } from 'lucide-react';
import { SCHOOL_ACTIONS } from '@campuspilot/api/routers/authorization/authorization.dto';
import { BillingRunAction } from '@/components/billing/billing-run-action';
import { defineManagementPage } from '@/components/management-route';
import { RequirePermissions } from '@/components/require-permissions';
import { sessionPageBreadcrumbs } from '@/components/session-page-breadcrumbs';
import type { SchoolSessionRouteParams } from '@/components/school-route';

const labels: Record<string, string> = { runs: 'Cycle', payments: 'Payments', reports: 'Overview' };
export const billingPages = [undefined, 'runs', 'payments', 'reports'].map((section) => defineManagementPage<SchoolSessionRouteParams>({
  matches: (pathname) => new RegExp(`^/school/[^/]+/sessions/[^/]+/billing${section ? `/${section}` : ''}$`).test(pathname),
  ...(section === undefined ? {
    actions: ({ schoolId, sessionId }: SchoolSessionRouteParams) => (
      <RequirePermissions permissions={[
        SCHOOL_ACTIONS.READ_SESSION_FINANCE,
        SCHOOL_ACTIONS.PREVIEW_BILLING_RUN,
        SCHOOL_ACTIONS.POST_BILLING_RUN,
      ].map((action) => ({ action, resource: { kind: 'school' as const, schoolId } }))}>
        <BillingRunAction schoolId={schoolId} sessionId={sessionId} />
      </RequirePermissions>
    ),
  } : {}),
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
    crumbs.push({ id: 'runs', label: 'Cycle', href: `/school/${schoolId}/sessions/${sessionId}/billing/runs` });
    crumbs.push({ id: billRunId, label: `Run ${billRunId.slice(0, 8)}` });
    return crumbs;
  },
});
export const billingPage = billingPages[0]!;
