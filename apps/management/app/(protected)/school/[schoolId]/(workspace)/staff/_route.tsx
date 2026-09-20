import { Users } from 'lucide-react';
import { SCHOOL_ACTIONS } from '@campuspilot/api/routers/authorization/authorization.dto';
import { InviteStaffAction } from '@/components/invite-staff-action';
import { defineManagementPage } from '@/components/management-route';
import { RequirePermissions } from '@/components/require-permissions';
import { schoolPageBreadcrumbs } from '@/components/school-page-breadcrumbs';
import type { SchoolRouteParams } from '@/components/school-route';

export const staffPage = defineManagementPage<SchoolRouteParams>({
  matches: (pathname) => /^\/school\/[^/]+\/staff$/.test(pathname),
  breadcrumbs: ({ schoolId }) =>
    schoolPageBreadcrumbs(schoolId, { id: 'staff', label: 'Staff', icon: Users }),
  actions: ({ schoolId }) => (
    <RequirePermissions
      permissions={{
        action: SCHOOL_ACTIONS.INVITE_MEMBER,
        resource: { kind: 'school', schoolId },
      }}
    >
      <InviteStaffAction schoolId={schoolId} />
    </RequirePermissions>
  ),
});
