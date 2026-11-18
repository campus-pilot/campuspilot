import { Users } from 'lucide-react';
import { InviteStaffAction } from '@/components/invite-staff-action';
import { defineManagementPage } from '@/components/management-route';
import { schoolPageBreadcrumbs } from '@/components/school-page-breadcrumbs';
import type { SchoolRouteParams } from '@/components/school-route';

export const staffPage = defineManagementPage<SchoolRouteParams>({
  matches: (pathname) => /^\/school\/[^/]+\/staff$/.test(pathname),
  title: 'Staff',
  breadcrumbs: ({ schoolId }) =>
    schoolPageBreadcrumbs(schoolId, { id: 'staff', label: 'Staff', icon: Users }),
  actions: ({ schoolId }) => <InviteStaffAction schoolId={schoolId} />,
});
