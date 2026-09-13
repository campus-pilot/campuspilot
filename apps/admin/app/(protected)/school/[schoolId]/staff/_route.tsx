import { AppWindow, Building2, Users } from 'lucide-react';
import { defineAdminPage } from '@/components/admin-route';
import { SchoolSlugBreadcrumbValue } from '../school-slug-breadcrumb-value';
import { schoolHref, type SchoolRouteParams } from '../school-route';
import { InviteStaffAction } from '@/components/invite-staff-action';

export const staffPage = defineAdminPage<SchoolRouteParams>({
  matches: (pathname) => /^\/school\/[^/]+\/staff$/.test(pathname),
  breadcrumbs: ({ schoolId }) => [
    { id: 'campuspilot', label: 'CampusPilot', href: '/', icon: AppWindow },
    {
      id: 'school',
      label: <SchoolSlugBreadcrumbValue schoolId={schoolId} />,
      href: schoolHref(schoolId),
      icon: Building2,
    },
    { id: 'staff', label: 'Staff', icon: Users },
  ],
  actions: ({ schoolId }) => <InviteStaffAction schoolId={schoolId} />,
});
